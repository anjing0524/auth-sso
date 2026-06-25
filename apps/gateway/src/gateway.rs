use async_trait::async_trait;
use base64::Engine;
use jsonwebtoken::{Algorithm, Validation, decode, decode_header};
use pingora_core::prelude::*;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_load_balancing::LoadBalancer;
use pingora_load_balancing::selection::RoundRobin;
use pingora_proxy::{ProxyHttp, Session};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tracing::{debug, error, info, warn};

use crate::claims::Claims;
use crate::jwks::JwksCache;
use crate::rate_limiter::RateLimiter;

/// 预分类和高性能过滤的公开路径匹配器
#[derive(Debug, Clone)]
pub struct PathMatcher {
    public_exact_paths: HashSet<String>,
    public_prefix_paths: Vec<String>,
}

impl PathMatcher {
    /// 初始化并对白名单进行分类与高性能前缀排序
    pub fn new(public_paths: Option<Vec<String>>) -> Self {
        let mut exact_paths = HashSet::new();
        let mut prefix_paths = Vec::new();
        for path in public_paths.unwrap_or_default() {
            if path.ends_with('/') && path != "/" {
                prefix_paths.push(path);
            } else {
                exact_paths.insert(path);
            }
        }
        // 性能优化：降序排列前缀以尽早触及深度具体路径
        prefix_paths.sort_by_key(|p| std::cmp::Reverse(p.len()));

        Self {
            public_exact_paths: exact_paths,
            public_prefix_paths: prefix_paths,
        }
    }

    /// 校验当前请求路径是否放行
    pub fn is_public(&self, path: &str) -> bool {
        // 1. 放行静态资源目录
        if path.starts_with("/_next/") || path.starts_with("/static/") {
            return true;
        }

        // 2. 常见静态资产文件的扩展名放行
        const STATIC_EXTENSIONS: &[&str] = &[
            "js", "css", "ico", "png", "jpg", "jpeg", "gif", "svg", "woff", "woff2", "ttf", "json",
            "txt",
        ];
        if let Some(idx) = path.rfind('.') {
            let ext = &path[idx + 1..];
            if !ext.contains('/')
                && STATIC_EXTENSIONS
                    .iter()
                    .any(|&static_ext| ext.eq_ignore_ascii_case(static_ext))
            {
                return true;
            }
        }

        // 3. O(1) 快速精确匹配
        if self.public_exact_paths.contains(path) {
            return true;
        }

        // 4. 动态前缀放行路径匹配
        for prefix in &self.public_prefix_paths {
            if path.starts_with(prefix) {
                return true;
            }
        }

        false
    }
}

/// 根据请求的上下文特性，决策是执行 302 重定向至登录页（对于浏览器普通 GET 页面导航）
/// 还是直接返回 401 拦截（对于 API、Next.js RSC、Server Action 等）
fn should_redirect_to_login(method: &str, accept: &str, has_rsc: bool) -> bool {
    let is_get = method.eq_ignore_ascii_case("GET");
    let is_html = accept.contains("text/html");
    is_get && is_html && !has_rsc
}

/// 判断请求路径是否发往内网后端微服务
/// 规则：以 /api/v1/ 开头且排除 /api/v1/auth/ 登录校验类接口
fn is_microservice_route(path: &str) -> bool {
    path.starts_with("/api/v1/") && !path.starts_with("/api/v1/auth/")
}

/// Access Token 剩余有效期低于此阈值（秒）时触发静默续签
const REFRESH_THRESHOLD_SEC: i64 = 300;

/// 同用户续签去重窗口（秒），防止并发请求反复轮换 Refresh Token
const REFRESH_DEDUP_SEC: u64 = 30;

/// 从 Cookie 头部中提取 portal_refresh_token 的值（零拷贝）
fn extract_refresh_token_from_cookie<'a>(cookie_header: &'a str) -> Option<&'a str> {
    cookie_header.split(';').find_map(|cookie_str| {
        let trimmed = cookie_str.trim();
        trimmed
            .strip_prefix("portal_refresh_token=")
            .map(|mut val| {
                if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                    val = &val[1..val.len() - 1];
                }
                val
            })
    })
}

/// 裸解 JWT payload（不验签），用于从新签发的 AT 中提取 sub / jti
fn decode_jwt_payload(token: &str) -> Option<Claims> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let payload_bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(parts[1])
        .ok()?;
    serde_json::from_slice::<Claims>(&payload_bytes).ok()
}

/// 从 Set-Cookie 头中提取指定 cookie 的值（仅匹配首个分号前的 name=value 段）
fn extract_cookie_value<'a>(set_cookie: &'a str, name: &str) -> Option<&'a str> {
    let first_segment = set_cookie.split(';').next()?;
    let trimmed = first_segment.trim();
    let prefix = format!("{}=", name);
    trimmed.strip_prefix(&prefix)
}

/// 从 Cookie 头中移除指定 cookie
fn remove_cookie_from_header(cookie_header: &str, cookie_name: &str) -> String {
    let prefix = format!("{}=", cookie_name);
    cookie_header
        .split(';')
        .map(|s| s.trim())
        .filter(|part| !part.starts_with(&prefix))
        .collect::<Vec<&str>>()
        .join("; ")
}

/// 替换 Cookie 头中指定 cookie 的值；若不存在则追加
fn replace_cookie_in_header(cookie_header: &str, cookie_name: &str, new_value: &str) -> String {
    let prefix = format!("{}=", cookie_name);
    let mut found = false;
    let parts: Vec<String> = cookie_header
        .split(';')
        .map(|s| s.trim())
        .map(|part| {
            if part.starts_with(&prefix) {
                found = true;
                format!("{}={}", cookie_name, new_value)
            } else {
                part.to_string()
            }
        })
        .collect();
    if found {
        parts.join("; ")
    } else {
        format!("{}; {}={}", parts.join("; "), cookie_name, new_value)
    }
}

/// Auth-SSO 去中心化安全网关 - 基于 Pingora (0.8.0 + OpenSSL)
pub struct Gateway {
    /// Portal 上游负载均衡器（Portal 已合并 IdP，统一代理入口）
    pub portal_lb: Arc<LoadBalancer<RoundRobin>>,
    /// JWKS 公钥缓存（支持根据 kid 精准匹配 DecodingKey）
    pub jwks_cache: Arc<JwksCache>,
    /// Portal OIDC Provider 的 JWT issuer（校验 iss claim）
    pub issuer: String,
    /// 公开路径匹配器
    pub path_matcher: PathMatcher,
    /// Redis 异步连接管理器，用于 jti 黑名单校验。若为 None 则跳过校验 (fail-open)
    pub redis_conn: Option<redis::aio::ConnectionManager>,
    /// 异步 HTTP 客户端（用于向 Portal 发起 token 续签请求）
    pub http_client: reqwest::Client,
    /// Portal 内网上游地址（如 127.0.0.1:4100），构造续签 URL
    pub upstream_addr: String,
    /// 进程内续签去重缓存：key = user sub，value = (new_at, new_rt, timestamp)
    pub refresh_dedup: Mutex<HashMap<String, (String, String, Instant)>>,
    /// 进程内速率限制器：对 /api/auth/ 路径做 IP 限流
    pub rate_limiter: Arc<RateLimiter>,
}

impl Gateway {
    /// 对 JWT Token 进行 ES256 离线验签，支持基于 kid 匹配对应公钥
    async fn verify_jwt(&self, token: &str, ctx: &mut GatewayCtx) -> bool {
        let header = match decode_header(token) {
            Ok(h) => h,
            Err(e) => {
                warn!("JWT 头部解析失败: {:?}", e);
                return false;
            }
        };

        let kid = match header.kid {
            Some(k) => k,
            None => {
                warn!("JWT 头部未包含 kid");
                return false;
            }
        };

        let decoding_key = match self.jwks_cache.get_key(&kid) {
            Some(k) => k,
            None => {
                error!("JWKS 缓存中未找到对应的 kid: {}", kid);
                return false;
            }
        };

        let mut validation = Validation::new(Algorithm::ES256);
        validation.set_issuer(&[&self.issuer]);
        validation.validate_aud = false; // Gateway 仅校验签名与 issuer，aud 由 Portal 自行校验

        // 通过 OIDC Discovery 动态获取支持的签名算法，替换硬编码的 ES256
        let discovered_algorithms = self.jwks_cache.get_supported_algorithms();
        if !discovered_algorithms.is_empty() {
            validation.algorithms = discovered_algorithms;
            debug!(
                "JWT 验签使用 OIDC Discovery 算法: {:?}",
                validation.algorithms
            );
        } else {
            warn!("⚠️  OIDC 元数据未就绪，回退至默认算法 ES256");
        }

        // 无锁并发进行复杂的密码学 ECDSA 验签计算，消除锁竞争
        match decode::<Claims>(token, &decoding_key, &validation) {
            Ok(token_data) => {
                debug!("JWT 验签通过: sub={}, kid={}", token_data.claims.sub, kid);

                // 核心安全强化：对已解密且合法的 JWT 执行 jti 异步黑名单校验
                if let Some(ref conn) = self.redis_conn {
                    let mut conn = conn.clone();
                    let jti_key = format!("portal:jti_blocklist:{}", token_data.claims.jti);
                    match redis::cmd("EXISTS")
                        .arg(&jti_key)
                        .query_async::<i32>(&mut conn)
                        .await
                    {
                        Ok(exists) => {
                            if exists == 1 {
                                warn!(
                                    "⚠️ 拒绝访问：JWT 的 jti 已被吊销 (存在于 Redis 黑名单中): jti={}",
                                    token_data.claims.jti
                                );
                                return false;
                            }
                        }
                        Err(e) => {
                            // 故障自愈/容错设计 (fail-open)：Redis 挂掉时记录错误，但不阻断用户流量，保证系统高可用
                            error!("❌ Redis 校验 jti 黑名单异常: {:?}，执行安全降级 (放行)", e);
                        }
                    }
                }

                // userId → jti 映射由 Portal（Token 签发方）维护
                // Gateway 职责：jti 黑名单检查（已完成）+ 注入身份 header

                ctx.auth_header = Some(format!("Bearer {}", token));
                ctx.user_id = Some(token_data.claims.sub);
                ctx.user_jti = Some(token_data.claims.jti);
                true
            }
            Err(e) => {
                warn!("JWT 载荷校验失败: {:?}", e);
                false
            }
        }
    }

    /// 统一鉴权失败拦截处理器
    async fn handle_auth_failure(&self, session: &mut Session) -> Result<bool> {
        let method = session.req_header().method.as_str();
        let accept = session
            .get_header("Accept")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");
        let has_rsc = session.get_header("RSC").is_some() || session.get_header("rsc").is_some();

        if should_redirect_to_login(method, accept, has_rsc) {
            let path = session.req_header().uri.path();
            let mut current_url = path.to_owned();
            if let Some(query) = session.req_header().uri.query() {
                current_url.push('?');
                current_url.push_str(query);
            }
            let callback_url = urlencoding::encode(&current_url);
            let redirect_url = format!("/login?callbackUrl={}", callback_url);

            info!(
                "页面未授权 GET 导航，网关执行 302 重定向至: {}",
                redirect_url
            );
            let mut header = ResponseHeader::build(302, None)?;
            header.insert_header("Location", redirect_url)?;
            session.set_keepalive(None);
            session
                .write_response_header(Box::new(header), true)
                .await?;
            return Ok(true);
        }

        info!("接口或异步 RPC 未授权访问，网关执行 401 强拦截");
        let mut header = ResponseHeader::build(401, None)?;
        header.insert_header("WWW-Authenticate", "Bearer")?;
        session
            .write_response_header(Box::new(header), true)
            .await?;
        Ok(true)
    }

    /// 向 Portal 发起 Access Token 静默续签（请求 B）
    ///
    /// 上行：Gateway → Portal  POST /api/auth/refresh + Cookie: portal_refresh_token={rt}
    /// 下行：Portal → Gateway  响应 Set-Cookie 含新 AT + RT
    ///
    /// 返回 Some((new_at, new_rt)) 或 None（续签失败不阻断请求）
    async fn try_refresh_token(&self, refresh_token: &str, sub: &str) -> Option<(String, String)> {
        // 1. 检查进程内去重缓存（30s 内同用户复用结果，防止并发轮换）
        {
            let cache = self.refresh_dedup.lock().unwrap();
            if let Some((at, rt, ts)) = cache.get(sub) {
                if ts.elapsed().as_secs() < REFRESH_DEDUP_SEC {
                    debug!("续签去重命中: sub={}", sub);
                    return Some((at.clone(), rt.clone()));
                }
            }
        }

        // 2. 向 Portal 发起续签请求（URL 通过 OIDC Discovery 动态获取，回退到默认路径）
        let url = self
            .jwks_cache
            .get_refresh_endpoint()
            .and_then(|endpoint| {
                crate::jwks::JwksCache::resolve_jwks_url(&self.upstream_addr, &endpoint).ok()
            })
            .unwrap_or_else(|| format!("http://{}/api/auth/refresh", self.upstream_addr));
        debug!("发起静默续签: url={}, sub={}", url, sub);

        let response = self
            .http_client
            .post(&url)
            .header("Cookie", format!("portal_refresh_token={}", refresh_token))
            .send()
            .await;

        match response {
            Ok(resp) if resp.status().is_success() => {
                // 3. 解析响应 Set-Cookie 头，提取新 AT / RT
                let mut new_at = None;
                let mut new_rt = None;

                for header_value in resp.headers().get_all("set-cookie").iter() {
                    if let Ok(cookie_str) = header_value.to_str() {
                        if let Some(val) = extract_cookie_value(cookie_str, "portal_jwt_token") {
                            new_at = Some(val.to_string());
                        }
                        if let Some(val) = extract_cookie_value(cookie_str, "portal_refresh_token")
                        {
                            new_rt = Some(val.to_string());
                        }
                    }
                }

                if let (Some(at), Some(rt)) = (new_at, new_rt) {
                    info!("静默续签成功: sub={}", sub);
                    // 4. 更新去重缓存
                    {
                        let mut cache = self.refresh_dedup.lock().unwrap();
                        if cache.len() > 1000 {
                            cache.clear();
                        }
                        cache.insert(sub.to_string(), (at.clone(), rt.clone(), Instant::now()));
                    }
                    Some((at, rt))
                } else {
                    warn!("续签响应缺少预期的 Set-Cookie 头: sub={}", sub);
                    None
                }
            }
            Ok(resp) => {
                warn!(
                    "续签请求被 Portal 拒绝: status={}, sub={}",
                    resp.status(),
                    sub
                );
                None
            }
            Err(e) => {
                warn!("续签请求网络错误: {}, sub={}", e, sub);
                None
            }
        }
    }
} // impl Gateway

/// 零拷贝提取 Cookie 中的 portal_jwt_token 并剥离可能的双引号
///
/// # 参数
/// * `cookie_header` - 原始的 Cookie 请求头字符串
fn extract_token_from_cookie<'a>(cookie_header: &'a str) -> Option<&'a str> {
    cookie_header.split(';').find_map(|cookie_str| {
        let trimmed = cookie_str.trim();
        trimmed.strip_prefix("portal_jwt_token=").map(|mut val| {
            // 容错剥离可能的双引号包裹（RFC 6265）
            if val.starts_with('"') && val.ends_with('"') && val.len() >= 2 {
                val = &val[1..val.len() - 1];
            }
            val
        })
    })
}

/// 网关请求上下文类型，用于在代理的生命周期中传递已解析或已格式化的数据
#[derive(Default, Debug)]
pub struct GatewayCtx {
    /// 预格式化好的 Authorization 头部值（例如 "Bearer <token>"）
    pub auth_header: Option<String>,
    /// 用户 ID (从 JWT Claims.sub 提取，供微服务直接使用)
    pub user_id: Option<String>,
    /// JWT 唯一标识 (从 JWT Claims.jti 提取，方便微服务校验拉黑状态)
    pub user_jti: Option<String>,
    /// 续签得到的新 Token 对 (new_access_token, new_refresh_token)
    pub refreshed_tokens: Option<(String, String)>,
    /// 客户端真实 IP（从 X-Forwarded-For 提取，由 Gateway 统一注入）
    pub client_ip: Option<String>,
    /// 客户端 User-Agent（由 Gateway 统一注入）
    pub client_ua: Option<String>,
}

#[async_trait]
impl ProxyHttp for Gateway {
    type CTX = GatewayCtx;
    fn new_ctx(&self) -> Self::CTX {
        GatewayCtx::default()
    }

    async fn upstream_peer(
        &self,
        session: &mut Session,
        _ctx: &mut Self::CTX,
    ) -> Result<Box<HttpPeer>> {
        let host = session
            .get_header("Host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("");

        debug!("接收代理请求，Host: {}", host);

        // 优雅处理上游节点选择失败的异常，避免在极端的无上游节点可用时触发工作线程 Panic 崩溃。
        // 改为返回 502 错误，保证网关服务整体高可用与容错能力。
        let peer = self.portal_lb.select(b"", 256).ok_or_else(|| {
            Error::explain(
                ErrorType::HTTPStatus(502),
                "gateway: 无可用 Portal 上游节点，请检查配置文件中的 upstream 设置",
            )
        })?;
        debug!("路由至 Portal 上游: {:?}", peer);
        Ok(Box::new(HttpPeer::new(peer, false, "portal".to_string())))
    }

    async fn request_filter(&self, session: &mut Session, ctx: &mut Self::CTX) -> Result<bool> {
        let path = session.req_header().uri.path();

        // 0. 提取客户端 IP（优先 X-Forwarded-For）和 User-Agent，统一注入给 Portal
        ctx.client_ip = session
            .get_header("X-Forwarded-For")
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.split(',').next().map(|s| s.trim().to_string()));
        ctx.client_ua = session
            .get_header("User-Agent")
            .and_then(|v| v.to_str().ok())
            .map(|s| s.to_string());

        // 1. 静态资产直接放行（不限流、不验签）
        if path.starts_with("/_next/") || path.starts_with("/static/") {
            return Ok(false);
        }

        // 2. 对 /api/auth/ 路径做 IP 速率限制（防暴力破解 + DDoS）
        if path.starts_with("/api/auth/") {
            if let Some(limit) = RateLimiter::select_limit(path) {
                let ip = ctx.client_ip.as_deref().unwrap_or("unknown");
                let (allowed, _remaining) = self.rate_limiter.check(ip, limit);
                if !allowed {
                    warn!("速率限制触发: ip={}, path={}", ip, path);
                    let mut header = ResponseHeader::build(429, None)?;
                    header.insert_header("Retry-After", "60")?;
                    session
                        .write_response_header(Box::new(header), true)
                        .await?;
                    return Ok(true);
                }
            }
        }

        // 3. 白名单放行路由（不验签、不续签、不剥离 Cookie）
        if self.path_matcher.is_public(path) {
            return Ok(false);
        }

        // 4. 提取 JWT 凭证 (零拷贝解包)
        let token = session
            .get_header("Cookie")
            .and_then(|v| v.to_str().ok())
            .and_then(|h| extract_token_from_cookie(h));

        let token = match token {
            Some(t) => t,
            // 未携带凭证，执行鉴权失败阻断
            None => return self.handle_auth_failure(session).await,
        };

        // 5. 执行离线密码学 ES256 签名校验与发行方比对
        if !self.verify_jwt(token, ctx).await {
            return self.handle_auth_failure(session).await;
        }

        // 6. 检查 Access Token 是否即将过期，若是则静默续签
        let now_sec = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        let needs_refresh = decode_jwt_payload(token)
            .map(|claims| claims.exp as i64 - now_sec < REFRESH_THRESHOLD_SEC)
            .unwrap_or(false);

        if needs_refresh {
            let cookie_header = session.get_header("Cookie").and_then(|v| v.to_str().ok());

            let refresh_token = cookie_header.and_then(|h| extract_refresh_token_from_cookie(h));

            if let (Some(rt), Some(sub)) = (refresh_token, &ctx.user_id) {
                if let Some((new_at, new_rt)) = self.try_refresh_token(rt, sub).await {
                    // 解码新 AT 的 payload，更新 ctx 中的身份信息
                    if let Some(new_claims) = decode_jwt_payload(&new_at) {
                        ctx.auth_header = Some(format!("Bearer {}", new_at));
                        ctx.user_id = Some(new_claims.sub);
                        ctx.user_jti = Some(new_claims.jti);
                        ctx.refreshed_tokens = Some((new_at, new_rt));
                    }
                }
                // 续签失败：静默继续，旧 AT 仍有效
            }
        }

        Ok(false)
    }

    async fn upstream_request_filter(
        &self,
        session: &mut Session,
        upstream_request: &mut RequestHeader,
        ctx: &mut Self::CTX,
    ) -> Result<()> {
        upstream_request.insert_header("X-Forwarded-Proto", "https")?;
        if let Some(host) = session.get_header("Host") {
            upstream_request.insert_header("Host", host)?;
            upstream_request.insert_header("X-Forwarded-Host", host)?;
        }

        let path = session.req_header().uri.path();

        // 微服务路由：移除全部 Cookie，清除伪造的身份 Header
        if is_microservice_route(path) {
            upstream_request.remove_header("Cookie");
            if ctx.auth_header.is_none() {
                upstream_request.remove_header("Authorization");
                upstream_request.remove_header("X-User-Id");
                upstream_request.remove_header("X-User-Jti");
            }
        } else if !self.path_matcher.is_public(path) {
            // 非公开路径（Gateway 已验签）：剥离 RT cookie，必要时替换 AT
            // 读取当前 Cookie 头
            if let Some(cookie_val) = upstream_request.headers.get("Cookie") {
                if let Ok(cookie_str) = cookie_val.to_str() {
                    // 剥离 portal_refresh_token（RT 不应暴露给 Portal 的非 refresh 端点）
                    let mut new_cookie =
                        remove_cookie_from_header(cookie_str, "portal_refresh_token");
                    // 若续签成功，替换 portal_jwt_token 为新 AT
                    if let Some((ref new_at, _)) = ctx.refreshed_tokens {
                        new_cookie =
                            replace_cookie_in_header(&new_cookie, "portal_jwt_token", new_at);
                    }
                    upstream_request.insert_header("Cookie", new_cookie)?;
                }
            }
        }
        // 公开路径（含 /api/auth/refresh）：Cookie 透传，不做任何修改

        if let Some(ref auth_header) = ctx.auth_header {
            upstream_request.insert_header("Authorization", auth_header.as_str())?;
        }

        if let Some(ref user_id) = ctx.user_id {
            upstream_request.insert_header("X-User-Id", user_id.as_str())?;
        }
        if let Some(ref user_jti) = ctx.user_jti {
            upstream_request.insert_header("X-User-Jti", user_jti.as_str())?;
        }
        if let Some(ref client_ip) = ctx.client_ip {
            upstream_request.insert_header("X-Client-IP", client_ip.as_str())?;
        }
        if let Some(ref client_ua) = ctx.client_ua {
            upstream_request.insert_header("X-Client-UA", client_ua.as_str())?;
        }

        Ok(())
    }

    /// 下行响应过滤：若在 request_filter 中完成了续签，则将新 Token 以 Set-Cookie 下发给浏览器
    async fn response_filter(
        &self,
        session: &mut Session,
        upstream_response: &mut ResponseHeader,
        ctx: &mut Self::CTX,
    ) -> Result<()> {
        if let Some((ref new_at, ref new_rt)) = ctx.refreshed_tokens {
            // Secure 标记：非 localhost 时启用（与 Portal 的 cookie 设置逻辑一致）
            let host = session
                .get_header("Host")
                .and_then(|h| h.to_str().ok())
                .unwrap_or("");
            let secure = !host.contains("localhost") && !host.contains("127.0.0.1");
            let secure_str = if secure { "; Secure" } else { "" };

            let at_cookie = format!(
                "portal_jwt_token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600{}",
                new_at, secure_str
            );
            let rt_cookie = format!(
                "portal_refresh_token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800{}",
                new_rt, secure_str
            );

            upstream_response.append_header("Set-Cookie", at_cookie)?;
            upstream_response.append_header("Set-Cookie", rt_cookie)?;

            info!("下行注入续签 Set-Cookie: sub={:?}", ctx.user_id);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_public_asset_or_route() {
        let public_paths = vec![
            "/login".to_string(),
            "/register".to_string(),
            "/error".to_string(),
            "/".to_string(),
            "/api/auth/".to_string(),
            "/oauth2/".to_string(),
            "/.well-known/".to_string(),
        ];
        let matcher = PathMatcher::new(Some(public_paths));

        // 静态目录资产放行
        assert!(matcher.is_public("/_next/static/chunks/main.js"));
        assert!(matcher.is_public("/static/images/logo.png"));

        // 静态资源文件扩展名放行
        assert!(matcher.is_public("/favicon.ico"));
        assert!(matcher.is_public("/logo.PNG")); // 测试大小写不敏感
        assert!(matcher.is_public("/robots.txt"));
        assert!(matcher.is_public("/site.webmanifest.json"));

        // 公开页面和认证接口放行 (前缀或精确相等)
        assert!(matcher.is_public("/login"));
        assert!(matcher.is_public("/register"));
        assert!(matcher.is_public("/error"));
        assert!(matcher.is_public("/"));
        assert!(matcher.is_public("/api/auth/session"));
        assert!(matcher.is_public("/oauth2/authorize"));
        assert!(matcher.is_public("/.well-known/jwks.json"));

        // 受保护的管理页面和路由应该拦截 (返回 false)
        assert!(!matcher.is_public("/dashboard"));
        assert!(!matcher.is_public("/dashboard/users"));
        assert!(!matcher.is_public("/profile"));
        assert!(!matcher.is_public("/api/v1/users"));
    }

    #[test]
    fn test_should_redirect_to_login() {
        assert!(should_redirect_to_login(
            "GET",
            "text/html,application/xhtml+xml",
            false
        ));
        assert!(should_redirect_to_login("get", "text/html", false));
        assert!(!should_redirect_to_login("POST", "text/html", false));
        assert!(!should_redirect_to_login("GET", "application/json", false));
        assert!(!should_redirect_to_login("GET", "text/html", true));
    }

    #[test]
    fn test_is_microservice_route() {
        assert!(is_microservice_route("/api/v1/users"));
        assert!(is_microservice_route("/api/v1/products/123"));
        assert!(!is_microservice_route("/api/auth/session"));
        assert!(!is_microservice_route("/api/v1/auth/login"));
        assert!(!is_microservice_route("/dashboard"));
        assert!(!is_microservice_route("/_next/data/xxx.json"));
    }

    #[tokio::test]
    async fn test_verify_jwt_successful() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        // 1. 初始化 JwksCache 与 Gateway
        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();

        // 模拟 OIDC metadata，配置支持对称加密算法 HS256 进行测试
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

        // 模拟写入公钥缓存（测试时以 HS256 对称密钥替代）
        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
            redis_conn: None,
            http_client: reqwest::Client::new(),
            upstream_addr: "127.0.0.1:4100".to_string(),
            refresh_dedup: Mutex::new(HashMap::new()),
            rate_limiter: Arc::new(RateLimiter::new()),
        };

        // 2. 生成合法的 HS256 Token
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: issuer.clone(),
            aud: "portal-client".to_string(),
            exp: (now + 3600) as usize,
            jti: "jti-123".to_string(),
            roles: vec!["ADMIN".to_string()],
            permissions: vec!["user:list".to_string()],
            dept_ids: vec!["dept-1".to_string()],
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid);
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        // 3. 执行验签
        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 4. 断言结果与安全上下文注入
        assert!(result);
        assert_eq!(ctx.user_id, Some("user-123".to_string()));
        assert_eq!(ctx.user_jti, Some("jti-123".to_string()));
        assert_eq!(ctx.auth_header, Some(format!("Bearer {}", token)));
    }

    #[tokio::test]
    async fn test_verify_jwt_expired() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
            redis_conn: None,
            http_client: reqwest::Client::new(),
            upstream_addr: "127.0.0.1:4100".to_string(),
            refresh_dedup: Mutex::new(HashMap::new()),
            rate_limiter: Arc::new(RateLimiter::new()),
        };

        // 生成过期 Token
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: issuer.clone(),
            aud: "portal-client".to_string(),
            exp: (now - 600) as usize, // 10分钟前已过期
            jti: "jti-123".to_string(),
            roles: vec![],
            permissions: vec![],
            dept_ids: vec![],
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid);
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 应验证失败
        assert!(!result);
    }

    #[tokio::test]
    async fn test_verify_jwt_invalid_issuer() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid.clone(), DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
            redis_conn: None,
            http_client: reqwest::Client::new(),
            upstream_addr: "127.0.0.1:4100".to_string(),
            refresh_dedup: Mutex::new(HashMap::new()),
            rate_limiter: Arc::new(RateLimiter::new()),
        };

        // 错误发行方 (issuer)
        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: "https://hacker.com".to_string(),
            aud: "portal-client".to_string(),
            exp: (now + 3600) as usize,
            jti: "jti-123".to_string(),
            roles: vec![],
            permissions: vec![],
            dept_ids: vec![],
        };
        let mut header = Header::new(Algorithm::HS256);
        header.kid = Some(kid);
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 应验证失败
        assert!(!result);
    }

    #[test]
    fn test_extract_refresh_token_from_cookie() {
        let header = "portal_jwt_token=abc.def; portal_refresh_token=rrr.ttt; other=val";
        assert_eq!(extract_refresh_token_from_cookie(header), Some("rrr.ttt"));
        // 无双引号剥离
        assert_eq!(
            extract_refresh_token_from_cookie("portal_refresh_token=simple"),
            Some("simple")
        );
        // RT 不存在
        assert_eq!(
            extract_refresh_token_from_cookie("portal_jwt_token=abc; other=val"),
            None
        );
    }

    #[test]
    fn test_extract_cookie_value() {
        let set_cookie =
            "portal_jwt_token=eyJ.xxx; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=3600";
        assert_eq!(
            extract_cookie_value(set_cookie, "portal_jwt_token"),
            Some("eyJ.xxx")
        );
        assert_eq!(
            extract_cookie_value(set_cookie, "portal_refresh_token"),
            None
        );
    }

    #[test]
    fn test_remove_cookie_from_header() {
        let header = "portal_jwt_token=abc; portal_refresh_token=rrr; other=val";
        let result = remove_cookie_from_header(header, "portal_refresh_token");
        assert!(result.contains("portal_jwt_token=abc"));
        assert!(result.contains("other=val"));
        assert!(!result.contains("portal_refresh_token"));
    }

    #[test]
    fn test_replace_cookie_in_header() {
        let header = "portal_jwt_token=old; portal_refresh_token=rrr";
        let result = replace_cookie_in_header(header, "portal_jwt_token", "new");
        assert!(result.contains("portal_jwt_token=new"));
        assert!(!result.contains("portal_jwt_token=old"));
        assert!(result.contains("portal_refresh_token=rrr"));
    }

    #[test]
    fn test_replace_cookie_append_when_missing() {
        let header = "portal_refresh_token=rrr";
        let result = replace_cookie_in_header(header, "portal_jwt_token", "new");
        assert!(result.contains("portal_jwt_token=new"));
        assert!(result.contains("portal_refresh_token=rrr"));
    }

    #[test]
    fn test_decode_jwt_payload() {
        use jsonwebtoken::{EncodingKey, Header, encode};
        let secret = b"sufficiently-long-secret-key-for-hs256!!";
        let claims = Claims {
            sub: "user-1".to_string(),
            iss: "test".to_string(),
            aud: "test".to_string(),
            exp: 9999999999usize,
            jti: "jti-1".to_string(),
            roles: vec!["ADMIN".to_string()],
            permissions: vec!["read".to_string()],
            dept_ids: vec!["dept-1".to_string()],
        };
        let token = encode(
            &Header::new(Algorithm::HS256),
            &claims,
            &EncodingKey::from_secret(secret),
        )
        .unwrap();
        let decoded = decode_jwt_payload(&token).unwrap();
        assert_eq!(decoded.sub, "user-1");
        assert_eq!(decoded.exp, 9999999999usize);
        assert_eq!(decoded.jti, "jti-1");
        assert_eq!(decoded.roles, vec!["ADMIN"]);
    }

    #[test]
    fn test_decode_jwt_payload_invalid() {
        assert!(decode_jwt_payload("not.a.jwt").is_none());
        assert!(decode_jwt_payload("").is_none());
    }

    #[tokio::test]
    async fn test_verify_jwt_invalid_kid() {
        use crate::claims::Claims;
        use crate::jwks::OidcMetadata;
        use jsonwebtoken::{DecodingKey, EncodingKey, Header, encode};

        let jwks_cache = JwksCache::new();
        let issuer = "https://sso.example.com".to_string();
        jwks_cache.set_metadata_for_test(OidcMetadata {
            issuer: Some(issuer.clone()),
            jwks_uri: Some("https://sso.example.com/api/auth/jwks".into()),
            id_token_signing_alg_values_supported: vec!["HS256".into()],
            refresh_endpoint: None,
        });

        let secret = b"super-secret-key-that-is-long-enough-for-hs256";
        let kid = "key-test-1".to_string();
        jwks_cache.insert_key_for_test(kid, DecodingKey::from_secret(secret));

        let portal_lb = Arc::new(LoadBalancer::try_from_iter(["127.0.0.1:4100"]).unwrap());
        let gateway = Gateway {
            portal_lb,
            jwks_cache: Arc::clone(&jwks_cache),
            issuer: issuer.clone(),
            path_matcher: PathMatcher::new(None),
            redis_conn: None,
            http_client: reqwest::Client::new(),
            upstream_addr: "127.0.0.1:4100".to_string(),
            refresh_dedup: Mutex::new(HashMap::new()),
            rate_limiter: Arc::new(RateLimiter::new()),
        };

        let now = std::time::SystemTime::now()
            .duration_since(std::time::SystemTime::UNIX_EPOCH)
            .unwrap()
            .as_secs();
        let claims = Claims {
            sub: "user-123".to_string(),
            iss: issuer.clone(),
            aud: "portal-client".to_string(),
            exp: (now + 3600) as usize,
            jti: "jti-123".to_string(),
            roles: vec![],
            permissions: vec![],
            dept_ids: vec![],
        };
        let mut header = Header::new(Algorithm::HS256);
        // 使用一个未在缓存中登记的 kid
        header.kid = Some("unknown-kid".to_string());
        let token = encode(&header, &claims, &EncodingKey::from_secret(secret)).unwrap();

        let mut ctx = GatewayCtx::default();
        let result = gateway.verify_jwt(&token, &mut ctx).await;

        // 应验证失败
        assert!(!result);
    }
}

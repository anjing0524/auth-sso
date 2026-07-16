//! Token 静默续签，包含 HTTP 调用与 Redis 去重。
//!
//! [`TokenRefresher`] 持有 JWKS 缓存（用于获取 OIDC refresh_endpoint）
//! 和上游地址列表（用于回退），Redis 操作通过 [`crate::redis`] 模块函数完成。

use serde::Deserialize;
use std::sync::Arc;
use tracing::{debug, info, warn};

use crate::config::Upstreams;
use crate::cookie;
use crate::http::{HTTP_CLIENT, hmac_sha256_hex};
use crate::jwks::JwksCache;

use super::RefreshedTokens;

/// Portal `/api/auth/refresh` 端点返回的 JSON 响应结构。
///
/// Gateway 优先解析 JSON body 获取续签后的 Token 对；Portal 仅在验证请求确实
/// 来自受信任的 Gateway（HMAC 签名，见 [`TokenRefresher::try_endpoint`]）后才在
/// body 中回传 token，故浏览器直连拿不到明文 token。JSON body 缺失 token 时
/// 回退到 Set-Cookie 头解析（兼容尚未升级的旧版 Portal）。
///
/// `#[serde(rename_all = "camelCase")]` 使蛇形字段映射到 camelCase JSON key。
/// 未知字段（如 `expiresIn`）由 serde 默认忽略，无需声明。
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct TokenRefreshJsonResponse {
    #[serde(default)]
    access_token: Option<String>,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    skipped: Option<bool>,
}

impl TokenRefreshJsonResponse {
    fn access_token(&self) -> Option<&str> {
        self.access_token.as_deref()
    }

    fn refresh_token(&self) -> Option<&str> {
        self.refresh_token.as_deref()
    }

    fn is_skipped(&self) -> bool {
        self.skipped.unwrap_or(false)
    }
}

/// 同用户续签去重窗口（秒），防止并发请求反复轮换 Refresh Token
const REFRESH_DEDUP_SEC: u64 = 30;

/// Redis 续签去重 key 前缀
const REFRESH_DEDUP_PREFIX: &str = "portal:refresh_dedup:";

/// Token 静默续签器。
///
/// 先尝试 OIDC Discovery 缓存的主端点，失败后遍历全部 upstream 逐一回退。
/// 通过 Redis SET NX EX 原子抢占实现 30s 跨实例去重。
#[derive(Debug)]
pub struct TokenRefresher {
    jwks_cache: Arc<JwksCache>,
    upstreams: Arc<Upstreams>,
    /// 内部上游请求协议（http/https），启动期由 main.rs 显式注入
    upstream_scheme: String,
    /// 与 Portal 共享的 HMAC 密钥（Option 表示未启用）。用于向 Portal 证明
    /// 续签请求确实来自受信任的 Gateway，使 Portal 允许在 JSON body 回传 token。
    gateway_shared_secret: Option<String>,
}

impl TokenRefresher {
    pub fn new(
        jwks_cache: Arc<JwksCache>,
        upstreams: Arc<Upstreams>,
        upstream_scheme: String,
        gateway_shared_secret: Option<String>,
    ) -> Self {
        Self {
            jwks_cache,
            upstreams,
            upstream_scheme,
            gateway_shared_secret,
        }
    }

    /// 向 Portal 发起 Access Token 静默续签。
    ///
    /// 返回 `Some(RefreshedTokens)` 或 `None`（续签失败不阻断请求，旧 AT 仍有效）。
    ///
    /// # 去重语义
    ///
    /// 先以 SET NX EX **原子抢占** 30s 去重锁（服务端单命令，无 TOCTOU 窗口）：
    /// - 未抢到 → 30s 窗口内已有续签在进行/刚完成，放弃本次续签
    /// - 抢到但全部端点失败 → DEL 释放锁，允许下次请求立即重试
    /// - 抢到且成功 → 保留锁至 TTL 自然过期（即 30s 去重窗口）
    ///
    /// 锁仅存固定标记 "1"，不含任何 token 明文，消除 Redis 中的 token 泄露面。
    ///
    /// # Examples
    ///
    /// ```ignore
    /// # use std::sync::Arc;
    /// # use gateway::jwks::JwksCache;
    /// # use gateway::config::Upstreams;
    /// # use gateway::auth::TokenRefresher;
    /// let cache = Arc::new(JwksCache::new());
    /// let ups = Arc::new(Upstreams::from_config("127.0.0.1:4100"));
    /// let refresher = TokenRefresher::new(cache, ups, "http".to_string(), None);
    /// // 服务未启动时续签返回 None
    /// // let tokens = refresher.try_refresh("rt_value", "user-1").await;
    /// ```
    pub async fn try_refresh(&self, refresh_token: &str, sub: &str) -> Option<RefreshedTokens> {
        let dedup_key = format!("{REFRESH_DEDUP_PREFIX}{sub}");
        // 原子抢占（SET NX EX）：未抢到说明 30s 窗口内已有续签在进行/刚完成
        if !crate::redis::acquire_nx_ex(&dedup_key, "1", REFRESH_DEDUP_SEC).await {
            debug!("续签去重命中 (Redis): sub={}", sub);
            return None;
        }

        // 1. 尝试主端点（来自 OIDC Discovery 缓存）
        if let Some(primary) = self.primary_endpoint()
            && let Some(tokens) = self.try_endpoint(&primary, refresh_token, sub).await
        {
            return Some(tokens);
        }

        // 2. 回退：遍历全部 upstream 的默认续签路径
        if self.upstreams.is_empty() {
            warn!(
                "无法续签: OIDC 元数据未就绪且未配置任何 upstream，放弃续签 sub={}",
                sub
            );
            crate::redis::del(&dedup_key).await;
            crate::metrics::inc_refresh_failure();
            return None;
        }

        for upstream in self.upstreams.iter() {
            let fallback_url = format!("{}://{}/api/auth/refresh", self.upstream_scheme, upstream);
            if let Some(tokens) = self.try_endpoint(&fallback_url, refresh_token, sub).await {
                return Some(tokens);
            }
        }

        // 全部失败：释放锁，下次请求可立即重试
        crate::redis::del(&dedup_key).await;
        crate::metrics::inc_refresh_failure();
        None
    }

    /// OIDC Discovery 缓存中的主续签端点 URL
    fn primary_endpoint(&self) -> Option<Arc<str>> {
        self.jwks_cache.refresh_endpoint()
    }

    /// 向指定续签端点发起 POST 请求提取新 Token 对。
    ///
    /// # 调用方证明（token 泄露面防护）
    ///
    /// 配置了共享密钥时附带 `X-Gateway-Timestamp` + `X-Gateway-Signature`
    /// （payload 为 `refresh:{ts}`，与身份签名 `ts:userId:jti` 域分离）。
    /// Portal 仅在验签通过后才在 JSON body 回传 token 明文——
    /// 浏览器同源脚本无密钥，无法通过此端点读取 HttpOnly 保护的 token。
    ///
    /// # 解析顺序
    ///
    /// 1. JSON body（新版 Portal + 签名通过时的标准协议）
    /// 2. Set-Cookie 头回退（旧版 Portal 或未配置共享密钥的部署，
    ///    保证滚动发布期间新 Gateway + 旧 Portal 的续签不中断）
    async fn try_endpoint(
        &self,
        endpoint: &str,
        refresh_token: &str,
        sub: &str,
    ) -> Option<RefreshedTokens> {
        debug!("发起静默续签: url={}, sub={}", endpoint, sub);
        let mut request = HTTP_CLIENT.post(endpoint).header(
            "Cookie",
            format!("{}={}", cookie::REFRESH_COOKIE, refresh_token),
        );

        // 签名证明调用方是 Gateway（域分离 payload: "refresh:{ts}"）
        if let Some(ref secret) = self.gateway_shared_secret
            && let Ok(d) = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        {
            let ts = d.as_secs().to_string();
            if let Some(sig) = hmac_sha256_hex(secret, &format!("refresh:{ts}")) {
                request = request
                    .header("X-Gateway-Timestamp", &ts)
                    .header("X-Gateway-Signature", sig);
            }
        }

        let response = match request.send().await {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                warn!("续签请求被 Portal 拒绝: status={}, sub={}", r.status(), sub);
                return None;
            }
            Err(e) => {
                warn!("续签请求网络错误: {}, sub={}", e, sub);
                return None;
            }
        };

        // 回退路径素材：在消耗 body 前先提取 Set-Cookie 中的 token 对
        let mut cookie_at = None;
        let mut cookie_rt = None;
        for header_value in response.headers().get_all("set-cookie").iter() {
            if let Ok(sc) = header_value.to_str() {
                if let Some(v) = cookie::extract_from_set_cookie(sc, cookie::ACCESS_COOKIE) {
                    cookie_at = Some(v.to_string());
                }
                if let Some(v) = cookie::extract_from_set_cookie(sc, cookie::REFRESH_COOKIE) {
                    cookie_rt = Some(v.to_string());
                }
            }
        }

        // 方案一：JSON body 解析（新版 Portal，签名通过时回传 token）
        let body_bytes = response.text().await.ok()?;
        if let Ok(json) = serde_json::from_str::<TokenRefreshJsonResponse>(&body_bytes) {
            if json.is_skipped() {
                debug!("续签跳过（AT 剩余时间充足）: sub={}", sub);
                return None;
            }
            if let (Some(access), Some(refresh)) = (json.access_token(), json.refresh_token()) {
                info!("静默续签成功 (JSON): sub={}", sub);
                crate::metrics::inc_refresh_success();
                return Some(RefreshedTokens {
                    access: access.to_string(),
                    refresh: refresh.to_string(),
                });
            }
        }

        // 方案二：Set-Cookie 回退（旧版 Portal 只在 Set-Cookie 下发 token）
        if let (Some(access), Some(refresh)) = (cookie_at, cookie_rt) {
            info!("静默续签成功 (Set-Cookie 回退): sub={}", sub);
            crate::metrics::inc_refresh_success();
            return Some(RefreshedTokens { access, refresh });
        }

        warn!(
            "续签响应无法提取 token（JSON 与 Set-Cookie 均未命中），body_len={}: sub={}",
            body_bytes.len(),
            sub
        );
        None
    }
}

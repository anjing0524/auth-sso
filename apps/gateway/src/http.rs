#[cfg(feature = "self-managed-tls")]
use std::net::Ipv6Addr;
#[cfg(feature = "self-managed-tls")]
use std::str::FromStr;
use std::sync::LazyLock;
use std::time::Duration;

use bytes::Bytes;
use hmac::{Hmac, Mac};
use pingora_core::Result;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_proxy::Session;
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// 计算 HMAC-SHA256 并以十六进制字符串返回（Gateway → Portal 信任路径统一签名原语）。
///
/// 返回 `None` 仅在密钥转 MAC 实例失败时（HMAC 接受任意长度密钥，实践中不发生），
/// 供 gateway.rs 身份签名与 auth::refresh 续签签名共用，避免重复实现。
pub(crate) fn hmac_sha256_hex(secret: &str, payload: &str) -> Option<String> {
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes()).ok()?;
    mac.update(payload.as_bytes());
    Some(hex::encode(mac.finalize().into_bytes()))
}

/// 定长摘要后的恒定时间字符串比较（H-33 metrics 共享密钥校验专用）。
///
/// 直接 `String == String` 是短路逐字节比较，理论上可通过响应时间泄漏
/// “已匹配前缀长度”。这里先各自 SHA-256 归一化为**固定 32 字节**，再逐字节
/// 累积 XOR（无提前退出），使比较耗时与输入内容无关；长度差异也因摘要定长
/// 而不会走分支。无新增依赖（复用已有 `sha2`）。
pub(crate) fn constant_time_eq(left: &str, right: &str) -> bool {
    use sha2::Digest;
    let left_digest = Sha256::digest(left.as_bytes());
    let right_digest = Sha256::digest(right.as_bytes());
    let mut diff = 0u8;
    for (left_byte, right_byte) in left_digest.iter().zip(right_digest.iter()) {
        diff |= left_byte ^ right_byte;
    }
    diff == 0
}

// ── Host 头解析 ──

/// 从 `Host` 头值中剥离端口号，仅返回主机部分（零拷贝切片）。
///
/// 处理三种形态：
/// - IPv6 字面量（RFC 3986 规范，带方括号）：`[::1]:18080` → `[::1]`（以 `]` 定界）
/// - 裸 IPv6（无方括号但可解析为合法 `Ipv6Addr`）：`::1` → `::1`（整体视为主机）
/// - 普通主机 / IPv4：`localhost:18080` → `localhost`（以首个 `:` 定界）
///
/// 无端口时原样返回。该逻辑由 `redirect.rs` 与 `gateway.rs` 的 Secure 判定共享。
///
/// 注意：裸 IPv6 分支用 `Ipv6Addr::from_str` 严格校验，避免把含多个冒号的畸形
/// 输入（如 `a:b:c`、`:::`）误当作 IPv6 而跳过端口剥离。
#[cfg(feature = "self-managed-tls")]
pub fn host_only(host: &str) -> &str {
    if host.starts_with('[') {
        // 规范 IPv6 字面量：截到闭合方括号（含），其后为端口
        host.find(']').map_or(host, |end| &host[..=end])
    } else if Ipv6Addr::from_str(host).is_ok() {
        // 裸 IPv6（可解析为合法地址）：整体为主机，Host 头中不应出现端口
        host
    } else {
        // 普通主机 / IPv4：截到首个冒号
        host.find(':').map_or(host, |i| &host[..i])
    }
}

/// 判断请求是否为 HTML 页面导航（GET + Accept: text/html + 无 RSC header）
pub fn is_html_page_navigation(req: &RequestHeader) -> bool {
    let is_get = req.method.as_str().eq_ignore_ascii_case("GET");
    // HeaderMap 查找本身大小写不敏感（存储名已归一化小写），无需双写回退
    let is_html = req
        .headers
        .get("accept")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|a| a.contains("text/html"));
    let is_rsc = req.headers.get("rsc").is_some();
    is_get && is_html && !is_rsc
}

/// 获取当前 Unix 时间戳（秒），系统时钟异常时返回 `None`。
///
/// 统一替代分散在各模块中的 `SystemTime::now().duration_since(UNIX_EPOCH)`。
pub(crate) fn unix_secs() -> Option<u64> {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|d| d.as_secs())
}

// ── 全局 HTTP 客户端 ──

/// 全局 reqwest HTTP 客户端单例（内置连接池，全局复用）。
///
/// 供 `jwks` 和 `auth` 模块共享，统一超时策略（5s 连接超时）。
///
/// panic 策略：`reqwest::Client::builder().build()` 仅在 TLS 后端初始化失败时
/// 返回 `Err`（如系统 CA 证书缺失）。这在网关环境中属于无法恢复的配置错误，
/// 进程应在此处失败停止（fail-fast），不继续运行。
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("全局 HTTP 客户端初始化失败——检查系统 TLS/CA 证书配置")
});

// ── Session 扩展 ──

/// 针对 Pingora Session 的高阶 HTTP 操作扩展特质
///
/// 仅用于为外部类型 `Session` 添加方法，从不进行动态分发。
/// 手动 desugar async fn → `impl Future` 以精确控制 `Send` 约束。
/// 避免 `#[async_trait]` 的 `Box` 堆分配，零开销。
pub trait SessionExt {
    /// 提取真实客户端 IP（socket 对端地址 — Gateway 为 TLS 终结第一跳，
    /// 不信任任何入站 `X-Forwarded-For`/`X-Real-IP` 头）
    fn client_ip(&self) -> Option<String>;

    /// 发送 401 Unauthorized 响应并注入 Bearer WWW-Authenticate 头部
    fn respond_401(&mut self) -> impl std::future::Future<Output = Result<()>> + Send;

    /// 发送 401 并附带 Set-Cookie。
    ///
    /// 用于"Portal 已轮换、但本次请求仍被阻断"的场景：新 Cookie 必须送达浏览器，
    /// 否则它会继续使用已被 Portal 撤销的旧 RT（下次续签命中复用检测 → 家族级联撤销）。
    fn respond_401_with_cookies(
        &mut self,
        cookies: &[String],
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// 发送 302 重定向响应（含 Set-Cookie 头列表）
    fn respond_302_with_cookies(
        &mut self,
        location: &str,
        cookies: &[String],
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// 发送 429 Too Many Requests 响应并注入 Retry-After 头部
    ///
    /// # 参数
    /// * `retry_after_secs` - 客户端应等待的秒数
    fn respond_429(
        &mut self,
        retry_after_secs: u64,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// 发送 400 Bad Request（纯文本短消息）。
    ///
    /// 入口拒绝共用：HTTP/1.1 缺 Host（H-D-05）与 dot-segment 路径（H-D-03）。
    fn respond_400(&mut self) -> impl std::future::Future<Output = Result<()>> + Send;
}

// ── 响应头构造（纯函数）──
//
// 存在理由（#85）：这些头原先直接构造在 `SessionExt` 的 async 方法里，
// 而 `Session` 需要真实连接才能实例化 ⇒ **四个响应构造器零测试**。
// 把它们抽成纯函数后，"状态码 / Location / Set-Cookie 及其顺序 / Retry-After"
// 可以逐条断言，`SessionExt` 只负责把结果写进 Session。
//
// ⚠️ **顺序有意义**：同名 Set-Cookie 出现多次时**后者生效**（RFC 6265 §5.2），
// 因此"会话 Cookie 与清除 Cookie 的先后"是语义的一部分，不能重排。

/// 401 响应体：与 Portal REST 错误信封同形 `{ error, message }`。
///
/// 存在理由（2026-10-20 实机审计）：此前 401 **只有状态码、没有响应体**，
/// API 调用方拿到空响应无法区分"未认证/过期/权限不足"，也无法展示消息。
/// HTML 页面导航不会看到它（网关对浏览器导航走 302 授权链路），因此对
/// 非 HTML 客户端补上可判别的错误码（`AUTH_SSO_1002 = COMMON_ERRORS.UNAUTHORIZED`）。
pub(crate) const UNAUTHORIZED_BODY: &str =
    r#"{"error":"AUTH_SSO_1002","message":"未认证或会话已过期"}"#;

/// 400 响应体（Host 缺失 / dot-segment 拒绝共用；H-D-05 / H-D-03）。
pub(crate) const BAD_REQUEST_BODY: &str = "Bad Request\n";

/// HSTS 头（H-D-09）：TLS 终结在 Gateway，安全头的正确注入层在此。
///
/// 取值刻意**不含 `includeSubDomains`/`preload`**：本项目可能部署在共享父域下，
/// includeSubDomains 会把策略扩散到不受本网关控制的子域；preload 不可逆。
pub(crate) const HSTS_HEADER: &str = "Strict-Transport-Security";
pub(crate) const HSTS_VALUE: &str = "max-age=31536000";

/// 向响应头注入 HSTS（Gateway 生成的全部响应共用；已存在则不覆盖）。
pub(crate) fn insert_hsts(header: &mut ResponseHeader) -> Result<()> {
    if header.headers.get(HSTS_HEADER).is_none() {
        header.insert_header(HSTS_HEADER, HSTS_VALUE)?;
    }
    Ok(())
}

/// 401 响应头：`WWW-Authenticate: Bearer` + JSON 响应体头 + 逐条 `Set-Cookie`。
pub(crate) fn build_401_headers(cookies: &[String]) -> Result<ResponseHeader> {
    let mut header = ResponseHeader::build(401, None)?;
    header.insert_header("WWW-Authenticate", "Bearer")?;
    header.insert_header("Content-Type", "application/json; charset=utf-8")?;
    header.insert_header("Content-Length", UNAUTHORIZED_BODY.len().to_string())?;
    for cookie in cookies {
        header.append_header("Set-Cookie", cookie.as_str())?;
    }
    insert_hsts(&mut header)?;
    Ok(header)
}

/// 400 响应头：纯文本短消息 + `Content-Length`（H-D-03 / H-D-05 入口拒绝共用）。
pub(crate) fn build_400_headers() -> Result<ResponseHeader> {
    let mut header = ResponseHeader::build(400, None)?;
    header.insert_header("Content-Type", "text/plain; charset=utf-8")?;
    header.insert_header("Content-Length", BAD_REQUEST_BODY.len().to_string())?;
    insert_hsts(&mut header)?;
    Ok(header)
}

/// 302 响应头：`Location` + 逐条 `Set-Cookie`（**保序**）。
pub(crate) fn build_302_headers(location: &str, cookies: &[String]) -> Result<ResponseHeader> {
    let mut header = ResponseHeader::build(302, None)?;
    header.insert_header("Location", location)?;
    for cookie in cookies {
        header.append_header("Set-Cookie", cookie.as_str())?;
    }
    insert_hsts(&mut header)?;
    Ok(header)
}

/// 429 响应头：`Retry-After`。
pub(crate) fn build_429_headers(retry_after_secs: u64) -> Result<ResponseHeader> {
    let mut header = ResponseHeader::build(429, None)?;
    // 用 itoa 栈上格式化替代 to_string() 的堆分配（冷路径，但属范式正确）
    let mut buf = itoa::Buffer::new();
    header.insert_header("Retry-After", buf.format(retry_after_secs))?;
    insert_hsts(&mut header)?;
    Ok(header)
}

impl SessionExt for Session {
    fn client_ip(&self) -> Option<String> {
        self.client_addr()
            .and_then(|a| a.as_inet())
            .map(|inet| inet.ip().to_string())
    }

    async fn respond_401(&mut self) -> Result<()> {
        self.respond_401_with_cookies(&[]).await
    }

    async fn respond_401_with_cookies(&mut self, cookies: &[String]) -> Result<()> {
        let header = build_401_headers(cookies)?;
        self.write_response_header(Box::new(header), false).await?;
        self.write_response_body(Some(Bytes::from_static(UNAUTHORIZED_BODY.as_bytes())), true)
            .await
    }

    async fn respond_302_with_cookies(&mut self, location: &str, cookies: &[String]) -> Result<()> {
        let header = build_302_headers(location, cookies)?;
        // keepalive 是 Session 级副作用，留在 impl（不入纯构造函数）
        self.set_keepalive(None);
        self.write_response_header(Box::new(header), true).await
    }

    async fn respond_429(&mut self, retry_after_secs: u64) -> Result<()> {
        let header = build_429_headers(retry_after_secs)?;
        self.write_response_header(Box::new(header), true).await
    }

    async fn respond_400(&mut self) -> Result<()> {
        let header = build_400_headers()?;
        self.write_response_header(Box::new(header), false).await?;
        self.write_response_body(Some(Bytes::from_static(BAD_REQUEST_BODY.as_bytes())), true)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── HMAC 信任路径：跨语言契约（Gateway 签发 ↔ Portal 校验）──
    //
    // 这些向量是 Gateway（Rust/hmac+hex）与 Portal（TS/WebCrypto）之间的**协议**。
    // 两端若在 payload 构造或 hex 大小写上分叉，Portal 会一律拒绝签名，而症状
    // 只在生产出现（跨语言无编译期交集）。固定向量是唯一能锁住它的手段。

    /// RFC 4231 Test Case 2：校验 HMAC-SHA256 实现本身符合标准
    #[test]
    fn hmac_sha256_matches_rfc4231_vector() {
        let sig = hmac_sha256_hex("Jefe", "what do ya want for nothing?").unwrap();
        assert_eq!(
            sig,
            "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843"
        );
    }

    /// 十六进制必须**小写**：Portal 侧按 hex 解析后逐字节比对，
    /// 大写 hex 会被解析成同样字节从而侥幸通过；但一旦未来改为字符串比对即失效，
    /// 故在此锁定大小写。
    #[test]
    fn hmac_sha256_output_is_lowercase_hex() {
        let sig = hmac_sha256_hex("k", "p").unwrap();
        assert_eq!(sig, sig.to_lowercase());
        assert!(sig.chars().all(|c| c.is_ascii_hexdigit()));
    }

    /// **身份签名 payload 契约**：`{ts}:{user_id}:{user_jti}`
    ///
    /// 对应 `gateway.rs` 的 `format!("{}:{}:{}", ts, id.user_id, id.user_jti)`
    /// 与 Portal `verify-jwt.ts` 的 `` `${timestamp}:${userId}:${jti}` ``。
    #[test]
    fn identity_signature_payload_matches_portal_contract() {
        let secret = "test-gateway-shared-secret-32chars!!";
        let payload = "1700000000:user-abc:jti-xyz";
        assert_eq!(
            hmac_sha256_hex(secret, payload).unwrap(),
            "94f2fd6f848a36f670c19c86e9c9c4893d2e8718b8764f81d368dfc15035cdac"
        );
    }

    /// **续签签名 payload 契约**：`refresh:{ts}`（与身份签名域分离）
    ///
    /// 对应 `auth/refresh.rs` 与 Portal `api/auth/refresh/route.ts`。
    /// 域分离的意义：身份签名的 ts 可信不代表续签的 ts 可信。
    #[test]
    fn refresh_signature_payload_matches_portal_contract() {
        let secret = "test-gateway-shared-secret-32chars!!";
        assert_eq!(
            hmac_sha256_hex(secret, "refresh:1700000000").unwrap(),
            "ccdf7e8a2c1ba718599e5613f22c30fb381a0f88fc37d5c5b3e7d210a998e639"
        );
    }

    /// 两个域的签名必须不同——若相同说明域分离失效
    #[test]
    fn identity_and_refresh_domains_are_separated() {
        let secret = "s";
        let identity = hmac_sha256_hex(secret, "1700000000:u:j").unwrap();
        let refresh = hmac_sha256_hex(secret, "refresh:1700000000").unwrap();
        assert_ne!(identity, refresh);
    }

    /// 密钥为空串时仍能计算（HMAC 接受任意长度密钥）。空密钥意味着共享密钥
    /// 未配置，Portal 侧会直接拒绝，不依赖此处返回 None。
    #[test]
    fn hmac_sha256_accepts_empty_secret() {
        assert!(hmac_sha256_hex("", "payload").is_some());
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn host_only_strips_port() {
        assert_eq!(host_only("localhost:18080"), "localhost");
        assert_eq!(host_only("example.com:443"), "example.com");
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn host_only_keeps_bare_host() {
        assert_eq!(host_only("example.com"), "example.com");
        assert_eq!(host_only("localhost"), "localhost");
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn host_only_handles_ipv6_literal() {
        // 含端口：截到 ] （含方括号）
        assert_eq!(host_only("[::1]:18080"), "[::1]");
        assert_eq!(host_only("[2001:db8::1]:443"), "[2001:db8::1]");
        // 不含端口：原样返回
        assert_eq!(host_only("[2001:db8::1]"), "[2001:db8::1]");
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn host_only_accepts_valid_bare_ipv6() {
        // 合法裸 IPv6：整体视为主机，不剥离
        assert_eq!(host_only("::1"), "::1");
        assert_eq!(host_only("2001:db8::1"), "2001:db8::1");
        assert_eq!(host_only("fe80::1"), "fe80::1");
    }

    #[cfg(feature = "self-managed-tls")]
    #[test]
    fn host_only_rejects_malformed_multi_colon_as_ipv6() {
        // 含多个冒号但非合法 IPv6 的输入：走普通主机分支，按首个冒号剥离
        // （防止畸形输入被误当作 IPv6 而跳过端口剥离）
        assert_eq!(host_only("a:b:c"), "a");
        assert_eq!(host_only(":::"), ""); // 首个字符即冒号 → 截取为空
        assert_eq!(host_only("foo:80:extra"), "foo");
    }

    #[test]
    fn html_navigation_accept_lookup_supports_lowercase_http2_headers() {
        let mut req = RequestHeader::build("GET", b"/dashboard", Some(16)).unwrap();
        req.insert_header("accept", "text/html,application/xhtml+xml")
            .unwrap();
        assert!(is_html_page_navigation(&req));
    }

    #[test]
    fn html_navigation_rsc_header_blocks_navigation_detection_regardless_of_case() {
        let mut req = RequestHeader::build("GET", b"/dashboard", Some(16)).unwrap();
        req.insert_header("accept", "text/html").unwrap();
        req.insert_header("rsc", "1").unwrap();
        assert!(!is_html_page_navigation(&req));
    }

    // ── Session 响应头构造（#85：原先零测试）──────────────────────────
    //
    // 这些头是**安全相关**的下发面：401 的清除 Cookie（漏一条 = 登出后仍持有效会话）、
    // 302 的 `extra_cookies`（漏掉 = 浏览器继续用已被 Portal 撤销的旧 RT，见 #64）。
    // 症状在正常路径下看不出来 —— 响应码与 Location 都对，只有 Cookie 头的内容错了。

    /// 读取响应头里的全部 Set-Cookie（按出现顺序）
    fn set_cookies(header: &ResponseHeader) -> Vec<String> {
        header
            .headers
            .get_all("set-cookie")
            .iter()
            .filter_map(|v| v.to_str().ok().map(str::to_string))
            .collect()
    }

    #[test]
    fn test_build_401_headers_sets_bearer_and_each_cookie_in_order() {
        let header = build_401_headers(&["a=1; Path=/".to_string(), "b=2; Path=/".to_string()])
            .expect("构造应成功");

        assert_eq!(header.status.as_u16(), 401);
        assert_eq!(
            header
                .headers
                .get("www-authenticate")
                .and_then(|v| v.to_str().ok()),
            Some("Bearer")
        );
        // 顺序即语义：同名 Set-Cookie 后者生效，故不得重排
        assert_eq!(set_cookies(&header), vec!["a=1; Path=/", "b=2; Path=/"]);
    }

    #[test]
    fn test_build_401_headers_without_cookies_has_no_set_cookie() {
        let header = build_401_headers(&[]).expect("构造应成功");

        assert_eq!(header.status.as_u16(), 401);
        assert!(set_cookies(&header).is_empty());
        // 401 必须带可判别的 JSON 错误信封（此前是空响应体）
        assert_eq!(
            header
                .headers
                .get("content-type")
                .and_then(|v| v.to_str().ok()),
            Some("application/json; charset=utf-8")
        );
        assert_eq!(
            header
                .headers
                .get("content-length")
                .and_then(|v| v.to_str().ok()),
            Some(UNAUTHORIZED_BODY.len().to_string().as_str())
        );
        assert!(UNAUTHORIZED_BODY.contains("AUTH_SSO_1002"));
    }

    #[test]
    fn test_build_302_headers_sets_location_and_each_cookie_in_order() {
        let header = build_302_headers(
            "/dashboard?tab=1",
            &["jwt=at; Path=/".to_string(), "jwt=; Max-Age=0".to_string()],
        )
        .expect("构造应成功");

        assert_eq!(header.status.as_u16(), 302);
        assert_eq!(
            header.headers.get("location").and_then(|v| v.to_str().ok()),
            Some("/dashboard?tab=1")
        );
        // 会话 Cookie 先、清除 Cookie 后（**后者生效**）——顺序是语义的一部分
        assert_eq!(
            set_cookies(&header),
            vec!["jwt=at; Path=/", "jwt=; Max-Age=0"]
        );
    }

    #[test]
    fn test_build_302_headers_without_cookies_has_no_set_cookie() {
        let header = build_302_headers("/login?error=csrf_mismatch", &[]).expect("构造应成功");

        assert_eq!(header.status.as_u16(), 302);
        assert!(set_cookies(&header).is_empty());
    }

    #[test]
    fn test_build_429_headers_sets_retry_after() {
        for secs in [0_u64, 1, 30, 3600] {
            let header = build_429_headers(secs).expect("构造应成功");

            assert_eq!(header.status.as_u16(), 429);
            assert_eq!(
                header
                    .headers
                    .get("retry-after")
                    .and_then(|v| v.to_str().ok()),
                Some(secs.to_string().as_str()),
                "Retry-After 应为十进制秒数"
            );
        }
    }

    #[test]
    fn test_build_302_headers_keeps_duplicate_cookie_names_by_append_not_replace() {
        // `append_header` 而非 `insert_header`：同名 Cookie 必须**共存且保序**，
        // 否则「清除旧的 + 下发新的」会丢掉其中一条
        let header = build_302_headers(
            "/",
            &["k=old; Path=/".to_string(), "k=new; Path=/".to_string()],
        )
        .expect("构造应成功");

        assert_eq!(set_cookies(&header).len(), 2);
        assert_eq!(set_cookies(&header)[1], "k=new; Path=/");
    }

    // ── H-D-09：TLS 终结层 HSTS（Gateway 生成的全部响应必须携带）────────

    fn hsts(header: &ResponseHeader) -> Option<&str> {
        header
            .headers
            .get(HSTS_HEADER)
            .and_then(|value| value.to_str().ok())
    }

    #[test]
    fn gateway_generated_responses_carry_hsts() {
        assert_eq!(hsts(&build_401_headers(&[]).unwrap()), Some(HSTS_VALUE));
        assert_eq!(
            hsts(&build_302_headers("/login", &[]).unwrap()),
            Some(HSTS_VALUE)
        );
        assert_eq!(hsts(&build_400_headers().unwrap()), Some(HSTS_VALUE));
        assert_eq!(hsts(&build_429_headers(60).unwrap()), Some(HSTS_VALUE));
    }

    // ── H-D-05：400 响应构造（Host 缺失 / dot-segment 拒绝共用）────────

    #[test]
    fn test_build_400_headers_sets_plain_text_body_and_length() {
        let header = build_400_headers().expect("构造应成功");

        assert_eq!(header.status.as_u16(), 400);
        assert_eq!(
            header
                .headers
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("text/plain; charset=utf-8")
        );
        assert_eq!(
            header
                .headers
                .get("content-length")
                .and_then(|value| value.to_str().ok()),
            Some(BAD_REQUEST_BODY.len().to_string().as_str())
        );
    }

    // ── H-33：metrics 密钥比较必须定长/恒定时间 ─────────────────────

    #[test]
    fn constant_time_eq_matches_only_identical_inputs() {
        assert!(constant_time_eq("secret", "secret"));
        assert!(constant_time_eq("", ""));
        assert!(!constant_time_eq("secret", "secreT"));
        assert!(!constant_time_eq("secret", "secret "));
        // 前缀匹配不得提前放行（短路口径下长度不同会静默不等）
        assert!(!constant_time_eq("secre", "secret"));
        assert!(!constant_time_eq("secret", "secre"));
        assert!(!constant_time_eq("", "secret"));
    }
}

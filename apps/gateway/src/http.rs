#[cfg(feature = "self-managed-tls")]
use std::net::Ipv6Addr;
#[cfg(feature = "self-managed-tls")]
use std::str::FromStr;
use std::sync::LazyLock;
use std::time::Duration;

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
}

impl SessionExt for Session {
    fn client_ip(&self) -> Option<String> {
        self.client_addr()
            .and_then(|a| a.as_inet())
            .map(|inet| inet.ip().to_string())
    }

    async fn respond_401(&mut self) -> Result<()> {
        let mut header = ResponseHeader::build(401, None)?;
        header.insert_header("WWW-Authenticate", "Bearer")?;
        self.write_response_header(Box::new(header), true).await
    }

    async fn respond_302_with_cookies(&mut self, location: &str, cookies: &[String]) -> Result<()> {
        let mut header = ResponseHeader::build(302, None)?;
        header.insert_header("Location", location)?;
        for cookie in cookies {
            header.append_header("Set-Cookie", cookie.as_str())?;
        }
        self.set_keepalive(None);
        self.write_response_header(Box::new(header), true).await
    }

    async fn respond_429(&mut self, retry_after_secs: u64) -> Result<()> {
        let mut header = ResponseHeader::build(429, None)?;
        // 用 itoa 栈上格式化替代 to_string() 的堆分配（冷路径，但属范式正确）
        let mut buf = itoa::Buffer::new();
        header.insert_header("Retry-After", buf.format(retry_after_secs))?;
        self.write_response_header(Box::new(header), true).await
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
}

use std::net::Ipv6Addr;
use std::str::FromStr;
use std::sync::LazyLock;
use std::time::Duration;

use pingora_core::Result;
use pingora_http::{RequestHeader, ResponseHeader};
use pingora_proxy::Session;

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

/// 判定 `Host` 头是否指向本地开发环境，从而决定 Cookie 是否省略 `Secure` 标记。
pub fn is_secure_host(host: &str) -> bool {
    !matches!(host_only(host), "localhost" | "127.0.0.1" | "[::1]" | "::1")
}

/// 判断请求是否为 HTML 页面导航（GET + Accept: text/html + 无 RSC header）
pub fn is_html_page_navigation(req: &RequestHeader) -> bool {
    let is_get = req.method.as_str().eq_ignore_ascii_case("GET");
    let is_html = req
        .headers
        .get("Accept")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|a| a.contains("text/html"));
    let is_rsc = req.headers.get("RSC").is_some();
    is_get && is_html && !is_rsc
}

// ── 全局 HTTP 客户端 ──

/// 全局 HTTP 客户端单例（reqwest::Client 内置连接池，应全局复用而非每次创建）
///
/// 供 `jwks` 和 `auth` 模块共享，统一超时策略（5s 连接超时）。
pub static HTTP_CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .expect("❌ 全局 HTTP 客户端初始化失败")
});

// ── Session 扩展 ──

/// 针对 Pingora Session 的高阶 HTTP 操作扩展特质
///
/// 仅用于为外部类型 `Session` 添加方法，从不进行动态分发。
/// 手动 desugar async fn → `impl Future` 以精确控制 `Send` 约束。
/// 避免 `#[async_trait]` 的 `Box` 堆分配，零开销。
pub trait SessionExt {
    /// 提取真实客户端 IP（优先从 X-Forwarded-For 的首个 IP 提取）
    fn client_ip(&self) -> Option<&str>;

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
    fn client_ip(&self) -> Option<&str> {
        self.get_header("X-Forwarded-For")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.split(',').next().map(|s| s.trim()))
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

    #[test]
    fn host_only_strips_port() {
        assert_eq!(host_only("localhost:18080"), "localhost");
        assert_eq!(host_only("example.com:443"), "example.com");
    }

    #[test]
    fn host_only_keeps_bare_host() {
        assert_eq!(host_only("example.com"), "example.com");
        assert_eq!(host_only("localhost"), "localhost");
    }

    #[test]
    fn host_only_handles_ipv6_literal() {
        // 含端口：截到 ] （含方括号）
        assert_eq!(host_only("[::1]:18080"), "[::1]");
        assert_eq!(host_only("[2001:db8::1]:443"), "[2001:db8::1]");
        // 不含端口：原样返回
        assert_eq!(host_only("[2001:db8::1]"), "[2001:db8::1]");
    }

    #[test]
    fn host_only_accepts_valid_bare_ipv6() {
        // 合法裸 IPv6：整体视为主机，不剥离
        assert_eq!(host_only("::1"), "::1");
        assert_eq!(host_only("2001:db8::1"), "2001:db8::1");
        assert_eq!(host_only("fe80::1"), "fe80::1");
    }

    #[test]
    fn host_only_rejects_malformed_multi_colon_as_ipv6() {
        // 含多个冒号但非合法 IPv6 的输入：走普通主机分支，按首个冒号剥离
        // （防止畸形输入被误当作 IPv6 而跳过端口剥离）
        assert_eq!(host_only("a:b:c"), "a");
        assert_eq!(host_only(":::"), ""); // 首个字符即冒号 → 截取为空
        assert_eq!(host_only("foo:80:extra"), "foo");
    }

    #[test]
    fn is_secure_host_local_dev_returns_false() {
        // 本地开发环境：不应设置 Secure（否则浏览器在 http 上丢弃 Cookie）
        assert!(!is_secure_host("localhost"));
        assert!(!is_secure_host("localhost:3000"));
        assert!(!is_secure_host("127.0.0.1"));
        assert!(!is_secure_host("127.0.0.1:4100"));
        assert!(!is_secure_host("[::1]"));
        assert!(!is_secure_host("[::1]:18443"));
        assert!(!is_secure_host("::1"));
    }

    #[test]
    fn is_secure_host_production_returns_true() {
        assert!(is_secure_host("sso.company.com"));
        assert!(is_secure_host("sso.company.com:443"));
    }

    #[test]
    fn is_secure_host_not_fooled_by_substring() {
        // 子串匹配的回归测试：原先 contains("localhost") 会误判这些为本地
        assert!(is_secure_host("notlocalhost.evil.com"));
        assert!(is_secure_host("localhost.evil.com"));
        // 原先 contains("127.0.0.1") 会误判
        assert!(is_secure_host("2127.0.0.1"));
        assert!(is_secure_host("127.0.0.1.evil.com"));
    }
}

use std::sync::LazyLock;
use std::time::Duration;

use pingora_core::Result;
use pingora_http::ResponseHeader;
use pingora_proxy::Session;

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

    /// 发送 302 重定向响应并关闭 Keep-Alive 连接
    ///
    /// # 参数
    /// * `location` - 重定向目标 URL
    fn respond_302(
        &mut self,
        location: &str,
    ) -> impl std::future::Future<Output = Result<()>> + Send;

    /// 发送 401 Unauthorized 响应并注入 Bearer WWW-Authenticate 头部
    fn respond_401(&mut self) -> impl std::future::Future<Output = Result<()>> + Send;

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

    async fn respond_302(&mut self, location: &str) -> Result<()> {
        let mut header = ResponseHeader::build(302, None)?;
        header.insert_header("Location", location)?;
        self.set_keepalive(None);
        self.write_response_header(Box::new(header), true).await
    }

    async fn respond_401(&mut self) -> Result<()> {
        let mut header = ResponseHeader::build(401, None)?;
        header.insert_header("WWW-Authenticate", "Bearer")?;
        self.write_response_header(Box::new(header), true).await
    }

    async fn respond_429(&mut self, retry_after_secs: u64) -> Result<()> {
        let mut header = ResponseHeader::build(429, None)?;
        header.insert_header("Retry-After", retry_after_secs.to_string().as_str())?;
        self.write_response_header(Box::new(header), true).await
    }
}

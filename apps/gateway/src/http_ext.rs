use async_trait::async_trait;
use pingora_core::Result;
use pingora_http::ResponseHeader;
use pingora_proxy::Session;

/// 针对 Pingora Session 的高阶 HTTP 操作扩展特质
#[async_trait]
pub trait SessionExt {
    /// 提取真实客户端 IP（优先从 X-Forwarded-For 的首个 IP 提取）
    fn client_ip(&self) -> Option<String>;

    /// 从请求的 Cookie 头部中提取指定名称的 Cookie 值
    fn get_cookie(&self, name: &str) -> Option<&str>;

    /// 发送 302 重定向响应并关闭 Keep-Alive 连接
    async fn respond_302(&mut self, location: &str) -> Result<()>;

    /// 发送 401 Unauthorized 响应并注入 Bearer WWW-Authenticate 头部
    async fn respond_401(&mut self) -> Result<()>;

    /// 发送 429 Too Many Requests 响应并注入 Retry-After 头部
    async fn respond_429(&mut self, retry_after_secs: u64) -> Result<()>;
}

#[async_trait]
impl SessionExt for Session {
    fn client_ip(&self) -> Option<String> {
        self.get_header("X-Forwarded-For")
            .and_then(|h| h.to_str().ok())
            .and_then(|s| s.split(',').next().map(|s| s.trim().to_string()))
    }

    fn get_cookie(&self, name: &str) -> Option<&str> {
        let cookie_header = self.get_header("Cookie").and_then(|v| v.to_str().ok())?;
        crate::cookie::extract_from_header(cookie_header, name)
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

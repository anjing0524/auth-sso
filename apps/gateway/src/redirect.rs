use async_trait::async_trait;
use pingora_core::prelude::*;
use pingora_http::ResponseHeader;
use pingora_proxy::{ProxyHttp, Session};
use tracing::info;

/// 根据当前请求的主机、路径、Query 参数及 SSL 端口，生成 HTTPS 重定向 Location 网址
pub fn generate_redirect_location(
    host: &str,
    path: &str,
    query: Option<&str>,
    ssl_port: u16,
) -> String {
    let host_only = host.split(':').next().unwrap_or(host);
    let query_len = query.map(|q| q.len() + 1).unwrap_or(0);
    let mut location = String::with_capacity(8 + host_only.len() + 6 + path.len() + query_len);

    location.push_str("https://");
    location.push_str(host_only);
    if ssl_port != 443 {
        use std::fmt::Write;
        let _ = write!(location, ":{}", ssl_port);
    }
    location.push_str(path);
    if let Some(q) = query {
        location.push('?');
        location.push_str(q);
    }
    location
}

/// HTTP → HTTPS 强制重定向服务
/// 监听 HTTP 端口，将所有 HTTP 请求以 301 重定向至 HTTPS
pub struct RedirectService {
    pub ssl_port: u16,
}

#[async_trait]
impl ProxyHttp for RedirectService {
    type CTX = ();
    fn new_ctx(&self) -> Self::CTX {}

    async fn request_filter(&self, session: &mut Session, _ctx: &mut ()) -> Result<bool> {
        let host = session
            .get_header("Host")
            .and_then(|h| h.to_str().ok())
            .unwrap_or("unknown");
        let path = session.req_header().uri.path();
        let query = session.req_header().uri.query();

        let location = generate_redirect_location(host, path, query, self.ssl_port);

        info!("HTTP → HTTPS 重定向: {}", location);
        // 生产优化：去除 unwrap()，使用 ? 优雅传播首部构建与写入错误
        let mut header = ResponseHeader::build(301, None)?;
        header.insert_header("Location", location)?;
        session.set_keepalive(None);
        session
            .write_response_header(Box::new(header), true)
            .await?;
        Ok(true)
    }

    async fn upstream_peer(&self, _session: &mut Session, _ctx: &mut ()) -> Result<Box<HttpPeer>> {
        unreachable!()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_generate_redirect_location() {
        // 测试 443 端口，不带 query
        assert_eq!(
            generate_redirect_location("localhost:18080", "/foo", None, 443),
            "https://localhost/foo"
        );

        // 测试 443 端口，带 query
        assert_eq!(
            generate_redirect_location("localhost:18080", "/foo", Some("code=123&state=abc"), 443),
            "https://localhost/foo?code=123&state=abc"
        );

        // 测试自定义端口，不带 query
        assert_eq!(
            generate_redirect_location("localhost:18080", "/foo", None, 18443),
            "https://localhost:18443/foo"
        );

        // 测试自定义端口，带 query
        assert_eq!(
            generate_redirect_location(
                "localhost:18080",
                "/foo",
                Some("code=123&state=abc"),
                18443
            ),
            "https://localhost:18443/foo?code=123&state=abc"
        );
    }
}

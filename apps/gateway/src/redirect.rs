use async_trait::async_trait;
use log::info;
use pingora_core::prelude::*;
use pingora_http::ResponseHeader;
use pingora_proxy::{ProxyHttp, Session};

/// 根据当前请求的主机、路径、Query 参数及 SSL 端口，生成 HTTPS 重定向 Location 网址
pub fn generate_redirect_location(
    host: &str,
    path: &str,
    query: Option<&str>,
    ssl_port: &str,
) -> String {
    let host_only = host.split(':').next().unwrap_or(host);
    if let Some(q) = query {
        if ssl_port == "443" {
            format!("https://{}{}?{}", host_only, path, q)
        } else {
            format!("https://{}:{}{}?{}", host_only, ssl_port, path, q)
        }
    } else {
        if ssl_port == "443" {
            format!("https://{}{}", host_only, path)
        } else {
            format!("https://{}:{}{}", host_only, ssl_port, path)
        }
    }
}

/// HTTP → HTTPS 强制重定向服务
/// 监听 HTTP 端口，将所有 HTTP 请求以 301 重定向至 HTTPS
pub struct RedirectService {
    pub ssl_port: String,
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

        let location = generate_redirect_location(host, path, query, &self.ssl_port);

        info!("HTTP → HTTPS 重定向: {}", location);
        let mut header = ResponseHeader::build(301, None).unwrap();
        header.insert_header("Location", location).unwrap();
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
            generate_redirect_location("localhost:18080", "/foo", None, "443"),
            "https://localhost/foo"
        );

        // 测试 443 端口，带 query
        assert_eq!(
            generate_redirect_location(
                "localhost:18080",
                "/foo",
                Some("code=123&state=abc"),
                "443"
            ),
            "https://localhost/foo?code=123&state=abc"
        );

        // 测试自定义端口，不带 query
        assert_eq!(
            generate_redirect_location("localhost:18080", "/foo", None, "18443"),
            "https://localhost:18443/foo"
        );

        // 测试自定义端口，带 query
        assert_eq!(
            generate_redirect_location(
                "localhost:18080",
                "/foo",
                Some("code=123&state=abc"),
                "18443"
            ),
            "https://localhost:18443/foo?code=123&state=abc"
        );
    }
}

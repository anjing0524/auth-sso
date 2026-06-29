use crate::app_context::AppContext;
use crate::gateway::{FilterResult, GatewayCtx};
use crate::http_ext::SessionExt;
use crate::path_matcher::PathClass;
use pingora_core::Result;
use pingora_proxy::Session;
use tracing::warn;

/// 速率限制拦截校验，保护认证端点防止爆刷。
///
/// 返回 `FilterResult::Break` 时表示已限流，并在内部向客户端响应了 429 状态码。
pub async fn check_rate_limit(
    session: &mut Session,
    ctx: &mut GatewayCtx,
    app: &AppContext,
) -> Result<FilterResult> {
    // 静态资源直接跳过限流
    if ctx.path_class == PathClass::Static {
        return Ok(FilterResult::Continue);
    }

    let path = session.req_header().uri.path();
    let ip = ctx.client_ip.as_deref().unwrap_or("unknown");

    if let Some(false) = app.limiter.check(ip, path) {
        warn!("速率限制触发: ip={}, path={}", ip, path);
        session.respond_429(60).await?;
        return Ok(FilterResult::Break);
    }

    Ok(FilterResult::Continue)
}

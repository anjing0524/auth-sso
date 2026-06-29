use crate::app_context::AppContext;
use crate::auth::VerifyResult;
use crate::cookie;
use crate::gateway::{FilterResult, GatewayCtx, Identity};
use crate::http_ext::SessionExt;
use crate::path_matcher::PathClass;
use pingora_core::Result;
use pingora_proxy::Session;
use tracing::info;

/// 根据请求上下文决策鉴权失败时的响应方式（私有函数，内部流转）：
/// — 浏览器普通页面导航 → 302 重定向至登录页
/// — API / RSC / Server Action → 401 直接拦截
fn should_redirect_to_login(method: &str, accept: &str, has_rsc: bool) -> bool {
    let is_get = method.eq_ignore_ascii_case("GET");
    let is_html = accept.contains("text/html");
    is_get && is_html && !has_rsc
}

/// 鉴权失败统一响应处理（302 重定向 或 401 拦截）
async fn respond_auth_failure(session: &mut Session) -> Result<FilterResult> {
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
        session.respond_302(&redirect_url).await?;
        return Ok(FilterResult::Break);
    }

    info!("接口或异步 RPC 未授权访问，网关执行 401 强拦截");
    session.respond_401().await?;
    Ok(FilterResult::Break)
}

/// 鉴权与静默续签校验逻辑，保障路由访问安全并提供平滑的会话刷新。
///
/// 返回 `FilterResult::Break` 时表示未授权，且在内部已向客户端写回了 302/401 响应。
pub async fn check_auth(
    session: &mut Session,
    ctx: &mut GatewayCtx,
    app: &AppContext,
) -> Result<FilterResult> {
    // 静态资源与公开路由白名单：直接跳过鉴权
    if ctx.path_class == PathClass::Static || ctx.path_class == PathClass::Public {
        return Ok(FilterResult::Continue);
    }

    let token = match session.get_cookie(cookie::ACCESS_COOKIE) {
        Some(t) => t,
        None => return respond_auth_failure(session).await,
    };

    let verified_result: VerifyResult = match app.auth_service.verify_jwt(token).await {
        Some(v) => v,
        None => return respond_auth_failure(session).await,
    };

    // 先用旧 Token 的身份填充 ctx；续签成功后在下方被新身份整体覆盖
    let verified = verified_result.verified();
    ctx.identity = Some(Identity {
        auth_header: format!("Bearer {}", token),
        user_id: verified.user_id.clone(),
        user_jti: verified.jti.clone(),
    });

    // 完全有效 → 直接放行
    if matches!(verified_result, VerifyResult::Valid(_)) {
        return Ok(FilterResult::Continue);
    }

    // NeedsRefresh / Expired：尽力静默续签（刷新身份并下行新 Cookie）
    let mut refreshed = false;
    if let Some(rt) = session.get_cookie(cookie::REFRESH_COOKIE)
        && let Some(new_tokens) = app
            .auth_service
            .try_refresh_token(rt, &verified.user_id)
            .await
        && let Some(new_claims) = crate::auth::decode_jwt_payload(&new_tokens.access)
    {
        ctx.identity = Some(Identity {
            auth_header: format!("Bearer {}", new_tokens.access),
            user_id: new_claims.sub,
            user_jti: new_claims.jti,
        });
        ctx.refreshed_tokens = Some(new_tokens);
        refreshed = true;
    }

    // 仅「已过期且续签失败」才阻断；NeedsRefresh 续签失败时旧 AT 仍有效，放行
    if matches!(verified_result, VerifyResult::Expired(_)) && !refreshed {
        return respond_auth_failure(session).await;
    }

    Ok(FilterResult::Continue)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_should_redirect_to_login() {
        // 子模块可直接访问父模块私有函数，API 无需泄露 pub 即可完成测试
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
}

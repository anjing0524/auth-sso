use crate::auth::{JwtVerifier, TokenExpiry, TokenRefresher, TokenStatus};
use crate::cookie;
use crate::gateway::{GatewayCtx, Identity};
use crate::http::SessionExt;
use pingora_core::Result;
use pingora_proxy::Session;
use tracing::info;

// ── 鉴权失败响应 ──

/// 根据请求特征选择 302 重定向或 401 拦截
async fn respond_auth_failure(session: &mut Session) -> Result<bool> {
    let is_get = session
        .req_header()
        .method
        .as_str()
        .eq_ignore_ascii_case("GET");
    let is_html = session
        .get_header("Accept")
        .and_then(|h| h.to_str().ok())
        .is_some_and(|a| a.contains("text/html"));
    let is_rsc = session.get_header("RSC").is_some();

    if is_get && is_html && !is_rsc {
        let path = session.req_header().uri.path();
        let mut url = path.to_owned();
        if let Some(q) = session.req_header().uri.query() {
            url.push('?');
            url.push_str(q);
        }
        let location = format!("/login?callbackUrl={}", urlencoding::encode(&url));
        info!("未授权页面导航 → 302 {}", location);
        session.respond_302(&location).await?;
    } else {
        info!("未授权 API 请求 → 401");
        session.respond_401().await?;
    }

    crate::metrics::inc_auth_failures();
    Ok(true)
}

// ── 静默续签 ──

/// 从 Cookie 提取 RT，调 Portal 续签，成功时更新 ctx 并返回 true。
async fn try_refresh_session(
    cookie_header: Option<&str>,
    ctx: &mut GatewayCtx,
    refresher: &TokenRefresher,
) -> bool {
    let rt = cookie_header.and_then(|h| cookie::extract_from_header(h, cookie::REFRESH_COOKIE));
    let Some(rt) = rt else {
        return false;
    };
    let Some(identity) = ctx.identity.as_ref() else {
        return false;
    };
    let Some(new_tokens) = refresher.try_refresh(rt, &identity.user_id).await else {
        return false;
    };
    let Some(new_claims) = crate::auth::decode_jwt_payload(&new_tokens.access) else {
        return false;
    };

    ctx.identity = Some(Identity {
        auth_header: format!("Bearer {}", new_tokens.access),
        user_id: new_claims.sub,
        user_jti: new_claims.jti,
    });
    ctx.refreshed_tokens = Some(new_tokens);
    true
}

// ── 主流程 ──

/// 鉴权与静默续签。
///
/// 三步：
/// 1. 提取 Cookie 中的 AT → 验签
/// 2. Valid → 放行；NeedsRefresh / Expired → 尝试续签
/// 3. Expired 且续签失败 → 拒绝；其余 → 放行
///
/// # Errors
///
/// 仅在底层 I/O 操作（读取请求头、写入响应）失败时返回错误，
/// 鉴权逻辑本身不产生错误（通过 `respond_auth_failure` 处理）。
///
/// # Examples
///
/// ```ignore
/// // 在 request_filter 中调用：
/// if authenticate::check(session, ctx, &jwt_verifier, &token_refresher).await? {
///     return Ok(true); // 鉴权失败，已响应 302/401
/// }
/// // 鉴权通过，继续处理请求
/// ```
pub async fn check(
    session: &mut Session,
    ctx: &mut GatewayCtx,
    verifier: &JwtVerifier,
    refresher: &TokenRefresher,
) -> Result<bool> {
    let cookie_header = session.get_header("Cookie").and_then(|v| v.to_str().ok());

    // 1. 提取 AT
    let token = cookie_header.and_then(|h| cookie::extract_from_header(h, cookie::ACCESS_COOKIE));
    let Some(token) = token else {
        return respond_auth_failure(session).await;
    };

    // 2. 验签
    let Some(TokenStatus {
        token: verified,
        expiry,
    }) = verifier.verify(token).await
    else {
        return respond_auth_failure(session).await;
    };

    // 3. 写入当前身份到 ctx
    ctx.identity = Some(Identity {
        auth_header: format!("Bearer {}", token),
        user_id: verified.user_id,
        user_jti: verified.jti,
    });

    // 4. Valid → 直接放行，无需续签
    if matches!(expiry, TokenExpiry::Valid) {
        return Ok(false);
    }

    // 5. NearlyExpired / Expired → 尝试续签
    let refreshed = try_refresh_session(cookie_header, ctx, refresher).await;

    // 6. Expired 且续签失败 → 拒绝；其余 → 放行
    if matches!(expiry, TokenExpiry::Expired) && !refreshed {
        return respond_auth_failure(session).await;
    }
    Ok(false)
}

// 302 vs 401 决策矩阵（respond_auth_failure 内联）：
//   | Method | Accept          | RSC  | 结果 |
//   |--------|-----------------|------|------|
//   | GET    | text/html       | 无   | 302  |
//   | POST   | text/html       | 无   | 401  |
//   | GET    | application/json| 无   | 401  |
//   | GET    | text/html       | 有   | 401  |
//   | *      | *               | *    | 401  |（默认）

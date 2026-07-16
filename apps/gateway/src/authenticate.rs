use crate::auth::{AuthDecision, JwtVerifier, TokenExpiry, TokenRefresher, TokenStatus};
use crate::cookie;
use crate::gateway::{GatewayCtx, Identity};
use crate::http::SessionExt;
use pingora_core::Result;
use pingora_proxy::Session;
use tracing::warn;

async fn auth_failure_decision(session: &mut Session, is_html_nav: bool) -> Result<AuthDecision> {
    if is_html_nav {
        Ok(AuthDecision::PkceRequired)
    } else {
        session.respond_401().await?;
        crate::metrics::inc_auth_failures();
        Ok(AuthDecision::Interrupted)
    }
}

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

pub async fn check(
    session: &mut Session,
    ctx: &mut GatewayCtx,
    verifier: &JwtVerifier,
    refresher: &TokenRefresher,
    is_html_nav: bool,
) -> Result<AuthDecision> {
    let cookie_header = cookie::collapse_cookie_header(session.req_header());
    let cookie_header = cookie_header.as_deref();

    let token = cookie_header.and_then(|h| cookie::extract_from_header(h, cookie::ACCESS_COOKIE));

    let Some(token) = token else {
        return auth_failure_decision(session, is_html_nav).await;
    };

    let TokenStatus {
        token: verified,
        expiry,
    } = match verifier.verify(token).await {
        Ok(status) => status,
        Err(e) => {
            warn!(error = %e, "JWT 验签失败");
            return auth_failure_decision(session, is_html_nav).await;
        }
    };

    ctx.identity = Some(Identity {
        auth_header: format!("Bearer {}", token),
        user_id: verified.user_id,
        user_jti: verified.jti,
    });

    match expiry {
        TokenExpiry::Valid => Ok(AuthDecision::Pass),
        TokenExpiry::NearlyExpired | TokenExpiry::Expired => {
            let refreshed = try_refresh_session(cookie_header, ctx, refresher).await;
            match expiry {
                TokenExpiry::Expired if !refreshed => {
                    auth_failure_decision(session, is_html_nav).await
                }
                _ => Ok(AuthDecision::Pass),
            }
        }
    }
}

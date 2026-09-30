//! 认证编排：将 JWT 验签、jti 黑名单检查、静默续签组合为单一 `check()` 流程。
//!
//! # 续签行为
//!
//! | Token 状态 | 续签行为 | 失败降级 |
//! |---|---|---|
//! | `Valid` | 不续签 | — |
//! | `NearlyExpired`（< 5min） | 尝试续签，**不阻断请求** | 旧 AT 仍有效，**下次请求重试** |
//! | `Expired` | 尝试续签，**续签失败则阻断** | 401 或 PKCE 302 |
//!
//! **Expired 并发竞争**：同用户并发续签由 Redis SET NX EX 原子抢占去重（30s 窗口），
//! 仅一个请求发起续签；竞争失败方在 `Expired` 状态下收到 401/PKCE。
//! 这是有意的安全权衡——Redis 中不缓存新 AT 供失败方取用（零 token 明文泄露面），
//! 失败方浏览器凭续签成功方下发的新 Cookie 在下次请求自愈。
//!
//! **NearlyExpired 重试风暴风险**：如果 Portal 连续不可达，每次请求都会触发续签尝试
//! （因为 AT 在接下来 5 分钟内始终处于 NearlyExpired）。这是有意的可用性权衡——
//! 旧 AT 在业务上仍可接受。Redis 去重（30s 窗口）限制了入站续签请求频率；
//! 若 Redis 降级，每次请求都会尝试续签，入站 POST 量将增加，但不会阻断业务。

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

/// 续签后的三态判定（纯函数）：仅"已过期且续签失败"阻断；
/// NearlyExpired 续签失败不阻断（旧 AT 仍有效，模块文档承诺的可用性权衡）。
/// 抽出纯函数使决策表可脱离 Pingora Session 直接单测。
fn refresh_failure_blocks(expiry: &TokenExpiry, refreshed: bool) -> bool {
    matches!(expiry, TokenExpiry::Expired) && !refreshed
}

async fn try_refresh_session(ctx: &mut GatewayCtx, refresher: &TokenRefresher) -> bool {
    let rt = ctx
        .cookie_header
        .as_deref()
        .and_then(|h| cookie::extract_from_header(h, cookie::REFRESH_COOKIE));
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
    // Cookie 头由 request_filter 起始处一次 collapse 存入 ctx，此处直接复用
    let token = ctx
        .cookie_header
        .as_deref()
        .and_then(|h| cookie::extract_from_header(h, cookie::ACCESS_COOKIE));

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
            let refreshed = try_refresh_session(ctx, refresher).await;
            if refresh_failure_blocks(&expiry, refreshed) {
                auth_failure_decision(session, is_html_nav).await
            } else {
                Ok(AuthDecision::Pass)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// check() 的续签后决策表全真值覆盖：
    /// 仅 (Expired, 续签失败) 阻断；Valid/NearlyExpired 恒放行。
    /// （此前此处是 assert_eq!(X, X) 同义反复的伪测试，check() 决策零覆盖。）
    #[test]
    fn decision_table_blocks_only_expired_unrefreshed() {
        use crate::auth::TokenExpiry;

        // Valid：不触发续签路径，无论 refreshed 取值都放行
        assert!(!refresh_failure_blocks(&TokenExpiry::Valid, false));
        assert!(!refresh_failure_blocks(&TokenExpiry::Valid, true));
        // NearlyExpired：续签失败不阻断（旧 AT 仍有效，下次请求重试）
        assert!(!refresh_failure_blocks(&TokenExpiry::NearlyExpired, false));
        assert!(!refresh_failure_blocks(&TokenExpiry::NearlyExpired, true));
        // Expired：续签失败必须阻断（401/PKCE）；成功放行
        assert!(refresh_failure_blocks(&TokenExpiry::Expired, false));
        assert!(!refresh_failure_blocks(&TokenExpiry::Expired, true));
    }
}

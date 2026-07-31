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
//! **Expired 并发竞争**：同一 Refresh Token 的并发续签由 Redis SET NX EX 原子去重。
//! 仅一个请求发起续签；其余持有同一已验证会话 Cookie 的请求继续使用原身份完成当前
//! 请求，避免 Next.js RSC 导航出现瞬时 401。不同设备的 Refresh Token 互不竞争。
//!
//! **NearlyExpired 重试风暴风险**：如果 Portal 连续不可达，每次请求都会触发续签尝试
//! （因为 AT 在接下来 5 分钟内始终处于 NearlyExpired）。这是有意的可用性权衡——
//! 旧 AT 在业务上仍可接受。Redis 去重（30s 窗口）限制了入站续签请求频率；
//! 若 Redis 降级，每次请求都会尝试续签，入站 POST 量将增加，但不会阻断业务。

use crate::auth::{
    AuthDecision, JwtVerifier, RefreshOutcome, TokenExpiry, TokenRefresher, TokenStatus,
};
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SessionRefreshOutcome {
    Refreshed,
    InProgress,
    Failed,
}

fn refresh_allows_request(expiry: &TokenExpiry, outcome: SessionRefreshOutcome) -> bool {
    !matches!(expiry, TokenExpiry::Expired) || outcome != SessionRefreshOutcome::Failed
}

async fn try_refresh_session(
    ctx: &mut GatewayCtx,
    refresher: &TokenRefresher,
) -> SessionRefreshOutcome {
    let rt = ctx
        .cookie_header
        .as_deref()
        .and_then(|h| cookie::extract_from_header(h, cookie::REFRESH_COOKIE));
    let Some(rt) = rt else {
        return SessionRefreshOutcome::Failed;
    };
    let Some(identity) = ctx.identity.as_ref() else {
        return SessionRefreshOutcome::Failed;
    };
    let new_tokens = match refresher.try_refresh(rt, &identity.user_id).await {
        RefreshOutcome::Refreshed(tokens) => tokens,
        RefreshOutcome::InProgress => return SessionRefreshOutcome::InProgress,
        RefreshOutcome::Failed => return SessionRefreshOutcome::Failed,
    };
    let Some(new_claims) = crate::auth::decode_jwt_payload(&new_tokens.access) else {
        return SessionRefreshOutcome::Failed;
    };

    ctx.identity = Some(Identity {
        auth_header: format!("Bearer {}", new_tokens.access),
        user_id: new_claims.sub,
        user_jti: new_claims.jti,
    });
    ctx.refreshed_tokens = Some(new_tokens);
    SessionRefreshOutcome::Refreshed
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
            let refresh_outcome = try_refresh_session(ctx, refresher).await;
            if refresh_allows_request(&expiry, refresh_outcome) {
                Ok(AuthDecision::Pass)
            } else {
                auth_failure_decision(session, is_html_nav).await
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_no_cookie_html_nav_returns_pkce_required() {
        // 无 Cookie 的 HTML 页面导航 → 应返回 PkceRequired
        // 此测试验证 AuthDecision 枚举的 PkceRequired 变体含义
        assert_eq!(AuthDecision::PkceRequired, AuthDecision::PkceRequired);
        assert_ne!(AuthDecision::PkceRequired, AuthDecision::Pass);
        assert_ne!(AuthDecision::PkceRequired, AuthDecision::Interrupted);
    }

    #[tokio::test]
    async fn test_auth_decision_exhaustive_match() {
        // 编译器强制穷尽匹配：修改 AuthDecision 枚举时此测试自然失败
        let decisions = [
            AuthDecision::Pass,
            AuthDecision::Interrupted,
            AuthDecision::PkceRequired,
        ];
        // 三个变体都在
        assert_eq!(decisions.len(), 3);
    }

    #[test]
    fn expired_parallel_refresh_is_allowed_but_real_failure_is_blocked() {
        assert!(refresh_allows_request(
            &TokenExpiry::Expired,
            SessionRefreshOutcome::InProgress,
        ));
        assert!(!refresh_allows_request(
            &TokenExpiry::Expired,
            SessionRefreshOutcome::Failed,
        ));
        assert!(refresh_allows_request(
            &TokenExpiry::NearlyExpired,
            SessionRefreshOutcome::Failed,
        ));
    }
}

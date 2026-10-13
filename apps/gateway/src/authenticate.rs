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
//!
//! # 新 Cookie 的下发不变量
//!
//! **Portal 一旦轮换，旧 RT 就已经被撤销**（Portal 侧在同一已提交事务里标记撤销并
//! 写入新 RT）。因此"已轮换"是**不可逆事实**：新 Cookie 必须送达浏览器——放行时由
//! `response_filter` 下发，阻断时随 401 / 登录跳转一并下发。丢掉它们会让浏览器继续
//! 使用已被撤销的旧 RT，下次续签命中 Portal 的复用检测 → 家族级联撤销（连该用户
//! 其他会话一起）。该不变量由 [`RefreshEffect`] 承载：`Rotated` ⇒ `tokens` 必为 `Some`。

use crate::auth::{
    AuthDecision, JwtVerifier, RefreshOutcome, RefreshedTokens, TokenExpiry, TokenRefresher,
    TokenStatus,
};
use crate::cookie;
use crate::gateway::{GatewayCtx, Identity};
use crate::http::SessionExt;
use pingora_core::Result;
use pingora_proxy::Session;
use tracing::{debug, warn};

/// 一次续签尝试对本次请求的**影响**（纯值，零 I/O）。
///
/// 抽出纯函数的目的不是"便于测试"，而是让 [上方不变量](self) 落在类型上：
/// 只要 Portal 已轮换（[`RefreshOutcome::Rotated`]），`tokens` 必然是 `Some`。
#[derive(Debug, PartialEq, Eq)]
struct RefreshEffect {
    /// 新身份（仅当新 AT 的 payload 可解码）；`None` 表示保留调用方原有身份
    identity: Option<Identity>,
    /// 必须下发给浏览器的新 Token 对（**仅**在 Portal 已轮换时为 `Some`）
    tokens: Option<RefreshedTokens>,
    /// 是否阻断本次请求
    block: bool,
}

/// 续签结果 → 对本次请求的影响（纯函数，决策表可穷举）。
///
/// `outcome` 为 `None` 表示**未尝试**（缺 RT Cookie 或缺身份）。它的影响与
/// [`RefreshOutcome::Failed`] 相同（无新 token、AT 过期即阻断），但两者是不同的事实
/// ——"没有可续签的前提"与"续签失败"在排查时必须能分辨，故不压成一个值。
fn refresh_effect(expiry: &TokenExpiry, outcome: Option<RefreshOutcome>) -> RefreshEffect {
    match outcome {
        Some(RefreshOutcome::Rotated(tokens)) => {
            let identity = crate::auth::decode_jwt_payload(&tokens.access).map(|claims| Identity {
                auth_header: format!("Bearer {}", tokens.access),
                user_id: claims.sub,
                user_jti: claims.jti,
            });
            // 解不出新身份时：NearlyExpired 用旧 AT 继续本次请求（旧 AT 仍有效）；
            // Expired 则必须阻断（旧 AT 已过期，转发上游只会换来 401）。
            // **两种情况下新 Cookie 都要下发**——这正是本模块头部的那个不变量。
            let block = matches!(expiry, TokenExpiry::Expired) && identity.is_none();
            RefreshEffect {
                identity,
                tokens: Some(tokens),
                block,
            }
        }
        Some(RefreshOutcome::Skipped | RefreshOutcome::Deduped | RefreshOutcome::Failed) | None => {
            RefreshEffect {
                identity: None,
                tokens: None,
                block: matches!(expiry, TokenExpiry::Expired),
            }
        }
    }
}

/// 必须随响应下发给浏览器的新 Token Cookie（仅"已轮换"时非空）。
///
/// HTTPS 由 Gateway 终结（`response_filter` 下发的同类 Cookie 同样恒 `Secure`），
/// 故这里也恒 `secure = true`。
pub(crate) fn refreshed_cookies(ctx: &GatewayCtx) -> Vec<String> {
    ctx.refreshed_tokens
        .as_ref()
        .map(|t| crate::oauth::build_session_cookies(&t.access, &t.refresh, true))
        .unwrap_or_default()
}

/// 认证失败的终局决策。
///
/// `cookies` 必须随失败响应一并下发：它只在"Portal 已轮换、但本次请求仍被阻断"时非空。
/// HTML 导航分支（302 登录跳转）的下发由调用方完成——见 `gateway.rs` 的 `PkceRequired` 分支。
async fn auth_failure_decision(
    session: &mut Session,
    is_html_nav: bool,
    cookies: &[String],
) -> Result<AuthDecision> {
    if is_html_nav {
        Ok(AuthDecision::PkceRequired)
    } else {
        session.respond_401_with_cookies(cookies).await?;
        crate::metrics::inc_auth_failures();
        Ok(AuthDecision::Interrupted)
    }
}

/// 尝试续签；`None` 表示**未尝试**（缺 RT Cookie 或缺身份）。
async fn try_refresh_session(
    ctx: &GatewayCtx,
    refresher: &TokenRefresher,
) -> Option<RefreshOutcome> {
    let rt = ctx
        .cookie_header
        .as_deref()
        .and_then(|h| cookie::extract_from_header(h, cookie::REFRESH_COOKIE))?;
    let identity = ctx.identity.as_ref()?;
    Some(refresher.try_refresh(rt, &identity.user_id).await)
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

    // 以下两条早退路径尚未尝试续签 ⇒ 没有任何新 Cookie 可下发
    let Some(token) = token else {
        return auth_failure_decision(session, is_html_nav, &[]).await;
    };

    let TokenStatus {
        token: verified,
        expiry,
    } = match verifier.verify(token).await {
        Ok(status) => status,
        Err(e) => {
            warn!(error = %e, "JWT 验签失败");
            return auth_failure_decision(session, is_html_nav, &[]).await;
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
            let outcome = try_refresh_session(ctx, refresher).await;
            if outcome.is_none() {
                debug!("本次请求未尝试续签（缺 RT Cookie 或缺身份）");
            }
            let effect = refresh_effect(&expiry, outcome);

            // 先落实"不可逆事实"：已轮换就必须把新 Token 记入 ctx —— 这是 Cookie
            // 能送达的前提（放行时 response_filter 读它，阻断时下面读它）。
            if let Some(tokens) = effect.tokens {
                ctx.refreshed_tokens = Some(tokens);
            }
            if let Some(identity) = effect.identity {
                ctx.identity = Some(identity);
            }

            if effect.block {
                auth_failure_decision(session, is_html_nav, &refreshed_cookies(ctx)).await
            } else {
                Ok(AuthDecision::Pass)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use base64::Engine;

    /// 构造 payload 可被 [`crate::auth::decode_jwt_payload`] 解析的 token
    /// （该函数只做 base64url 解码 + JSON 反序列化，不验签，故无需真实签名）。
    fn token_with_claims(sub: &str, jti: &str) -> String {
        let claims = format!(
            r#"{{"sub":"{sub}","iss":"iss","aud":"portal","client_id":"portal","exp":9999999999,"jti":"{jti}"}}"#
        );
        let payload = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(claims);
        format!("header.{payload}.sig")
    }

    fn tokens(access: String) -> RefreshedTokens {
        RefreshedTokens {
            access,
            refresh: "rt-new".to_string(),
        }
    }

    fn effect(expiry: TokenExpiry, outcome: Option<RefreshOutcome>) -> RefreshEffect {
        refresh_effect(&expiry, outcome)
    }

    /// **核心不变量**：只要 Portal 已轮换，新 Cookie 就必须下发——
    /// 与"payload 是否可解码"和"本次请求是否被阻断"无关。
    #[test]
    fn rotated_always_delivers_tokens() {
        let cases = [
            TokenExpiry::Valid,
            TokenExpiry::NearlyExpired,
            TokenExpiry::Expired,
        ];
        for expiry in cases {
            // 可解码
            let ok = effect(
                expiry.clone(),
                Some(RefreshOutcome::Rotated(tokens(token_with_claims(
                    "user-1", "jti-1",
                )))),
            );
            assert!(ok.tokens.is_some(), "已轮换必须下发新 Cookie: {expiry:?}");
            // 不可解码（payload 形状对不上）
            let bad = effect(
                expiry.clone(),
                Some(RefreshOutcome::Rotated(tokens("not.a.jwt".to_string()))),
            );
            assert!(
                bad.tokens.is_some(),
                "payload 解不出也不得丢掉「已轮换」这一事实: {expiry:?}"
            );
        }
    }

    #[test]
    fn rotated_with_decodable_payload_updates_identity_and_never_blocks() {
        for expiry in [TokenExpiry::NearlyExpired, TokenExpiry::Expired] {
            let e = effect(
                expiry,
                Some(RefreshOutcome::Rotated(tokens(token_with_claims(
                    "user-7", "jti-7",
                )))),
            );
            let identity = e.identity.expect("可解码时必须给出新身份");
            assert_eq!(identity.user_id, "user-7");
            assert_eq!(identity.user_jti, "jti-7");
            assert!(!e.block, "已轮换且身份可用时不得阻断");
        }
    }

    /// payload 解不出时：NearlyExpired 放行（用旧 AT 继续），Expired 阻断。
    /// 两种情况下 tokens 都已在上面的不变量测试里钉住为 `Some`。
    #[test]
    fn rotated_with_undecodable_payload_blocks_only_when_expired() {
        let nearly = effect(
            TokenExpiry::NearlyExpired,
            Some(RefreshOutcome::Rotated(tokens("bad".to_string()))),
        );
        assert!(nearly.identity.is_none());
        assert!(!nearly.block, "NearlyExpired 下旧 AT 仍有效，必须放行");

        let expired = effect(
            TokenExpiry::Expired,
            Some(RefreshOutcome::Rotated(tokens("bad".to_string()))),
        );
        assert!(expired.identity.is_none());
        assert!(expired.block, "Expired 下拿不到可用身份必须阻断");
    }

    /// 未轮换的四种情况：无新 token；仅 Expired 阻断。
    #[test]
    fn non_rotated_outcomes_carry_no_tokens_and_block_only_when_expired() {
        let outcomes = [
            None,
            Some(RefreshOutcome::Skipped),
            Some(RefreshOutcome::Deduped),
            Some(RefreshOutcome::Failed),
        ];
        for outcome in outcomes {
            let nearly = effect(TokenExpiry::NearlyExpired, outcome.clone());
            assert!(nearly.tokens.is_none());
            assert!(!nearly.block);

            let expired = effect(TokenExpiry::Expired, outcome);
            assert!(expired.tokens.is_none());
            assert!(expired.block, "Expired 且未轮换必须阻断");
        }
    }

    /// Valid 不触发续签路径；即便传入结果也不得阻断。
    #[test]
    fn valid_never_blocks() {
        for outcome in [
            None,
            Some(RefreshOutcome::Failed),
            Some(RefreshOutcome::Skipped),
            Some(RefreshOutcome::Deduped),
        ] {
            assert!(!effect(TokenExpiry::Valid, outcome).block);
        }
    }
}

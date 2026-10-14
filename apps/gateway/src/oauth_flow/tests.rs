//! `oauth_flow` 单元测试 —— Token 交换决策表与响应解析
//!
//! 这些用例覆盖的语义原先**内联在 `do_token_exchange` 的分支里**，而该函数需要
//! 一个真实 HTTP 服务器才能跑到 ⇒ 本文件当时**一条测试都没有**。
//! 抽出纯函数 [`decide_exchange`] 后，三条决策（网络错误→换节点 / 非 2xx→确定性拒绝 /
//! 2xx→解析）可以逐条穷举。

use super::*;
use serde_json::json;

/// 断言是"确定性拒绝"，并返回 (status, message)
fn expect_reject(step: ExchangeStep) -> (u16, String) {
    match step {
        ExchangeStep::Reject { status, message } => (status, message),
        other => panic!("期望确定性拒绝，实际是 {other:?}"),
    }
}

fn expect_parsed(step: ExchangeStep) -> TokenExchangeResult {
    match step {
        ExchangeStep::Parsed(tokens) => tokens,
        other => panic!("期望解析成功，实际是 {other:?}"),
    }
}

// ── 决策表：网络错误 → 换下一节点 ──────────────────────────────

#[test]
fn test_transport_failure_retries_next_node() {
    // 网络错误（不可达/超时）不是确定性结论：必须继续尝试下一个上游节点
    assert!(matches!(
        decide_exchange(ExchangeAttempt::Transport),
        ExchangeStep::RetryNextNode
    ));
}

// ── 决策表：HTTP 非 2xx → 确定性拒绝 ───────────────────────────

#[test]
fn test_non_2xx_rejects_deterministically_with_status_and_body() {
    let (status, message) = expect_reject(decide_exchange(ExchangeAttempt::Status(
        400,
        "invalid_grant".into(),
    )));

    // 状态码原样上报（不吞成 502），响应体文本保留供排障
    assert_eq!(status, 400);
    assert!(message.contains("400"), "消息应含状态码: {message}");
    assert!(
        message.contains("invalid_grant"),
        "消息应含响应体: {message}"
    );
}

#[test]
fn test_non_2xx_status_codes_are_preserved() {
    // 401（client 认证失败）与 500（上游故障）都必须原样透出 —— 上游运维需据此区分
    for code in [400u16, 401, 403, 500, 503] {
        let (status, _) = expect_reject(decide_exchange(ExchangeAttempt::Status(code, "x".into())));
        assert_eq!(status, code);
    }
}

// ── 决策表：2xx → 解析 ────────────────────────────────────────

#[test]
fn test_full_response_parses_all_three_fields() {
    let tokens = expect_parsed(decide_exchange(ExchangeAttempt::Body(json!({
        "access_token": "at-1",
        "refresh_token": "rt-1",
        "id_token": "idt-1",
    }))));

    assert_eq!(tokens.access, "at-1");
    assert_eq!(tokens.refresh, "rt-1");
    assert_eq!(tokens.id_token.as_deref(), Some("idt-1"));
}

#[test]
fn test_absent_id_token_is_none() {
    let tokens = expect_parsed(decide_exchange(ExchangeAttempt::Body(json!({
        "access_token": "at-1",
        "refresh_token": "rt-1",
    }))));

    assert_eq!(tokens.id_token, None);
}

#[test]
fn test_missing_access_token_rejects_502() {
    let (status, message) = expect_reject(decide_exchange(ExchangeAttempt::Body(json!({
        "refresh_token": "rt-1",
    }))));

    assert_eq!(status, 502);
    assert!(message.contains("access_token"), "{message}");
}

#[test]
fn test_missing_refresh_token_rejects_502() {
    let (status, message) = expect_reject(decide_exchange(ExchangeAttempt::Body(json!({
        "access_token": "at-1",
    }))));

    assert_eq!(status, 502);
    assert!(message.contains("refresh_token"), "{message}");
}

#[test]
fn test_empty_string_is_treated_as_missing() {
    // `""` 与缺失必须同判：空串 token 会让上游请求带一个必然失败的凭证
    let (status, message) = expect_reject(decide_exchange(ExchangeAttempt::Body(json!({
        "access_token": "",
        "refresh_token": "rt-1",
    }))));

    assert_eq!(status, 502);
    assert!(message.contains("access_token"), "{message}");
}

#[test]
fn test_wrong_type_is_treated_as_missing() {
    // 上游返回数字/null 而不是字符串时不得恐慌，也不得当成有效 token
    let (status, _) = expect_reject(decide_exchange(ExchangeAttempt::Body(json!({
        "access_token": 12345,
        "refresh_token": null,
    }))));

    assert_eq!(status, 502);
}

// ── 解析函数直测（与决策表分开钉住） ────────────────────────────

#[test]
fn test_parse_function_accepts_valid_input() {
    let parsed = parse_token_exchange_response(json!({
        "access_token": "at",
        "refresh_token": "rt",
    }))
    .expect("合法响应应解析成功");

    assert_eq!(parsed.access, "at");
    assert_eq!(parsed.refresh, "rt");
    assert_eq!(parsed.id_token, None);
}

#[test]
fn test_parse_function_does_not_panic_on_non_object_json() {
    // 例如上游误返回 JSON 数组/字符串 —— 必须走拒绝分支，而不是 panic
    let (status, _) = expect_reject(decide_exchange(ExchangeAttempt::Body(json!(["x"]))));
    assert_eq!(status, 502);

    let (status, _) = expect_reject(decide_exchange(ExchangeAttempt::Body(json!("oops"))));
    assert_eq!(status, 502);
}

// ── 拦截判定（`intercept`）：原先内联在 `request_filter`，零测试 ──────────

const CB: &str = "/api/auth/callback";

#[test]
fn test_intercept_ignores_non_callback_path() {
    assert_eq!(
        intercept("/dashboard", "code=c&state=s", CB),
        CallbackOutcome::NotIntercepted
    );
}

#[test]
fn test_intercept_requires_exact_path_or_separator() {
    // 精确命中 → 是 callback（但缺参数 ⇒ 不进流程）
    assert_eq!(intercept(CB, "", CB), CallbackOutcome::NotIntercepted);
    // 紧随 `/` → 是 callback
    assert_eq!(
        intercept(&format!("{CB}/extra"), "code=c&state=s", CB),
        CallbackOutcome::Handle {
            code: "c".into(),
            state: "s".into()
        }
    );
    // ⚠️ 前缀但**无分隔符** ⇒ 不是 callback（否则 `/cb.evil` 这类路径会被放行）
    assert_eq!(
        intercept(&format!("{CB}XYZ"), "code=c&state=s", CB),
        CallbackOutcome::NotIntercepted
    );
}

#[test]
fn test_intercept_handles_callback_with_code_and_state() {
    assert_eq!(
        intercept(CB, "code=abc&state=xyz", CB),
        CallbackOutcome::Handle {
            code: "abc".into(),
            state: "xyz".into()
        }
    );
}

#[test]
fn test_intercept_requires_both_code_and_state() {
    // 半套参数不得进入流程（换 token 必然失败，且会消耗一次 state 校验）
    assert_eq!(
        intercept(CB, "code=abc", CB),
        CallbackOutcome::NotIntercepted
    );
    assert_eq!(
        intercept(CB, "state=xyz", CB),
        CallbackOutcome::NotIntercepted
    );
}

#[test]
fn test_intercept_error_param_takes_priority_over_code() {
    // IdP 显式拒绝时**不做** code/state 校验（RFC 6749 §4.1.2.1 的错误响应不带 code）
    assert_eq!(
        intercept(CB, "error=access_denied&code=abc&state=xyz", CB),
        CallbackOutcome::Denied
    );
    assert_eq!(
        intercept(CB, "error=access_denied", CB),
        CallbackOutcome::Denied
    );
}

#[test]
fn test_callback_denied_location_is_stable() {
    // 位置是契约字符串：改动它等于改动用户可见的跳转目标
    assert_eq!(CALLBACK_DENIED_LOCATION, "/login?error=oauth_denied");
}

// ── callback 校验序列（`check_callback`）：原先内联在 &mut Session 方法里 ──

fn cookie_header(
    state: &str,
    verifier: Option<&str>,
    nonce: Option<&str>,
    return_to: Option<&str>,
) -> String {
    let mut parts = vec![format!("oauth_state={state}")];
    if let Some(v) = verifier {
        parts.push(format!("pkce_verifier={v}"));
    }
    if let Some(n) = nonce {
        parts.push(format!("oauth_nonce={n}"));
    }
    if let Some(r) = return_to {
        parts.push(format!("return_to={r}"));
    }
    parts.join("; ")
}

#[test]
fn test_check_callback_without_cookie_header_redirects() {
    assert_eq!(
        check_callback(None, "state-1"),
        CallbackCheck::RedirectToLogin {
            reason: "invalid_state"
        }
    );
}

#[test]
fn test_check_callback_state_mismatch_precedes_missing_verifier() {
    // **顺序即语义**：state 不匹配时必须报 csrf_mismatch，
    // 不能因"同时缺 verifier"而降级成 invalid_state（那会掩盖 CSRF 失败）
    let header = cookie_header("other", None, None, None);

    assert_eq!(
        check_callback(Some(&header), "state-1"),
        CallbackCheck::RedirectToLogin {
            reason: "csrf_mismatch"
        }
    );
}

#[test]
fn test_check_callback_matching_state_but_missing_verifier_redirects() {
    let header = cookie_header("state-1", None, None, None);

    assert_eq!(
        check_callback(Some(&header), "state-1"),
        CallbackCheck::RedirectToLogin {
            reason: "invalid_state"
        }
    );
}

#[test]
fn test_check_callback_proceeds_with_verifier_nonce_and_return_to() {
    let header = cookie_header(
        "state-1",
        Some("ver-1"),
        Some("nonce-1"),
        Some("/dashboard"),
    );

    assert_eq!(
        check_callback(Some(&header), "state-1"),
        CallbackCheck::Proceed {
            verifier: "ver-1".into(),
            nonce: Some("nonce-1".into()),
            return_to: "/dashboard".into(),
        }
    );
}

#[test]
fn test_check_callback_defaults_return_to_to_root() {
    let header = cookie_header("state-1", Some("ver-1"), None, None);

    match check_callback(Some(&header), "state-1") {
        CallbackCheck::Proceed {
            return_to, nonce, ..
        } => {
            assert_eq!(return_to, "/");
            assert_eq!(nonce, None);
        }
        other => panic!("期望通过校验，实际是 {other:?}"),
    }
}

#[test]
fn test_check_callback_rejects_open_redirect_return_to() {
    // 开放重定向防护：绝对 URL 不得成为回跳目标，必须回落到 `/`
    for evil in [
        "https://evil.example.com/",
        "//evil.example.com",
        "javascript:alert(1)",
    ] {
        let header = cookie_header("state-1", Some("ver-1"), None, Some(evil));

        match check_callback(Some(&header), "state-1") {
            CallbackCheck::Proceed { return_to, .. } => {
                assert_eq!(return_to, "/", "不应接受 {evil}");
            }
            other => panic!("期望通过校验，实际是 {other:?}"),
        }
    }
}

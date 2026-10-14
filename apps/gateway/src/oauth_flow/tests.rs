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

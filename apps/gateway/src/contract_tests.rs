//! 跨语言**字面量**契约断言（Portal TypeScript ↔ Gateway Rust）
//!
//! 唯一真相源：`packages/contracts/src/cross-language-fixture.json`。TS 侧由
//! `packages/contracts/src/__tests__/cross-language-fixture.test.ts` 守护；本模块以
//! `include_str!` 消费同一文件，断言**本端常量 == 工件值**。
//!
//! ## 为什么需要它
//!
//! 这些值此前在两端都是手写字面量、靠注释同步（Rust 侧写着"与 @auth-sso/contracts
//! `XXX` 同步"），而两端测试各自只断言**自己那一份**，于是改一侧两端都绿：
//!
//! | 单侧改动 | 后果 |
//! |---|---|
//! | Portal 改 cookie 名 | Gateway 静默读不到 → 认证失败或读到空 |
//! | Gateway 改 jti 前缀 | 撤销**静默失效**（Gateway 写 A、Portal 读 B） |
//! | Discovery 字段改名 | Gateway 靠**旧名回退**继续工作 → 看不出坏了 |
//! | 收窄 client scopes | `/authorize` 跳转拿到 `invalid_scope` |
//!
//! 与 `auth/tests.rs` 的 claims 契约测试同一机制、同一工件目录。

use serde_json::Value;

/// 契约工件（与 `jwt-claims-fixture.json` 同一机制）。
const FIXTURE: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../packages/contracts/src/cross-language-fixture.json"
));

fn fixture() -> Value {
    serde_json::from_str(FIXTURE).expect("跨语言契约工件必须是合法 JSON")
}

/// 取工件里的字符串字段；缺失即 panic —— 改名/删名都会被这条断言抓住。
fn at<'a>(root: &'a Value, path: &str) -> &'a str {
    path.split('.')
        .try_fold(root, |node, key| node.get(key))
        .and_then(Value::as_str)
        .unwrap_or_else(|| panic!("契约工件缺少字段: {path}"))
}

#[test]
fn cookie_names_match_cross_language_fixture() {
    let f = fixture();
    assert_eq!(crate::cookie::ACCESS_COOKIE, at(&f, "cookies.jwt"));
    assert_eq!(crate::cookie::REFRESH_COOKIE, at(&f, "cookies.refresh"));
    assert_eq!(
        crate::oauth::PKCE_VERIFIER_COOKIE,
        at(&f, "cookies.pkce_verifier")
    );
    assert_eq!(
        crate::oauth::OAUTH_STATE_COOKIE,
        at(&f, "cookies.oauth_state")
    );
    assert_eq!(
        crate::oauth::OAUTH_NONCE_COOKIE,
        at(&f, "cookies.oauth_nonce")
    );
    assert_eq!(crate::oauth::RETURN_TO_COOKIE, at(&f, "cookies.return_to"));
}

#[test]
fn gateway_injected_headers_match_fixture() {
    let f = fixture();
    let user_id = at(&f, "gatewayHeaders.user_id");
    let user_jti = at(&f, "gatewayHeaders.user_jti");

    // 工件里存的是规范小写形态（contracts 侧写法）。钉住这一点，下面的
    // "忽略大小写"才是有意的放宽，而不是掩盖真实漂移。
    assert_eq!(user_id, user_id.to_ascii_lowercase());
    assert_eq!(user_jti, user_jti.to_ascii_lowercase());

    // HTTP 头名大小写不敏感：Gateway 侧写 "X-User-Id"，语义上与 "x-user-id" 同一个头
    assert!(crate::gateway::HEADER_USER_ID.eq_ignore_ascii_case(user_id));
    assert!(crate::gateway::HEADER_USER_JTI.eq_ignore_ascii_case(user_jti));
}

#[test]
fn jwt_typ_matches_fixture() {
    assert_eq!(
        crate::auth::verify::JWT_TYP_ACCESS,
        at(&fixture(), "jwtTyp.access_token")
    );
}

#[test]
fn jti_blocklist_prefix_matches_fixture() {
    assert_eq!(
        crate::auth::verify::JTI_BLOCKLIST_PREFIX,
        at(&fixture(), "redisKeyPrefixes.jti_blocklist")
    );
}

#[test]
fn authorize_scope_query_matches_supported_scopes() {
    let f = fixture();
    let expected: Vec<&str> = f["scopesSupported"]
        .as_array()
        .expect("scopesSupported 必须是数组")
        .iter()
        .map(|v| v.as_str().expect("scope 必须是字符串"))
        .collect();
    let actual: Vec<&str> = crate::oauth_flow::AUTHORIZE_SCOPE_QUERY
        .split('+')
        .collect();

    assert_eq!(
        actual, expected,
        "网关 /authorize 的 scope 必须与 contracts SCOPES_SUPPORTED 同集合（否则 Portal 回 invalid_scope）"
    );
}

#[test]
fn discovery_field_names_match_fixture() {
    let f = fixture();
    // 数组**首名**是带命名空间的新名；其余为部署错序期的旧名回退，属容错而非契约
    assert_eq!(
        crate::jwks::CUSTOM_FIELD_REFRESH_ENDPOINT[0],
        at(&f, "discoveryFields.refresh_endpoint")
    );
    assert_eq!(
        crate::jwks::CUSTOM_FIELD_CALLBACK_PATH[0],
        at(&f, "discoveryFields.callback_path")
    );
}

/// callback 路径**值**：原先散在三处、靠注释要求"变更时需三方同步"。
///
/// 现在两端都对同一工件断言 —— 改 Portal 声明而不改 Gateway 兜底（或反之）必然变红。
#[test]
fn oauth_callback_path_matches_fixture() {
    assert_eq!(
        crate::jwks::DEFAULT_CALLBACK_PATH,
        at(&fixture(), "discoveryFields.callbackPath")
    );
}

# JWT 显式类型化（RFC 8725 §3.11）—— typ header 与兼容期设计

**日期**: 2026-09-29
**关联**: docs/research/2026-09-29-pingora-rust-gateway-practices.md（§2）、docs/plans/2026-09-29-research-fixes-implementation-plan.md（F11）

## 问题复盘

同一签发密钥下的三类 JWT（LoginSession 5min / AccessToken 1h / ID Token 1h）共用 `PortalJwtClaims` 形状与 aud，均未设置 `typ` protected header。RFC 8725 §3.11 建议 JWT 显式类型化以防止**跨用途类型混淆**：客户端把 login_session 的值塞进 portal_jwt_token Cookie，Gateway 会将其当作合法 Access Token 接受（窗口 5min，权限相同故实际风险低，但语义防线缺失）。

## 修复方案

- **常量**：`@auth-sso/contracts` 新增 `JWT_TYP = { ACCESS_TOKEN: 'at+jwt', LOGIN_SESSION: 'login+jwt', ID_TOKEN: 'id+jwt' }`——两端共享的唯一真相源。
- **签发**：Portal 三个 `SignJWT` 调用的 `setProtectedHeader` 均携带对应 typ。
- **验签规则（兼容期核心）**：`typ 存在且不匹配预期即拒；缺失放行`。
  - Portal `verifyAccessToken(token, audience, expectedTyp?)`：调用方按用途传入（authorize 分支 A 验 login_session → LOGIN；userinfo/introspect/revoke/logout/verify-jwt → ACCESS；authorize 分支 B 按 Cookie 来源区分 LOGIN/ACCESS）。
  - Gateway `verify.rs`：`decode_header` 后校验 typ，新增 `VerifyError::InvalidTokenType` 变体。
- **兼容期自愈**：存量 token 无 typ，放行窗口 = 最长 TTL（AT 1h）。上线 1h 后存量清零；新签发的 login+jwt 被 Gateway 语义**立即**隔离，跨用途混淆对新增 token 即刻失效。无需迁移脚本。

## 最佳实践

- **多用途 JWT 必须显式类型**：只要同一密钥签发 >1 种用途的 JWT，就应引入 typ——不是"以后再说"项，类型混淆的攻击面在第一种用途出现时就存在。
- **验签规则用"存在且不符即拒、缺失放行"**：比"必须存在"多一层零迁移成本的兼容性，且不削弱对新增 token 的防护（新增 token 恒带 typ）。
- **两端常量单一真相源**：typ 值放 contracts，Rust 侧字面量 `"at+jwt"` 用注释锚定来源，漂移由 Gateway 集成测试兜底（`test_verify_rejects_mismatched_typ` / `test_verify_accepts_missing_typ_for_legacy_tokens`）。

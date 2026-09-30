# OAuth 端点元数据一致性 —— client_secret_basic 广告与实现同步

**日期**: 2026-09-29
**关联**: docs/research/2026-09-29-oidc-oauth2-provider-practices.md（F2）、docs/plans/2026-09-29-research-fixes-implementation-plan.md

## 问题复盘

discovery 元数据广告 `token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none']`，但 token / introspect / revoke 三个端点的凭证只从请求体读取（`parseOAuthBody`），`Authorization: Basic` 从未被解析。全库 grep 证实零实现。

后果：选择 Basic（主流 RP 库默认）的第三方客户端 100% 失败，且失败信息是"缺少 client_id"而非"不支持该认证方式"——元数据撒谎 + 错误误导，双重伤害接入体验。这是"配置面与行为面漂移"的同类问题（与 2026-07-28 沉淀的"证书变量声明未消费"同构）。

## 修复方案

新增 `apps/portal/src/lib/auth/client-credentials.ts` 的 `resolveClientCredentials(request, body)`，三个端点统一接入：

1. **Basic 优先**：`Authorization: Basic base64(client_id:client_secret)`，按 RFC 6749 §2.3.1 对两段做 urlencoded 解码（`decodeURIComponent`），按首个冒号切分（client_id 编码后不含冒号）。
2. **body 回退**：无 Basic 头时读 `client_id`/`client_secret` 字段（client_secret_post）。
3. **双通道冲突拒绝**：Basic 与 body 同时携带且不一致 → `InvalidClientError`（凭证混淆防御），一致时放行（冗余携带不是攻击）。
4. **宽松 base64**：`Buffer.from(x, 'base64')` 对非法输入不抛错，产出的垃圾凭证由既有定时安全比较拒绝——不在解析层重复造校验。

## 最佳实践

- **元数据必须与实现同步验收**：改 `TOKEN_ENDPOINT_AUTH_METHODS_SUPPORTED` 这类广告清单时，必须同步核对每个端点的真实解析路径；反之实现新通道时先补广告。
- **凭证解析收敛为单一函数**：多端点共享凭证语义时，解析层必须单点实现，杜绝"某端点支持 Basic、另一端点不支持"的局部漂移。
- **测试矩阵**：Basic 成功 / urlencoded 特殊字符 / 冒号切分 / body 回退 / 冲突拒绝 / 无凭证拒绝——见 `__tests__/api/client-credentials.test.ts` 与 `oauth2-token.test.ts` 的 Basic 用例。

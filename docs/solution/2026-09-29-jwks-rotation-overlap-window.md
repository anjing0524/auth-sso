# JWKS 密钥轮换重叠窗口 —— 提前轮换 + 发布宽限

**日期**: 2026-09-29
**关联**: docs/research/2026-09-29-oidc-oauth2-provider-practices.md（§6）、docs/plans/2026-09-29-research-fixes-implementation-plan.md（F3）

## 问题复盘

原实现存在两处叠加缺陷，净效果是**轮换零重叠窗口**：

1. `getActiveSigningKey` 只取 jwks 表最新一行，**过期后才生成**新密钥对；
2. JWKS 端点过滤 `expiresAt > now`，过期公钥**立即**从发布集消失。

90 天密钥过期瞬间：新签名立即用新 kid（或短暂无密钥），而 JWKS 中旧 kid 消失——持旧 AT（TTL 1h）的外部验签方（Gateway）一旦 JWKS 缓存失效或进程冷启动，kid 未命中 → 验签失败 → 存量用户被迫重登。RFC 7517 本身不规定轮换窗口，但业界共识（多厂商一致实践）：**旧公钥保留至以其签发的全部 token 过期**。

## 修复方案（双管齐下，Portal 侧根治）

常量入 `@auth-sso/contracts`（单一真相源）：

- `JWKS_RENEW_AHEAD_SECS = 24h`：签名密钥到期前 24h 进入续期窗口，窗口内首次取钥即生成新对——新签名从过期前一天就切到新 kid；
- `JWKS_PUBLISH_GRACE_SECS = 2h`：过期公钥在 JWKS 发布集保留 2h（≥ max(AT_TTL, ID_TOKEN_TTL) + 时钟偏移），随后自然移除。

代码触点：

- `signing-keys.ts`：`needsGen` 与锁内 recheck 的判定从"未过期"改为"未进入续期窗口"；
- `jwks/route.ts`：过滤条件从 `expiresAt > now` 改为 `expiresAt > now - GRACE`。

Portal 自身验签（`getSigningKeyByKid`）本就不筛过期，不受影响；Gateway 侧 24h 缓存宽限（`jwks.rs` `JWKS_KEY_GRACE_SECS`）继续覆盖缓存内场景——本修复根治的是"冷启动拉到的 JWKS 缺旧 kid"这一源头。

## 最佳实践

- **轮换三要素缺一不可**：新密钥提前生成、双密钥签名/验签共存、旧公钥发布 ≥ 最大 token TTL。只做其一，窗口仍是零。
- **常量放 contracts**：轮换窗口与 TOKEN_TTL 数学相关（GRACE ≥ max(TTL)），放同一文件让约束可看见。
- **测试锚定窗口边界**：到期前 25h/23h 两点验选取行为；过期 1h（宽限内可见）/ 3h（宽限外移除）两点验发布集——见 `__tests__/api/jwks-rotation.test.ts`。

# 公开 URL 推导收成一个纯函数 —— 并修掉被测试钉成规范的尾斜杠不对称（架构评审 R2 次级候选）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（次级候选「公开 URL 推导：从四个缓存 getter 收进一个接受 env 的纯函数」）
> 关联 ADR：**ADR-012**（OIDC 协议一致性——"issuer 必须与 discovery URL 同源"）
> 词汇：module / interface / implementation / seam / leverage / locality

## 一、问题总结

### 1. 同一条推导，判据却不一致（真实缺陷）

`packages/config/src/env.ts` 里三个 getter 各自内联同一段推导，但**归一判据不同**：

```ts
getAppBaseURL() → NEXT_PUBLIC_APP_URL.trim().replace(/\/+$/, '')   // 去尾斜杠
getIssuer()     → (PORTAL_ISSUER || appBaseURL).trim()             // 只 trim
getJwksUri()    → (PORTAL_JWKS_URI || `${appBaseURL}/api/auth/jwks`).trim()  // 只 trim
```

于是运维按最自然的方式配置 `PORTAL_ISSUER=https://sso.example.com/`（**一个尾斜杠**）时：

- Discovery 的 `issuer` 变成 `https://sso.example.com/`
- 而 RP 用 `https://sso.example.com` 去取 `/.well-known/openid-configuration`
- ADR-012 自己写明"**issuer 必须与 discovery URL 同源**"（OIDC Discovery §4.3：issuer MUST be identical
  to the Issuer URL used as the prefix）⇒ **严格的 OIDC RP 以 issuer 不匹配拒绝登录**

同一段代码里 `getAppBaseURL` 已经把这个坑填了，`getIssuer` / `getJwksUri` 却留着。

### 2. 这个不对称**被写成了规范**

`apps/portal/src/lib/env.test.ts` 原文：

```ts
Reflect.set(process.env, 'PORTAL_ISSUER', 'https://issuer.example.com/');
expect(getAppBaseURL()).toBe('https://sso.example.com');        // 去斜杠 ✓
expect(getIssuer()).toBe('https://issuer.example.com/');        // 保留斜杠 ← 写成了期望
```

> **同一种疾病在本仓第三次出现**：R9（子树谓词漏后代被写成期望）、R13（CSV 三列恒空被断言绕过）、
> 本轮（判据不一致被写成期望）。**把缺陷写成规范，会让正确实现变红。**

### 3. 推导只能靠"改全局 + 重置"来测

唯一接受 env 注入的入口 `parsePortalEnv` **全仓零消费者**（只被 `apps/portal/src/lib/env.ts` re-export）；
实际被消费的是读模块级缓存单例的 getter（`getIssuer` 18 处、`getAppBaseURL` 15 处、`getJwksUri` 3 处）。
测试因此必须 `Reflect.set(process.env, …)` + `resetConfig()`——**全局状态驱动的测试**。

## 二、修复方案

### 1. 一个纯函数承载全部推导

```ts
export function resolvePublicUrls(env: PublicUrlEnv): PublicUrls  // { appBaseURL, issuer, jwksUri }
function stripTrailingSlashes(url: string): string                // 私有：唯一归一判据
```

判据统一为「**先 trim、再去尾斜杠**」——三个公开 URL 一致。
三个 getter 各收成一行：`return resolvePublicUrls(getConfig()).issuer;`（getter = 缓存视图包装）。

### 2. 更正被钉成规范的期望

`env.test.ts` 的 `expect(getIssuer()).toBe('https://issuer.example.com/')` →
`'https://issuer.example.com'`，并在原地记录"此前这里把不对称写成了规范"。

### 3. 新增注入式测试

`resolvePublicUrls` 直接喂 env，**不碰 `process.env` 与全局缓存**：
- 三个 URL 一律去尾斜杠（含首尾空白与多重斜杠）
- 未显式配置时按 ADR-012 默认推导（issuer ← appBaseURL；jwksUri ← appBaseURL + 路径）
- **`issuer` 恒与取 metadata 的基址同源**（尾斜杠不得让它变成另一个字符串）

### 4. `parsePortalEnv` 的处置：记录，不删

它是严格 schema 的解析入口（有类型价值），但**当前零消费者**。按本仓纪律"发现无关死代码只报告不删除"，
本轮在文档与 issue 中记录其状态，交由后续决定（可能与 `PortalEnv` 类型一起收敛）。

## 三、同类普查

| 检查项 | 结论 |
|---|---|
| `getIssuer()` 的 18 处用法 | **全部是"标识符整体"位置**（`setIssuer`、Discovery `issuer`、RFC 9207 `iss` 参数）——从不拼接路径 ⇒ 归一化零副作用 |
| `${getIssuer()}` 类拼接 | **零**（故尾斜杠从未造成双斜杠路径，危害是 issuer 身份串不一致） |
| `getAppBaseURL()` 15 处 / `getJwksUri()` 3 处 | 均为整体使用 ✓ |
| Gateway 是否校验 `iss` | 否（只校验签名 / exp / typ / jti）⇒ 本缺陷不影响网关 |
| `parsePortalEnv` | 零消费者（记录） |

## 四、验证

### 变异 K：退回修复前的不对称

把 `issuer` / `jwksUri` 改回只 `.trim()`（显式配置不去尾斜杠）：

```
× resolves non-database settings without DATABASE_URL
     AssertionError: expected 'https://issuer.example.com/' to be 'https://issuer.example.com'
× 三个公开 URL 一律去掉尾斜杠（含首尾空白与多重斜杠）
× **issuer 恒与取 metadata 的基址同源**：尾斜杠不得让它变成另一个字符串
→ Tests 3 failed | 2 passed (5)
```

**3 条精确变红**，失败信息里就是旧行为（`'…example.com/'`）；默认推导那条与 DATABASE_URL 那条保持绿。
还原后哈希 `b541791f5edf4644…159c60` 逐字一致。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **92 文件 / 761 用例全绿**（+3 纯函数用例） |
| `tsc --noEmit`（packages/config + apps/portal） | 0 错误 |
| `eslint`（portal 改动文件） | 0 问题 |

## 五、最佳实践（可复用）

1. **同一语义的两次归一，迟早分叉。** `getAppBaseURL` 去尾斜杠、`getIssuer` 不去——两条代码在同一文件、
   相隔十行，仍漂移了；而漂移的后果是 **OIDC 互操作失败**（最难在生产复现的一类）。
   **同一策略只留一个实现，是唯一可靠的约束方式。**
2. **"被配置成什么样"也是接口的一部分。** `PORTAL_ISSUER` 是运维手填的字符串；**一个尾斜杠就改变协议身份**。
   库的职责是把"等价写法"折叠成同一个值（`https://x` ≡ `https://x/`），而不是把归一责任推给运维。
3. **测试里的"奇怪期望值"要先怀疑，再解释。** `expect(...).toBe('https://issuer.example.com/')`
   与相邻行的 `'https://sso.example.com'` 判据不一致——**同一测试里两个 URL 一个带斜杠一个不带，
   本身就是信号**。本仓已第三次因此吃亏（R9 / R13 / 本轮）。
4. **纯函数是"可注入"的最小单位。** 候选里说要"收进一个接受 env 的纯函数"，其价值不在减少行数，
   而在**测试不必再驱动全局状态**：`resolvePublicUrls(env)` 直接喂值，`process.env` + `resetConfig()`
   的组合拳只留给真正需要验证缓存边界的那一条用例。
5. **记录死代码而不是顺手删。** `parsePortalEnv` 零消费者，但它是类型严格的解析入口；
   本轮只做记录与显式声明，避免"重构时顺手删掉别人正要用的东西"。

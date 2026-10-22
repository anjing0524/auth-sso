# 错误码收成闭合词汇表 —— 以及「守卫放在不被检查的地方等于没有守卫」（架构评审 R2 次级候选）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（次级候选「错误码词汇表：从字符串常量袋收成闭合类型」）
> 关联 ADR：ADR-019（Controller 职责约束）、`docs/portal-architecture-guidelines.md` §3.4（错误映射）
> 词汇：module / interface / implementation / seam / leverage / locality

## 一、问题总结

`packages/contracts/src/errors.ts` 是 **56 个字符串常量的袋子**（零行为，interface 与 implementation 等大），
而没有任何类型把这些值闭起来：

- `DomainError.code` 是裸 **`string`**（`apps/portal/src/domain/shared/errors.ts`）
- 两张映射表以字符串为键：`ERROR_STATUS: Record<string, number>`（缺项 `?? 400`）、
  `OAUTH_ERROR_MAP: Record<string, string>`（缺项 `?? 'invalid_request'`）

### 词汇表外的码已经上网

```ts
export class InvalidScopeError extends DomainError {
  constructor(message: string = '请求的 scope 未获 Client 授权') {
    super('INVALID_SCOPE', message);   // ← 该码在 contracts 全库不存在
  }
}
```

`INVALID_SCOPE` 不在 56 个码里（实测确认），却被 `OAUTH_ERROR_MAP` 当键用
（`INVALID_SCOPE: 'invalid_scope'`），并作为 `error` 原样进入 API 响应。

### 测试把这个洞**反向固化**了

```ts
it('AccountStatusError → 403', () => {
  const r = mapDomainError(new AccountStatusError('DISABLED', '账号已禁用'));
  //                                                 ↑ 一个**账号状态值**，不是错误码
  expect(r.status).toBe(403);
});
```

`AccountStatusError(code: string, …)` 接受任意字符串，测试只断言 `status` ⇒ 「错误码可以是任意字符串」
这件事被写成规范。而生产调用方（`login.ts:37,38,40`）**本来就传 contracts 常量** —— 只有测试在裸写。

## 二、修复方案

### 1. contracts：把词汇表闭起来

```ts
export const ERROR_CODE_VALUES = [
  ...Object.values(COMMON_ERRORS), ...Object.values(AUTH_ERRORS), ...Object.values(USER_ERRORS),
  ...Object.values(DEPARTMENT_ERRORS), ...Object.values(ROLE_ERRORS),
  ...Object.values(PERMISSION_ERRORS), ...Object.values(CLIENT_ERRORS),
] as const;
export type ErrorCode = (typeof ERROR_CODE_VALUES)[number];
```

按分组**派生**（不手写第二份），并把缺的码补进词汇表：
`AUTH_ERRORS.INVALID_SCOPE = 'AUTH_SSO_2037'`（RFC 6749 §4.1.2.1 `invalid_scope` 对应的内部码，
取 203x 段的下一个空位）。`INVALID_SCOPE` 字面量全仓只有 2 处引用、无测试断言 ⇒ 改名零破坏。

### 2. 消费端全部键入

| 位置 | 改动 |
|---|---|
| `DomainError.code` | `string` → `ErrorCode` |
| `AccountStatusError(code, …)` | `string` → `ErrorCode` |
| `InvalidScopeError` | `super(AUTH_ERRORS.INVALID_SCOPE, …)` |
| `ErrorMapping.error` | `string` → `ErrorCode`（映射输出也闭合） |
| `OAUTH_ERROR_MAP` | `Record<string, string>` → `Partial<Record<ErrorCode, string>>` |
| `mapToOAuthError(internalError)` | `string` → `ErrorCode` |

**类型收窄立刻抓出两处既有洞**（这是收窄的直接价值）：

```
shared-kernel.test.ts(38,53): error TS2345: Argument of type '"DISABLED"' is not assignable to
  parameter of type '"AUTH_SSO_1000" | … | "AUTH_SSO_7005"'
error-mapping.ts(77,10): error TS7053: Element implicitly has an 'any' type because expression of
  type 'string' can't be used to index type 'Partial<Record<ErrorCode, string>>'
```

### 3. 更正被固化的测试

`new AccountStatusError(AUTH_ERRORS.ACCOUNT_DISABLED, …)`，并把断言从「只查 status」加强为
**同时断言错误码原样流出**（`expect(r.error).toBe(AUTH_ERRORS.ACCOUNT_DISABLED)`）。

### 4. 值不变量 + `ERROR_STATUS` 双向守卫

- **contracts 值不变量测试**：词汇表与 7 个分组派生一致、**无重复值**、全部匹配
  `^AUTH_SSO_\d{4}$`、`INVALID_SCOPE` 已入表。
- **`ERROR_STATUS` ↔ `DomainError` 子类集合相等**（源码比对）：`mapDomainError` 以**类名**查表
  （两个子类可共用同一码却映射不同状态：`DuplicateEntityError` → 409 与
  `BusinessRuleViolationError` → 422 都带 `VALIDATION_ERROR`，故只能按类名），
  于是两种漂移都是静默的：**漏登记**（新子类全变 400）与**键名拼错**。
  守卫做**双向**集合比对，并自测两个解析器（漏登记 / 拼错键名都能抓）。

## 三、一个真发现：守卫放在不被检查的地方 = 没有守卫

第一版把类型层断言放在 `packages/contracts/src/__tests__/errors.test.ts`：

```ts
// @ts-expect-error 'INVALID_SCOPE' 不在词汇表内
const NOT_A_CODE: ErrorCode = 'INVALID_SCOPE';
```

**变异验证暴露了它**：把 `ErrorCode` 退化成 `string` 后，`cd packages/contracts && npx tsc --noEmit`
**仍然通过**——因为该包 `tsconfig.json` 的 `exclude` 里写着 `src/__tests__`：

```json
"include": ["src/**/*"],
"exclude": ["node_modules", "dist", "src/__tests__"]
```

⇒ **`packages/contracts` 的测试根本不被类型检查**（该包只有 `typecheck` / `test` 两个脚本，
`typecheck` 用的就是这个 tsconfig）。我的守卫只是装饰。

处置：把**类型层断言移到 portal 侧**（`apps/portal/src/domain/shared/__tests__/shared-kernel.test.ts`
——它消费 `ErrorCode`，且 portal 的 tsconfig 包含测试文件），并**再验一次**。
「contracts 测试不被类型检查」作为既有缺口另记 issue（含 `@types/node` 在该包缺失这一诱因）。

## 四、验证

| 变异 | 结果 |
|---|---|
| **L（第一版位置）** `ErrorCode = string` | `packages/contracts` tsc **仍通过** ⇒ 守卫无效，**成为本节的核心发现** |
| **L2（迁移后位置）** `ErrorCode = string` | portal tsc **报错** `TS2578: Unused '@ts-expect-error' directive`（第 83 行＝守卫行）⇒ 保护失效**立刻可见** |
| **N** 新增 `QuotaExceededError` 但不登记 `ERROR_STATUS` | 集合守卫**精确变红**（自测用例保持绿） |

哈希还原逐字一致：`packages/contracts/src/errors.ts` = `b343fd90e5c6fcfd…c248a2a8`、
`apps/portal/src/domain/shared/errors.ts` = `22ba5b511c42711a…80e8d072`。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **94 文件 / 768 用例全绿**（92/761 → +2 文件 +7 用例） |
| `tsc --noEmit`（contracts + portal） | 0 错误 |
| `eslint`（改动文件） | 0 问题 |

## 五、最佳实践（可复用）

1. **"常量袋子"要有闭合类型，否则它只是命名约定。** 56 个码的袋子 + 裸 `string` 的 `code`
   ＝ 任何字符串都能当错误码；`InvalidScopeError` 就是这么来的。**把值派生出一个联合类型，
   词汇表外的码就变成编译错误** —— 这比"记得用常量"强一个数量级。
2. **类型收窄是最便宜的缺陷扫描器。** 把 `code: string` 收窄后，编译器**立刻**报出
   「测试传状态值当错误码」与「`mapToOAuthError` 用 `string` 索引已键入的表」两处既有洞。
   **先收窄、再修报错**，比人工 grep 可靠。
3. **守卫的价值 = 它被检查的强度。** 一条 `@ts-expect-error` 放在不被 `tsc` 覆盖的目录里，
   等于装饰。**写完守卫必须验证它会失败**（本轮的变异 L 就是为此，并真的抓出了这个洞）。
   这与 R9 的"守卫自身也会写错"、R1 的"类型退化让 `@ts-expect-error` 失效"是同一课题的第三面。
4. **映射表的兜底是遮羞布还是协议要求，要想清楚。** `ERROR_STATUS` 的 `?? 400` 掩盖漏登记
   （⇒ 用集合守卫钉死）；`OAUTH_ERROR_MAP` 的 `?? 'invalid_request'` 则是 RFC 6749 §5.2 的默认码
   （⇒ 保留，但键键入词汇表，使它不再掩盖词汇表漂移）。**同样是兜底，一个该拆、一个该留。**
5. **测试里的"随便传个值"会变成规范。** `new AccountStatusError('DISABLED', …)` 只是图省事，
   却把"错误码可以是任意字符串"固定了下来。**测试里出现生产不成立的输入形状，就该警觉。**

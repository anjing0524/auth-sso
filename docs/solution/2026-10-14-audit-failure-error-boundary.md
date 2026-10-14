# 审计失败的错误边界：替身不要手写包装器的行为（#87）

> 日期：2026-10-14
> 来源：**#87**（#84 同类普查时标为"机制不同，需单独判定"的那一处）
> 关联：`lib/auth/guard.ts`（错误边界）、#71 / #84（同类"测试钉住 mock"）
> 词汇：module / interface / seam / leverage / locality

## 一、核实：两条事实都对，但结论相反

| 事实 | 证据 |
|---|---|
| 审计写入**在事务内** | 路由里 `await appendSecurityAudit(tx, {…})` 与角色替换同一个 `db.transaction` ⇒ **失败即整体回滚**（测试的核心断言，价值真实 ✓） |
| 错误边界**吞掉一切** | `withPermission`（`lib/auth/guard.ts:71-77`）`catch` 后 `mapServerError` ⇒ 审计失败应返回 **500 响应**，而**不是**把异常抛给调用方 |
| 测试断言 | `await expect(assignRoles(...)).rejects.toThrow('审计存储不可用')` ❌ **与生产相反** |

⇒ 该用例真正有价值的是**回滚**（读 DB 断言），而"抛错"只是**替身的行为**。

## 二、根因：替身手写了包装器的行为，并且**为不一致辩护**

测试文件里的 `withPermission` 是**手写复刻**：

```ts
withPermission: vi.fn(async (_options, handler) => {
  try {
    return await handler('…101');
  } catch (err) {
    if (err instanceof DomainError) { /* 手写一张 code → status 表 */ }
    throw err;              // ← 非 DomainError 照常抛出
  }
}),
```

注释写着：

> 与真实包装器一致：领域错误映射为 HTTP 响应（DomainError.code → 状态码），
> **其余异常照常抛出（审计失败回滚用例依赖这一点）**。

**这句话就是缺陷的收据**：①它承认替身与生产不一致；②它把这个不一致**说成用例的需要**——
而回滚发生在错误边界**之前**（事务在路由内），根本不需要"抛给调用方"。

§ 手写的状态码表还**漂移**了：它按 **code** 映射（VALIDATION_ERROR → 422），
而生产按 **`constructor.name`** 经 `ERROR_STATUS` 映射（`BusinessRuleViolationError` → 422）——
两套规则只在巧合的地方一致。

## 三、修法：保留 auth-bypass，但**复用生产的映射**

```ts
vi.mock(import('@/lib/auth'), async (importOriginal) => {
  const actual = await importOriginal();
  const { mapServerError } = await import('@/lib/server-error');   // ← 生产实现
  return {
    ...actual,
    withPermission: async (_options, handler) => {
      try {
        return await handler('…101');
      } catch (err) {
        const mapped = mapServerError(err);                          // ← 不再手写
        return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
      }
    },
    logServerDataRead: vi.fn(async () => {}),
  };
});
```

- **auth-bypass 保留**（它声明的是"已授权"这一输入，正当 ✓）；
- **错误映射不再被复刻**：直接调生产的 `mapServerError` ⇒ 不可能漂移 ✓；
- `importOriginal()` + spread 使未列出的导出走真身 ✓（本仓库第 5 次踩过的 partial-mock 陷阱）。

用例改为断言**生产契约**，同时**保留回滚这一核心证据**：

```ts
const response = await assignRoles(request({ roleIds: [ROLE_ID] }), params());

expect(await roleIds()).toEqual([OLD_ROLE_ID]);          // 事务回滚（本用例的价值）
expect(response.status).toBe(500);                       // 而非抛出
expect((await response.json()).error).toBe(COMMON_ERRORS.INTERNAL_ERROR);
```

## 四、验证

| 项 | 结果 |
|---|---|
| 该文件 | **9/9 全绿** |
| `pnpm test` | **98 文件 / 815 用例全绿** |
| `tsc --noEmit` | 0 |
| `eslint` | 0 error（1 条 warning 既有：`var td`——文件注释说明是为规避 TDZ 的有意写法） |

## 五、最佳实践（可复用）

1. **替身不要手写包装器的行为。** 要么用真身（首选），要么**复用生产的映射函数**——
   手写的"等价实现"必然漂移（本处按 code vs 生产按类名）。
2. **当注释为"替身与生产不一致"辩护时，把它当成一处缺陷的收据。**
   "其余异常照常抛出（…用例依赖这一点）"——这类句子出现的每一处，都值得问：
   **用例真正要钉的是什么？** 本例要钉的是**事务回滚**，它不需要那个不一致。
3. **把一条断言的"证据价值"与"契约"分开。** 回滚是**证据**（读 DB 状态）；
   "抛错/返回 500"是**契约**。分开之后，前者保留、后者改为生产 ✓。
4. **`auth-bypass` 的边界要划在"输入"上。** 它只该替换"谁已登录/已授权"这一输入；
   连**错误映射**一起替换，就等于把被测语义的一部分也删掉了。

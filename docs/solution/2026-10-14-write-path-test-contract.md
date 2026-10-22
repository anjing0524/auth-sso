# 写路径的测试契约：让 `withAuth` 跑真身（#71 的测试那一半）

> 日期：2026-10-14
> 来源：R2 第二轮候选 **R11**（Worth exploring）的**结构**那一半；缺陷那一半是 #70（已修）
> 关联 ADR：**ADR-022**（测试真实性）、ADR-001（管理员绕过）、ADR-011（故障分级）
> 词汇：module / interface / seam / leverage / locality

## 一、问题：测试同时钉住两种**相反**的领域错误契约

`user-actions.test.ts` 把 `@/lib/auth` 整体替换为：

```ts
withAuth: (_o, h) => async (...a) => h({ userId: '…101' }, ...a),
```

于是**权限判定与错误映射双双消失**，领域错误直接以 reject 逃逸。而生产契约恰恰相反——
`withAuth`（`lib/auth/guard.ts:38-49`）在内部 catch 领域错误：

```ts
} catch (err: unknown) {
  const mapped = mapServerError(err);
  return { success: false, error: mapped.error, message: mapped.message };
}
```

⇒ **`withAuth` 从不放领域错误逃逸。** 同一文件里因此并存：

- **5 处** `rejects.toThrow(...)`（**mock 产物**，与生产相反）
- **2 处** `success === false`（生产契约）

`department-actions.test.ts` 同形（4 处），且我在 #81 期间新加的那条测试**也照着 mock 契约写了**
（`rejects.toMatchObject({ code })`）——**即我自己的残留**。

## 二、修法：只替换身份，让鉴权链路跑真身

关键事实（读代码得到）：`check-permission.ts` 从 **`./verify-jwt`** 直接导入 `resolveIdentity`
（不走 `@/lib/auth` 桶），且 `checkPermission` 有 **`SUPER_ADMIN` 绕过**（ADR-001）——
而测试台早已播种该角色。

⇒ 只需把 mock 目标换成身份解析：

```ts
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；…
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, resolveIdentity: async () => ({ userId: '…101', expiresAt: null, issuedAt: null }) };
});
```

于是**权限门、范围守卫、错误映射、审计全部真实执行**，断言改为生产契约：

| 场景 | 断言 |
|---|---|
| 不存在实体 | `success === false` 且 `error === COMMON_ERRORS.NOT_FOUND` |
| 领域规则违反 | `success === false` 且 `error === COMMON_ERRORS.VALIDATION_ERROR` + `message` 含规则文案 |
| 根部门（#81） | `success === false` 且 `error === DEPARTMENT_ERRORS.CANNOT_DELETE_ROOT` ⇒ **专属码真正到达客户端**（这正是 #81 想要的） |

### 验证：先把红取出来

换成真身后**未改断言先跑**，5 条立刻红，且失败信息正是问题本身：

```
AssertionError: promise resolved "{ success: false, …(2) }" instead of rejecting   ×5
```

⇒ 「reject 契约」被证明是 **mock 的产物**，而不是生产行为 ✓。

## 三、过程中的两次自我纠错（值得记下来）

1. **第一版红是"错的红"**：`department-actions.test.ts` 的叶子删除用例红了，
   我一度怀疑是基础设施（Redis 权限缓存）。逐层排查后发现：**是我自己在清理临时探针时，
   正则把该用例的 `seedTestData(...)` 一行一并删掉了**——测试在跑一个"库里只有根部门"的状态。
   教训与 R10/R19 同源：**红的成因必须先确认**，否则会去"修"一个不存在的问题。
2. **一个残留标记的误导**：调试中读到 Redis 里存在 `portal:user_perms:…:null` 标记
   （`getUserPermissionContext` 对"用户不存在"写的 60s 防穿透标记），一度怀疑"每用例没清 Redis"。
   **决定性实验**：手工写入该标记（TTL 600）后只跑该用例 → **通过** ⇒ 每用例 `FLUSHDB` 有效
   （`vitest.api.setup.ts` + `vitest.api.config.ts` 的 `REDIS_URL` 决定性覆盖，
   且 `fileParallelism: false`），基础设施无问题。
   **教训**：怀疑基础设施前，先用一个能推翻它的实验。

**确定性验证**：两个文件各连跑 3 次，分别 15/15、10/10 全绿 ✓。

## 四、同类普查（本轮按纪律做了）

| 文件 | `rejects.toThrow` 处数 | 状态 |
|---|---|---|
| `user-actions.test.ts` | 5 | **已修** |
| `department-actions.test.ts` | 4（+1 处 #81 的 matchObject） | **已修** |
| `role-actions.test.ts` | 4 | 同形，另记 issue |
| `department-api.test.ts` | 3 | 同形（调用的也是 Server Action） |
| `permission-actions.test.ts` | 2 | 同形 |
| `client-actions.test.ts` | 2 | 同形 |
| `user-role-api.test.ts` | 1 | **机制不同**：断言审计模块抛错穿透路由，属另一课题 |

普查方法：`grep -rln "vi.mock(import('@/lib/auth')" __tests__/` 得 13 个文件，
再逐文件数 `rejects.toThrow`（13 中 6 个命中，其中 1 个机制不同）。**其余 11 处已记 issue，
并附上可直接套用的修法**（本轮已验证可行）。

## 五、门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **96 文件 / 786 用例全绿** |
| `tsc --noEmit` | 0 错误 |
| `eslint`（两个改动文件） | 0 error；1 条 warning 为**既有**（`DEPT_ID` 未使用，R18 已对 HEAD 证明） |
| 确定性 | 两文件各连跑 3 次全绿 |

## 六、最佳实践（可复用）

1. **mock 掉一个"包装器"时，要连它的可观测契约一起保留或换成真身。** 替换 `withAuth` 为裸调用，
   等于顺手删掉了**错误映射**这一可观测行为——测试于是钉住了与生产相反的契约。
   **要么用真身，要么让替身保持契约**（本轮选了前者：能跑真身就不该写替身）。
2. **替换的粒度越细越好。** `auth-bypass` 只需要**身份**这一个输入；连权限门一起替换是"顺手多帮了"，
   代价是**权限与映射再也测不到**。⇒ mock 目标从桶模块（`@/lib/auth`）收到单一能力模块
   （`@/lib/auth/verify-jwt`），是同时提升真实性与精确性的做法。
3. **同一文件里出现两种相反的断言形状，就是坏味道。** 5 处 reject + 2 处失败信封并存，
   说明"哪个是契约"已经没人知道了。**断言形状必须唯一且来自生产代码。**
4. **改契约前先把红取出来**：不改断言先跑，红的信息（`promise resolved "…" instead of rejecting`）
   本身就是"原契约是 mock 产物"的证据。
5. **先排除自己动的手脚，再怀疑基础设施。** 本轮两次误判（夹具被自己删、残留标记）都源于此。
   对基础设施的怀疑，要用**能推翻它的实验**来裁定（本轮：手工植入标记后重跑）。

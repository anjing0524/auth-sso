# 让"可判别的失败原因"真的被消费 —— 以及文档 ↔ 线值的机械对齐（#92 / #93）

> 日期：2026-10-14
> 来源：**#92**（#82 的价值兑现点）、**#93**（`docs/spec` ↔ `contracts` 的人工对齐）
> 关联：#82（接通专属码）、`CODING_STANDARDS.md` §7、R30 的 `API.md` 残留
> 词汇：module / interface / seam / leverage / locality

## 一、#92：服务端能报具体码了，前端却还在解析中文

### 问题（实测证据）

#82 把冲突码真正发射出来（`USERNAME_ALREADY_EXISTS` / `EMAIL_ALREADY_EXISTS` /
`MOBILE_ALREADY_EXISTS` / `PASSWORD_TOO_WEAK` / …），但前端**零消费**：

```text
$ grep -rn "USERNAME_ALREADY_EXISTS|EMAIL_ALREADY_EXISTS|PASSWORD_TOO_WEAK" apps/portal/src --include=*.tsx
(空)
$ grep -n "error" apps/portal/src/app/(dashboard)/users/components/UserTable.tsx
154:        toast.error(res.message || '操作失败');
```

⇒ 客户端只有 `res.message` 这段中文。**#82 建立的能力没有被用上**，而文案一改，
展示与语义就脱钩——这正是"可判别"存在的理由。

### 修法：一个纯映射 + 一条自维护断言

`apps/portal/src/domain/shared/error-fields.ts`（纯函数，无副作用）：

```ts
export const ERROR_CODE_FIELDS = {
  [USER_ERRORS.USERNAME_ALREADY_EXISTS]: 'username',
  [USER_ERRORS.EMAIL_ALREADY_EXISTS]: 'email',
  [USER_ERRORS.MOBILE_ALREADY_EXISTS]: 'mobile',
  [USER_ERRORS.USER_ALREADY_EXISTS]: 'username',   // 复合唯一约束：无从判断是哪一列
  [USER_ERRORS.PASSWORD_TOO_WEAK]: 'password',
  [ROLE_ERRORS.ROLE_ALREADY_EXISTS]: 'code',
  [DEPARTMENT_ERRORS.DEPARTMENT_ALREADY_EXISTS]: 'code',
  [PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS]: 'code',
  [CLIENT_ERRORS.CLIENT_ALREADY_EXISTS]: 'clientId',
} as const satisfies Partial<Record<ErrorCode, ErrorField>>;
```

`fieldForErrorCode()` 对**非字段级**原因返回 `null`（403/404/500 不是"某个输入框写错了"）。

**接线**（`CreateUserDialog`）：命中的字段就地渲染 `role="alert"` + `aria-invalid`，
**未命中的才走 toast**（不重复提示）。

**自维护**（本文件的核心价值）：`error-fields.test.ts` 断言
**契约里每个 `*_ALREADY_EXISTS` 码都必须有映射**——新增冲突码却忘了映射，测试立刻变红，
不会又悄悄退回"解析中文文案"。

> **途中一次值得记的红**：这条断言第一版用 `ERROR_CODE_VALUES.filter(v => v.endsWith('_ALREADY_EXISTS'))`
> ⇒ 结果 0，测试报 `expected 0 to be >= 8`。原因是 **`ERROR_CODE_VALUES` 装的是线值
> （`AUTH_SSO_3003`），不是键名**。改从错误组的**键**取才正确。
> 教训：自维护断言的**取材**要写清是键还是线值——否则它会以"取到了空集"的方式假绿/假红。

**本轮范围（如实说明）**：只接线了用户创建路径（#82 的码就是为它引入的）；
其余四个表单（角色/部门/权限/客户端）用同一张映射即可，属后续增量。
**未加组件级测试**：jsdom 下 Radix Dialog + React 19 form action 的组合成本高于收益，
而**判定逻辑**（码 → 字段）已被 5 条直测覆盖。

## 二、#93：`docs/spec` 与 `contracts` 必须机械对齐

### 为什么

契约码是**线值**，文档、前端、外部集成都按它对接，但两者之间此前只有**人工**对齐，而两者都在动：

- R30 我在 `API.md` 留下过已删除的 `AUTH_SSO_1001` / `AUTH_SSO_1007`；
- #82 把契约码从 **57 删到 33** ⇒ 每次删码都可能让文档变成谎言。

### 检查（两条互补规则）

`apps/portal/__tests__/api/docs-api-error-codes.test.ts`：

1. **键与线值双向对齐**：文档里的 `` `AUTH_SSO_<n>` (`NAME`) `` 对，必须在契约中存在键
   `NAME`，且它的值**就是** `AUTH_SSO_<n>`。（只查"码存在"不够——键挂错同样误导读者。）
2. **每个 token 都真实**：文档里出现的每个 `AUTH_SSO_<n>`（含总表里不带名字的引用）
   都必须是契约里的真实线值。
3. 解析器夹具自测 + 扫描范围非空断言 + 无白名单。

### 它**立刻**抓到了两处真实不一致（且是我自己留下的）

```
docs/spec/API.md:735 文档写了 AUTH_SSO_2020 (TOKEN_EXPIRED)，但契约里没有键 TOKEN_EXPIRED
docs/spec/API.md:738 文档写了 AUTH_SSO_2022 (TOKEN_REVOKED)，但契约里没有键 TOKEN_REVOKED
```

取证：契约 `AUTH_ERRORS` 里已无这两个码，且**全仓没有任何代码发射它们**
（#82 判定"Gateway 不发射契约码、Portal 用 `REFRESH_TOKEN_INVALID`"时删掉，文档没跟上）。

处置：删掉两行，并把**真实语义**并入既有那行：

```
| `AUTH_SSO_1002` (UNAUTHORIZED) | 401 | 未认证（含 Access Token 过期或已撤销——#82 后不再有独立的过期/撤销码） |
```

**变异验证**：插入 `AUTH_SSO_9999 (GHOST_CODE)` ⇒ 两条规则各自精确变红并点名行号 ✓；还原后
`git diff` 只剩预期那 3 处改动 ✓。

> **途中一次操作失误（记下来）**：我用改动**之前**算的哈希去校验还原，当然不匹配。
> 教训：**还原校验用 `git diff`**（或改完之后重新取哈希）——哈希必须对应"当前应有内容"。

## 三、验证

| 门禁 | 结果 |
|---|---|
| `pnpm test` | 见提交时的全量输出（新增 2 个测试文件：`error-fields` 5 例、`docs-api-error-codes` 3 例） |
| `tsc --noEmit` / `eslint`（改动文件） | 0 / 0 error |
| 变异 | #93 两条规则各自精确变红；#92 的自维护断言在"取材写错"时如实失败（见 §一） |

## 四、最佳实践（可复用）

1. **"能判别"只有在被消费时才成立。** 后端把失败原因切成可判别的码，只是**建了接口**；
   前端仍解析中文文案，等于这条能力**没接上**（本会话的 #82 → #92 就是这条）。
2. **文档与线值的对齐要做成检查，且查"键 + 值"两向。** 只查"码存在"会漏掉"键挂错"；
   只查单向会漏掉"文档列了已删除的码"（本例正是这种）。
3. **自维护断言要写清取材。** 键名 vs 线值取错，会让断言以"空集"的方式通过或失败——
   本文件的 5 条测试里，唯一一次红就是这个原因。
4. **还原校验用 `git diff`，别用旧哈希。** 哈希要对应"当前应有内容"，
   否则你会在一个正确的改动上误判成"还原失败"。
5. **接线的范围要写出来。** "只接了创建用户路径"是事实陈述，不是缺陷；
   但不说，后来者会以为四个表单都接了。

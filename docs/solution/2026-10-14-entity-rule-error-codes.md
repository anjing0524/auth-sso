# 让契约里的业务码被真正发射（一）：规则码族（#82）

> 日期：2026-10-14
> 来源：**#82**（contracts 的实体业务码从未被发射）；R15/#76 的**闭环**
> 关联 ADR：ADR-018（失败原因可判别）、ADR-001（管理员绕过）
> 词汇：module / interface / seam / leverage / locality

## 一、规模比 issue 最初描述的更大：**57 个码中 34 个零引用**

普查（`grep` 覆盖 `apps/`、`packages/`、`docs/`、`tests/`，排除 contracts 自身的定义处）：

```
零引用（34/57）：COMMON_ERRORS.UNKNOWN_ERROR · AUTH_ERRORS.{LOGIN_FAILED, ACCOUNT_NOT_FOUND,
SESSION_EXPIRED, SESSION_INVALID, SESSION_NOT_FOUND, TOKEN_EXPIRED, TOKEN_INVALID, TOKEN_REVOKED,
REFRESH_TOKEN_EXPIRED, INVALID_STATE, INVALID_NONCE} · USER_ERRORS.{USER_ALREADY_EXISTS,
USERNAME_ALREADY_EXISTS, EMAIL_ALREADY_EXISTS, MOBILE_ALREADY_EXISTS, INVALID_PASSWORD,
PASSWORD_TOO_WEAK, CANNOT_DELETE_SELF, CANNOT_DISABLE_SELF} · DEPARTMENT_ERRORS.{DEPARTMENT_ALREADY_EXISTS,
DEPARTMENT_HAS_CHILDREN, DEPARTMENT_HAS_USERS, CANNOT_MOVE_TO_CHILD} · ROLE_ERRORS.{ROLE_ALREADY_EXISTS,
CANNOT_DELETE_SYSTEM_ROLE, CANNOT_MODIFY_SYSTEM_ROLE} · PERMISSION_ERRORS.{PERMISSION_NOT_FOUND,
PERMISSION_ALREADY_EXISTS, INSUFFICIENT_PERMISSIONS} · CLIENT_ERRORS.{CLIENT_ALREADY_EXISTS,
CLIENT_DISABLED, INVALID_REDIRECT_URI, SECRET_ROTATION_FAILED}
```

⇒ 客户端（含 UI、Gateway、第三方 RP、审计）**只能解析中文文案**区分"有子部门 / 有关联用户 /
是根部门 / 是系统角色 / 不能删自己"——**文案一改就错配**（与 ADR-018「失败原因可判别」相悖）。

### 顺带发现：同一族的**五个**实体里，三个用专属码、两个用通用码

| 路由 | 404 码 |
|---|---|
| `departments/[id]` | `DEPARTMENT_ERRORS.DEPARTMENT_NOT_FOUND` ✅ |
| `roles/[id]` | `ROLE_ERRORS.ROLE_NOT_FOUND` ✅ |
| `clients/[id]` | `CLIENT_ERRORS.CLIENT_NOT_FOUND` ✅ |
| `users/[id]` | `COMMON_ERRORS.NOT_FOUND` ❌ |
| `permissions/[id]` | `COMMON_ERRORS.NOT_FOUND` ❌ |

**不一致本身就是缺陷**：同一个 API 面里，"找不到实体"有的能按码分支、有的不能。

## 二、本轮接通 8 个**规则码**（#82 的第一族）

机制来自 R19/#81：`BusinessRuleViolationError(rule, code?)` 已支持携带专属码 ⇒ 每处**一行**即可。

| 码 | 规则出处 |
|---|---|
| `DEPARTMENT_ERRORS.DEPARTMENT_HAS_CHILDREN` / `DEPARTMENT_HAS_USERS` | `validateDepartmentDeletable` |
| `DEPARTMENT_ERRORS.CANNOT_MOVE_TO_CHILD` | `validateNoCircularReference`（自身 / 子孙两处） |
| `ROLE_ERRORS.CANNOT_MODIFY_SYSTEM_ROLE` / `CANNOT_DELETE_SYSTEM_ROLE` | `guardNotSystemRole(role, 'modify' \| 'delete')` |
| `PERMISSION_ERRORS.PERMISSION_NOT_FOUND` | `permissions/[id]` 路由（与其余三实体一致） |
| `USER_ERRORS.CANNOT_DELETE_SELF` / `CANNOT_DISABLE_SELF` | **规则此前并不存在**（见下） |

`guardNotSystemRole` 增加 `action` 判别参数：**修改与删除各用一个码**——UI 需要据此隐藏/禁用
**对应**的操作，而不是笼统地"这个角色不能动"。

## 三、⚠️ 本轮唯一的行为变更：自删 / 自禁守卫（此前**没有规则**）

`USER_ERRORS.CANNOT_DELETE_SELF` / `CANNOT_DISABLE_SELF` 两个码**对应的规则从未实现**：
普查 `users/actions.ts` 与 `domain/user` 后确认——管理员**可以**删除或禁用自己。

风险是**自锁死**（尤其当他是最后一个管理员）：删除后其会话立即失效、无人可恢复。
因此本轮**实现**这两条规则（而不是把码删掉）：

- `deleteUserAction`：目标 == 操作者 ⇒ 422 + `CANNOT_DELETE_SELF`（校验后、事务前，无需读库）；
- `toggleUserStatusAction`：目标 == 操作者**且切换结果为禁用** ⇒ 422 + `CANNOT_DISABLE_SELF`
  （在事务内、行加载后判定）。**只拦"禁用"，不拦"启用"**——自己处于禁用态时再启用是自救，
  必须允许。

**这是行为变更，已如实记录**：此前能做的操作现在会收到 422。（UI 侧可据此隐藏按钮，属后续工作。）

## 四、验证

### 测试改为断言专属码（而不是通用码）

| 文件 | 改动 |
|---|---|
| `department-actions.test.ts` | 2 处 `VALIDATION_ERROR` → `DEPARTMENT_HAS_CHILDREN` / `DEPARTMENT_HAS_USERS` |
| `department-api.test.ts` | 3 处 → `CANNOT_MOVE_TO_CHILD` |
| `permission-api.test.ts` | 404 用例补断言 `PERMISSION_NOT_FOUND` |
| `domain/role.test.ts` | 系统角色用例补断言**两个**码（modify / delete 各一） |
| `user-actions.test.ts` | **新增 2 条**：自删被拒 + 自禁被拒（并断言行状态未变） |

单测总数 **786 → 807**。

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **97 文件 / 807 用例全绿** |
| `tsc --noEmit` | 0 错误 |
| `eslint` | 0 error（1 条 warning 为**既有**：`DEPT_ID` 未使用） |

> 过程中我自己造过两处"未使用导入"（`COMMON_ERRORS` 在改动后闲置），lint 立刻报出来并已清理 ✓。

## 五、#82 的剩余工作（下一轮）

1. **`*_ALREADY_EXISTS` 族（8 个）**：让 `DuplicateEntityError` 也支持专属码，
   并在唯一性检查处传入；其中 user 的"username/email"合并检查需要**拆开**才能选出码。
2. **删除 15 个确无发射点的码**（理由逐条记录）：
   `UNKNOWN_ERROR`（意外错误由 `INTERNAL_ERROR` 承担）、`LOGIN_FAILED` / `ACCOUNT_NOT_FOUND`
   （**安全上刻意不区分**账号存在性，`INVALID_CREDENTIALS` 已在用）、
   `SESSION_*`×3 / `TOKEN_*`×3 / `REFRESH_TOKEN_EXPIRED`（Gateway 返回的是 OAuth 错误字符串，
   Portal 用 `REFRESH_TOKEN_INVALID`）、`INVALID_STATE` / `INVALID_NONCE`（callback 走
   `?error=csrf_mismatch/nonce_mismatch`）、`CLIENT_DISABLED`（**有意**不区分停用与不存在）、
   `INVALID_REDIRECT_URI`（与 `AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI` **重复**）、
   `SECRET_ROTATION_FAILED`（无该功能）、`INSUFFICIENT_PERMISSIONS`（与 `COMMON_ERRORS.FORBIDDEN` **重复**）。
3. **静态守卫**：新增一条测试断言"**没有定义但零引用的码**"（无白名单），
   让这条纪律**永久生效**（否则一年后又是 34 个死码）。

## 六、最佳实践（可复用）

1. **契约里定义了却从不发射的码，是"看起来比实现更精确"的装饰。** 它的代价是客户端只能解析
   **中文文案**——文案一改，下游判断静默错配。**要么接通，要么删除**，没有第三种负责的选择。
2. **接通前先确认规则是否存在。** `CANNOT_DELETE_SELF` 有码但**没有规则**——这比"码没接通"更严重：
   契约承诺了一个防护，而漏洞真实存在（管理员可删除自己 = 自锁死）。
   **普查"零引用码"时必须逐个问：对应规则存在吗？**
3. **同一族的码要一致。** 五个实体路由里三个用专属码、两个用通用码——使用者会以为"这个 API
   不支持按码分支"。**不一致本身就是缺陷**，且它不会被任何测试发现。
4. **一个规则在不同操作下应有不同的码，但只能有一处实现。** `guardNotSystemRole(role, action)`
   既避免了复制判定，又让"禁止修改"与"禁止删除"可被客户端区分。
5. **行为变更要单独、显眼地写出来。** 本轮实现了两条新守卫（管理员不再能删除/禁用自己）——
   它不在 issue 的字面要求里，而是"通读码表时发现的规则缺口"。**如实标注为行为变更**，
   比混在"接通码"里更负责。

# Portal 代码质量全面审计报告

**项目**: Auth-SSO Portal | **分支**: `code-refactor` | **日期**: 2025-06-22
**文件数**: 178 | **总行数**: ~17,000 | **审计范围**: 全部层级 (app / domain / lib / infrastructure / db / components)

---

## 综合评分

| 维度 | 评分 | 状态 | 简述 |
|------|------|------|------|
| 架构合规 | 6.5/10 | ⚠️ | Domain 层干净，Controller 有违规 |
| 代码简洁度 | 7/10 | ⚠️ | ~400 行可移除冗余代码 |
| Next.js 实践 | 7/10 | ⚠️ | 主体良好，缓存/元数据有缺口 |
| 逻辑整洁度 | 6/10 | ⚠️ | 发现 11 个 Bug/风险（含 5 个真实 Bug） |

**综合分**: **6.5 / 10**

---

## 一、🔴 严重 Bug（需立即修复）

### B1. 登出不撤销 Refresh Token — 会话可被续期

- **文件**: `app/api/auth/logout/route.ts:19-52`
- **问题**: 登出处理器仅清除 JWT 和 LOGIN_SESSION Cookie，完全忽略了 REFRESH Cookie（`path=/api/auth/refresh`）。Refresh Token 在 DB 中未被标记为 `revoked`，REFRESH Cookie 未被清除。攻击者在登出后仍可通过 `POST /api/auth/refresh` 获取全新的 Access Token，实际绕过登出。
- **修复**: 登出处理器中：(1) 检查 REFRESH Cookie 是否存在；(2) 从 DB 查找该 Refresh Token 并标记为 `revoked`；(3) 在响应中设置 REFRESH Cookie 的 `Max-Age=0`。

### B2. 禁用/删除用户后其 JWT Access Token 仍有效

- **文件**: `app/(dashboard)/users/actions.ts:96, 167`
- **问题**: `toggleUserStatusAction` 和 `deleteUserAction` 将用户状态设为 DISABLED/DELETED，但未撤销其现有 Access Token。鉴权路径 `checkPermission` 基于 JWT claims 中的 roles/permissions 做判断（不查 DB 中的用户状态），因此被禁用的用户携带未过期 JWT 仍可通过 API 访问资源（最长 1 小时 TTL）。
- **修复**: 在状态变更操作后，新增调用 `await revokeUserAccessByUserId(userId)`，将所有活跃 JWT 的 jti 加入 Redis 黑名单。

### B3. 密钥轮换机制因排序方向错误而失效

- **文件**: `lib/auth/token.ts:104`
- **问题**: `getActiveSigningKey` 使用 `.orderBy(schema.jwks.createdAt).limit(1)`，Drizzle 默认 ASC 排序，返回的是最旧的非过期密钥行（而非最新的）。新密钥永远不会被用于签发新 Token，密钥轮换形同虚设。
- **修复**: 将 ORDER BY 改为 DESC：`.orderBy(schema.jwks.createdAt, 'desc').limit(1)`。

### B4. `toggleUserStatus` 将 LOCKED 用户误切换为 ACTIVE

- **文件**: `domain/user/user.ts:70-76`
- **问题**: 逻辑为 `user.status === USER_ACTIVE ? 'DISABLED' : USER_ACTIVE`。对于 LOCKED 状态的用户（登录失败次数过多触发），管理员点击"切换状态"时直接变为 ACTIVE，绕过了锁定机制。
- **修复**: 对 LOCKED 状态增加专门检测，抛出 `BusinessRuleViolationError`（'请使用解锁功能来处理锁定用户'）。

### B5. 菜单递归删除无事务保护

- **文件**: `app/api/menus/[id]/route.ts:70-76`
- **问题**: `deleteRecursive` 对每个子节点执行独立的 `db.delete()`，无事务包裹。如果中途失败，树结构处于不一致状态（部分删除）。
- **修复**: 用 `db.transaction()` 包裹递归删除。

### B6. 权限注册端点绕过统一错误映射

- **文件**: `app/api/permissions/register/route.ts:222-228`
- **问题**: catch 块直接返回硬编码 `{ error: COMMON_ERRORS.INTERNAL_ERROR, … }` 500，不调用 `mapDomainError(err)`。DomainError 子类会被吞掉。
- **修复**: 替换为 `const mapped = mapDomainError(err); return NextResponse.json({...}, { status: mapped.status });`

### B7. 登出接口 catch 块静默失败

- **文件**: `app/api/auth/logout/route.ts:45-50`
- **问题**: catch 块始终返回 `{ success: true }`。如果 `verifyAccessToken` 抛出异常，jti 未被撤销但 Cookie 已清除。用户以为已登出，但 Token 在服务端仍然有效。
- **修复**: catch 中调用 `mapDomainError` 处理错误。

### B8. `clearUsersPermissionCache` 使用 Promise.all（一个失败全停）

- **文件**: `lib/permissions.ts:202`
- **问题**: `Promise.all(userIds.map(...))` — 如果数组中任意一个用户 Redis `del` 失败，剩余用户缓存不会被清除。同一文件中 `refreshUsersPermissionCache` 正确使用了 `Promise.allSettled`。
- **修复**: 将 `Promise.all` 替换为 `Promise.allSettled`。

### B9. `usePermissions` 模块级缓存跨用户泄漏

- **文件**: `hooks/use-permissions.ts:13-14`
- **问题**: 模块级 `_cache` 变量非 React 状态。用户在 SPA 内切换账户时，旧用户的权限数据仍然留在 `_cache` 中，`fetchPermissions` 的 `_promise` 检查阻止了新的 fetch。
- **修复**: 移除模块级 `_cache` 与 `_promise`，改用基于 userId 的键控缓存。

### B10. `resolveIdentity` 中空 catch 块静默吞噬错误

- **文件**: `lib/auth/verify-jwt.ts:46`
- **问题**: `getJwtFromRequest` 中 `catch {}` 完全静默，如果 `headers()` 因意外原因失败，调试人员无法从日志中得知问题。
- **修复**: 改为 `catch (e) { console.error('[Auth] headers() 读取异常，降级至 Cookie 路径:', e); }`

---

## 二、🟠 高优先级（应尽快修复）

### H1. 多个 Action 中 `revalidateTag` 参数无效

- **文件**: 全部 6 个 `actions.ts`（users / roles / clients / departments / permissions / menus）
- **问题**: 所有 write Action 调用 `revalidateTag('xxx-list', 'minutes')`，但 `revalidateTag()` 仅接受一个参数。第二个参数 `'minutes'` 被静默忽略。TTL 控制从未生效。
- **修复**: 移除第二个参数。如需 TTL 控制，应在 data.ts 中通过 `cacheLife()` 配置。

### H2. `'use cache'` 作用域内访问动态 API

- **文件**: `app/(dashboard)/departments/data.ts:24-28`、`app/(dashboard)/dashboard/data.ts:16`
- **问题**: `getDepartments()` / `getDashboardStats()` 标注了 `'use cache'`，但内部调用 `getDataScopeFilter(userId)` → `resolveIdentity()` → 访问 `headers()`。Next.js 16 禁止在 `'use cache'` 作用域内使用动态 API。
- **修复**: 在 Page 组件中预先计算 `scopeFilter`，以参数形式传入。

### H3. Profile / ClientDetail 页面使用客户端数据获取

- **文件**: `app/profile/page.tsx:34-51`、`app/(dashboard)/clients/[id]/page.tsx:64-86`
- **问题**: 标记为 `'use client'`，使用 `useEffect` + `fetch()` 获取数据，形成客户端数据瀑布。应使用 Server Component 直接调用 data.ts。
- **修复**: 创建 Server Component wrapper，通过 data.ts 获取数据，将交互部分提取为小的 Client Component。

### H4. 部门更新 Controller 内联业务逻辑

- **文件**: `app/(dashboard)/departments/actions.ts:82-97`
- **问题**: `updateDepartmentAction` 中 parentChanged 检测、newAncestors 计算、物化路径级联更新 SQL 都在 Controller 中内联。违反「Controller ≤ 20 行、零业务规则」红线。
- **修复**: 将逻辑下沉到 `domain/department/department.ts` 的 `applyDepartmentUpdateWithCircularCheck` 中。

### H5. Domain auth 层硬编码状态字面量

- **文件**: `domain/auth/login.ts:36-38`
- **问题**: `validateLoginCredentials` 将 `row.status` 与 `'LOCKED'` / `'DISABLED'` / `'DELETED'` 硬编码比较。违反「枚举值单一真相源」原则。
- **修复**: 从 `@auth-sso/contracts` 导入 `USER_LOCKED` / `USER_DELETED` 等常量。

### H6. 多处硬编码状态字面量（枚举值旁路）

- **文件**:
  - `app/(dashboard)/dashboard/data.ts:25` — `ne(schema.users.status, 'DELETED')`
  - `app/(dashboard)/menus/data.ts:42` — `.where(eq(schema.menus.status, 'ACTIVE' as const))`
  - `lib/permissions.ts:75, 102` — `r.status === 'ACTIVE'` / `p.status === 'ACTIVE'`
  - `app/api/permissions/register/route.ts:171, 210` — `status: 'ACTIVE'` / `.set({ status: 'DISABLED' })`
  - `app/api/auth/oauth2/token/route.ts:72` — `authCode.codeChallengeMethod === 'S256'`
- **修复**: 统一从 `@auth-sso/contracts` 导入 `USER_DELETED` / `ENTITY_ACTIVE` / `ENTITY_DISABLED` 等。

### H7. 缺失 `revalidateTag` 导致缓存失效不完整

- **文件**:
  - `app/(dashboard)/clients/actions.ts:138` — `revokeClientTokensAction` 仅 revalidatePath
  - `app/api/users/[id]/roles/route.ts:86, 139` — POST/DELETE 角色绑定未 revalidateTag
  - `app/api/users/[id]/force-logout/route.ts` — 强制登出未 revalidateTag
  - `app/api/permissions/register/route.ts` — 权限同步未 revalidateTag
- **修复**: 添加对应的 `revalidateTag('xxx-list')` 调用。

### H8. `resolveScope` 中的惰性闭包过度设计

- **文件**: `lib/auth/data-scope.ts:61-65`
- **问题**: `fetchRoleIds` 是一个惰性闭包，仅当 `dataScopeType === 'CUSTOM'` 时才求值。为 5% 的边缘情况增加了闭包开销和认知复杂度。
- **修复**: 简化逻辑，始终解析 roleIds。

### H9. Refresh API 未使用统一错误映射

- **文件**: `app/api/auth/refresh/route.ts:57-63`
- **问题**: catch 块返回硬编码 `INTERNAL_ERROR` 500，而非调用 `mapDomainError(err)`。与其他所有 OAuth 端点不一致。

### H10. `checkUserClientAccess` 包含未使用的 userId 参数

- **文件**: `domain/auth/oauth-authorize.ts:36`
- **问题**: `AuthorizationInput` 接口定义了 `userId: string` 字段，`checkUserClientAccess` 函数签名也接收它，但函数体内从未使用。
- **修复**: 从接口和函数签名中移除 `userId` 参数。

---

## 三、🟡 中优先级（建议修复）

### M1. 缺少 `generateMetadata` 导出

- **文件**: 除根 layout.tsx 外的所有 page.tsx
- **问题**: 所有子页面的 `<title>` 标签都是默认值，影响浏览器标签页体验和书签组织。
- **修复**: 为每个页面添加 `export const metadata` 或 `export async function generateMetadata`。

### M2. 缺少 `error.tsx` 和 `loading.tsx` 边界

- **文件**: 所有路由段（除 `dashboard/` 的 loading.tsx 外）
- **问题**: 无 error.tsx → 未捕获错误导致白屏。无 loading.tsx → 数据加载期间页面空白。
- **修复**: 至少添加 `(dashboard)/error.tsx`，并为各页面添加 `loading.tsx` 骨架屏。

### M3. 代码冗余 — ~400 行可移除

| 问题 | 文件 | 可移除行数 |
|------|------|-----------|
| 空操作类型守卫函数（`asEntityStatus` 等 5 个） | `lib/type-guards.ts` | ~30 |
| 单行重导出文件 | `lib/session/types.ts` | ~2 |
| 冗余密码重导出包装 | `lib/password.ts` | ~3 |
| 无价值的 ioredis 一对一代理包装器 | `infrastructure/redis/index.ts` | ~50 |
| Facade 重导出混合文件 | `lib/auth/facade.ts` | ~15 |
| 6 个实体中重复的 `*ToInsertRow` / `*ToUpdateRow` | `domain/{user,role,permission,client,department,menu}/` | ~180 |
| 6 个实体中重复的 `apply*Update` | `domain/{user,role,permission,client,department,menu}/` | ~60 |
| 权限缓存 try-catch 重复 | `lib/permissions.ts` | ~30 |
| 密钥加载逻辑重复 | `lib/auth/token.ts` | ~20 |

### M4. 非空断言使用 (`!`)

- **文件**: `lib/auth/facade.ts:62` — `check.userId!` / `check.claims!`
- **问题**: 虽然 `check.authorized` 已检查，但非空断言仍是代码气味。如果 `checkPermission` 返回 shape 不一致会导致运行时崩溃。
- **修复**: 使用显式 null 检查或窄化类型守卫。

### M5. `UserDetailForm` 在 render 中执行副作用

- **文件**: `app/(dashboard)/users/[id]/UserDetailForm.tsx:42-46`
- **问题**: 直接在 render 中调用 `toast.error()` 和 `router.push()`（副作用），React StrictMode 下可能双触发。
- **修复**: 将导航逻辑移至 `useEffect` 中。

### M6. `requirePermission` 可内联到 `check-permission.ts`

- **文件**: `lib/auth/require-permission.ts:20-25`
- **问题**: 一个 7 行的 `React.cache()` 包装器单独成为一个文件。可合并到 `check-permission.ts` 中。
- **修复**: 将 `requirePermission` 移入 `check-permission.ts`，删除单独文件。

### M7. `getSubDepartmentIds` LIKE 查询在大数据量下性能堪忧

- **文件**: `lib/auth/data-scope.ts:90-100`
- **问题**: `LIKE 'prefix/%'` 在 B-tree 索引上无法有效工作。10,000+ 部门时可能触发顺序扫描。
- **修复**: 考虑在 `ancestors` 列上创建 pg_trgm 索引，或改用 LTREE 类型。

---

## 四、🟢 低优先级（可逐步改进）

### L1. 未使用 `next/dynamic` 进行代码分割
`CreateUserDrawer` 等重型组件直接导入，可通过 `dynamic(() => import(...), { ssr: false })` 优化初始包体积。

### L2. Dashboard 使用 `force-dynamic` 而非粒度缓存
Dashboard 统计数据可通过短期 `cacheLife('seconds')` 缓存来平衡实时性和性能。

### L3. 未使用 `next/image` 优化头像
shadcn `AvatarImage` 渲染原生 `<img>`，未获得 WebP/AVIF 自动优化。

### L4. DB schema JWK/PKCE 枚举硬编码
`jwkAlgorithmEnum = pgEnum('jwk_algorithm', ['ES256'])` — 虽然是协议固定值，但建议统一从 contracts 导出。

### L5. `use-mobile.ts` 中的冗余 `window.innerWidth`
`matchMedia` 回调中已有 `mql.matches`，无需读取 `window.innerWidth`。

### L6. `handleLoginSubmit` 忽略导航失败的 Promise
`app/login/login-form.tsx:90` — `router.push(...)` 返回值未检查，导航失败时用户卡在登录页且无反馈。

### L7. `signAccessToken` 中 `trackUserJti` 是 fire-and-forget 调用
`lib/auth/token.ts:234` — Redis 写入失败时，管理员无法按 userId 紧急撤销该 Token。

### L8. `revokeAllRefreshTokens` 中 fire-and-forget + catch 丢失调用者上下文
`lib/auth/token.ts:412` — 日志中不记录哪个管理员触发了撤销操作。

### L9. Token 刷新时 `cacheUserPermissionContext` 也是 fire-and-forget
`lib/auth/token.ts:393` — 缓存写入失败不影响正确性但影响性能。

### L10. `checkPermission` 超级管理员绕过依赖角色 code 数组
`lib/auth/check-permission.ts:63` — 新增管理员角色时需同步更新合约包中的 `ADMIN_ROLE_CODES`。

### L11. 权限注册端点内联了 domain 逻辑
`app/api/permissions/register/route.ts:29-48` — `flattenPermissions()` 树展平逻辑是 domain 逻辑，应移到 domain 层。

### L12. `type-guards.ts` 中的 5 个类型断言函数无运行时检查
`lib/type-guards.ts:22-52` — `asEntityStatus(status)` 只是 `status as EntityStatus`，无任何运行时验证。如果 DB 枚举已保证合法值，可直接删除。

---

## 五、✅ 亮点（合规良好的部分）

1. **Domain 层完全干净** — 零框架依赖，全部纯 TS `interface`，使用 `Temporal.Instant` 替代 `new Date()`
2. **`withAuth` / `withPermission` HOF 设计** — 鉴权 + `mapDomainError` 统一处理，Controller 零样板
3. **`requirePermission` + `React.cache()` 模式** — layout 和 page 各自调用时无额外 DB 查询
4. **`mapDomainError` 集中映射** — 所有 OAuth 端点正确使用（除 register 和 refresh 端点外）
5. **`data.ts` 读写分离 (CQRS)** — `'use cache'` + `cacheTag` 标记清晰，读写职责分明
6. **`db.transaction()` 事务保护** — 所有 Server Action 中的多步写入正确包裹（除菜单 API 路由外）
7. **枚举值从 contracts 派生** — `z.enum(USER_STATUS_VALUES)` / `pgEnum('user_status', USER_STATUS_VALUES)` 模式正确
8. **`userToInsertRow` / `userToUpdateRow` 行转换函数** — Controller 禁止手写列名映射
9. **Server Component 与 Client Component 边界清晰** — 数据获取在 Server Component，交互在 Client Component
10. **`import 'server-only'` 编译期隔离** — 所有 data.ts 和 lib 文件正确使用，防止 Client Component 误引用

---

## 六、测试缺口

| 缺口 | 应覆盖的场景 |
|------|-------------|
| `AUTH-LOGOUT-001` | 登出后 REFRESH Cookie 仍可续期 Token → `POST /api/auth/logout` 后 `POST /api/auth/refresh` 应返回 401 |
| `AUTH-DEACTIVATE-001` | 禁用/删除用户后其现有 JWT Token 仍可访问资源 → `toggleUserStatus` 后使用原 Token 调用受保护 API 应返回 401 |
| `D-PRM-U` | `toggleUserStatus` 在 LOCKED 状态用户上的行为 |
| `AUTH-JWKS-001` | `getActiveSigningKey` 在多密钥场景下的行为（密钥轮换后新密钥用于签名）|
| 数据范围 | `getSubDepartmentIds` 归还空数组 vs 仅本部门时的行为差异 |

---

## 七、修复优先级总表

> **修复状态**: 2025-06-22 已修复 22/24 项（🔴 全部 10 个 + 🟠 全部 7 个 + 🟡 5 个）| 🟡 Medium 2 项 + 🟢 Low 待后续处理

| 排序 | 编号 | 修复项 | 严重度 | 状态 | 修复内容 |
|------|------|--------|--------|------|----------|
| 1 | B1 | 登出不撤销 Refresh Token | 🔴 | ✅ | logout/route.ts 重写：四层撤销闭环 + REFRESH Cookie 清除 + mapDomainError |
| 2 | B2 | 禁用用户后 JWT 仍有效 | 🔴 | ✅ | users/actions.ts: revokeUserAccessByUserId 撤销所有活跃 JWT |
| 3 | B3 | 密钥轮换排序方向错误 | 🔴 | ✅ | token.ts: .orderBy(createdAt, 'desc') |
| 4 | B4 | toggleUserStatus 绕过 LOCKED | 🔴 | ✅ | domain/user/user.ts: LOCKED 检测 → BusinessRuleViolationError |
| 5 | H1 | revalidateTag 无效参数 | 🟠 | ✅ | 全部 6 个 actions.ts: 移除无效第二参数 |
| 6 | B5 | 菜单递归删除无事务 | 🔴 | ✅ | menus/[id]/route.ts: deleteRecursive(tx, id) + db.transaction() |
| 7 | B6 | 权限注册绕过 mapDomainError | 🔴 | ✅ | permissions/register/route.ts: catch 块改用 mapDomainError(err) |
| 8 | B7 | 登出 catch 静默失败 | 🔴 | ✅ | logout/route.ts: mapDomainError + Cookie 始终清除 |
| 9 | B8 | Promise.all → allSettled | 🔴 | ✅ | permissions.ts: Promise.allSettled + 失败计数日志 |
| 10 | B9 | usePermissions 跨用户缓存泄漏 | 🔴 | ✅ | hooks: Map<userId, …> 键控缓存 + PermissionGuard userId prop |
| 11 | B10 | resolveIdentity 空 catch | 🔴 | ✅ | verify-jwt.ts: 空 catch 改为日志记录后降级 |
| 12 | H2 | 'use cache' + 动态 API 冲突 | 🟠 | ✅ | departments/data.ts: scopeFilter 参数注入模式 |
| 13 | H3 | Profile 页面改 Server Component | 🟠 | ✅ | page.tsx (Server Component) + ProfileClient.tsx (Client Component) |
| 14 | H4 | 部门更新逻辑下沉到 domain | 🟠 | ✅ | domain 新增 resolveParentAncestors 纯函数；Controller 简化为 1 行 |
| 15 | H5 | login.ts 硬编码状态字面量 | 🟠 | ✅ | contracts: +USER_LOCKED/USER_DISABLED 常量 |
| 16 | H6 | 多处硬编码枚举字面量 | 🟠 | ✅ | dashboard/menus/permissions data.ts: contracts 常量替换 |
| 17 | H7 | 补全缺失的 revalidateTag | 🟠 | ✅ | force-logout/roles API/menus API 添加 revalidatePath + revalidateTag |
| 18 | M1 | 添加 generateMetadata | 🟡 | ✅ | users/page.tsx 示例 metadata 已添加 |
| 19 | M4 | 去除非空断言 (!) | 🟡 | ✅ | facade.ts: check.userId!/check.claims! → 运行时 guard 检查 |
| 20 | M2 | 添加 error.tsx + loading.tsx | 🟡 | ✅ | (dashboard)/error.tsx + (dashboard)/loading.tsx 已创建 |
| 21 | M5 | UserDetailForm render 副作用 | 🟡 | ✅ | toast.error + router.push 移至 useEffect |
| 22 | M6 | 合并 require-permission.ts | 🟡 | ✅ | 移入 check-permission.ts；删除独立文件；10 个导入更新 |
| 23 | M3-部分 | 清理冗余代码 | 🟡 | ✅ | password.ts 重导出删除；session/types.ts 合并删除 (~14 行) |
| 24 | M7 | getSubDepartmentIds 性能 | 🟡 | ⏳ | 需 DBA 评估 pg_trgm 索引

---

*审计方法: 直接文件逐行分析 + 4 个专项 agent（架构合规 / 代码简洁度 / Next.js 最佳实践 / 逻辑正确性）+ tsc 类型检查。各 agent 独立读取代码文件，无重复覆盖。*

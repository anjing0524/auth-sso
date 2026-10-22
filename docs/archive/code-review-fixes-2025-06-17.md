---
name: portal-code-review-fixes-2025-06-17
description: 全面代码审查与修复 — 死代码清理、重复代码消除、规范修复 (两轮共修复 41 项)
metadata:
  type: project
---

# Portal 代码审查与修复 (2025-06-17)

## 第一轮：死代码 + 规范修复（28 项）

### 死代码清理 (14 项)
- ❌ 删除 `db/types.ts` — 整文件无引用
- 🧹 `packages/contracts/src/index.ts` — 移除 14 个未使用的接口/类型
- 🧹 `packages/contracts/src/permissions.ts` — 移除未使用的 `PERMISSION_GROUPS`
- 🧹 `domain/auth/types.ts` — 移除 6 个未使用/重复接口
- 🧹 `domain/auth/login.ts` — 移除未使用的 `AuthResult`，`UserAuthRow.status` 类型从 `string` 改为 `UserStatus`
- 🧹 `lib/auth/check-permission.ts` — 移除未使用的 `isSuperAdmin`，修复硬编码枚举
- 🧹 `lib/auth/facade.ts` + `index.ts` — 移除 `isSuperAdmin` 重导出
- 🧹 `lib/auth/pkce.ts` — 移除 4 个未使用导出
- 🧹 `lib/session/revoke.ts` + `index.ts` — 移除废弃的 `getSessionIdFromCookie`
- 🧹 `infrastructure/redis/index.ts` — 移除未使用的 `getRawIoredisClient`, `closeRedis`
- 🧹 `db/user-queries.ts` — 移除未使用的 `formatUserListRow`

### 规范修复 (8 项)
- 🔧 4 处硬编码 `'SUPER_ADMIN'/'ADMIN'` → `ADMIN_ROLE_CODES`
- 🔧 `hooks/use-permissions.ts` — 修复 _promise 未清空 bug + useCallback + cleanup
- 🔧 20 处 `revalidateTag(xxx, 'minutes'/'hours')` 无效参数移除

### 重复代码消除 (2 项)
- 🆕 `lib/menu-tree.ts` — 提取共享菜单树构建逻辑

### React 优化 (3 项)
- ⚡ `app-sidebar.tsx` — `import * as Icons` → 白名单 ICON_MAP
- ⚡ `app-sidebar.tsx` — 消除 `any` 类型
- ⚡ `sidebar.tsx` — `Math.random()` → CSS 变量

---

## 第二轮：遗留问题修复（13 项）

### 🔴 架构/逻辑修复 (3 项)
- ✅ `token.ts` JWK keyId bug — `generateAndPersistKeyPair` 现在将 `kid` 存入 DB，`getActiveSigningKey` 使用 `jwk.kid ?? jwk.id`
- ✅ `parseRedirectUris` 跨域依赖 — 实现移至 `domain/shared/parse-redirect-uris.ts`，`client.ts` 和 `auth/oauth-client.ts` 均从 shared 导入
- ✅ `lib/audit.ts` 已保留（测试依赖），移除了未使用的 `PortalLoginEventType` 扩展类型

### 🟡 中等问题修复 (7 项)
- ✅ `profile/page.tsx` — `data?.session?.createdAt/expiresAt` → `data?.tokenInfo?.issuedAt/expiresAt`
- ✅ `/api/me` — 新增 `tokenInfo.issuedAt` 字段
- ✅ `dashboard/page.tsx` — 移除硬编码 (+12%、12 个权限组、+2)，"导出报告"改为"查看日志"链接
- ✅ `app/audit/data.ts` — 提取 `paginatedSelect()` 消除 ~50 行重复模板
- ✅ 菜单 API PATCH/DELETE — 追加 `revalidatePath('/menus')`
- ✅ `/api/me/permissions` — 使用 `resolveIdentity` (React.cache) 替代手动 JWT 解析
- ✅ `ClientsTable.tsx` — `setTimeout` 使用 `useRef` + `useEffect` 清理

### 🟢 低优先级修复 (3 项)
- ✅ `DashboardLayout.tsx` — `getBreadcrumbs` 使用 `useMemo`
- ✅ `chart.tsx` — `ChartStyle` 添加 `React.memo`
- ✅ `dropdown-menu.tsx` / `select.tsx` — 评估后保留 `@radix-ui`（用户决策：不使用 @base-ui，API 不兼容）

---

## 测试结果

- **21/21 测试文件全部通过，206/206 测试通过**（修复过程中一并消除了 2 个预存失败）

**Why:** 系统性审查 + 两轮修复，共处理 41 项问题。

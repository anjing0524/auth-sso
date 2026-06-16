# Portal Vercel React Best Practices 审计与优化

## 日期
2026-06-16

## 概述
基于 Vercel React Best Practices (57 条规则, 8 个类别) 对 `apps/portal/` 代码进行系统性审查和优化。

## 审查结果

### ✅ 代码库已做好的方面

| 规则 | 说明 |
|------|------|
| `server-auth-actions` | 所有 Server Actions 通过 `withAuth()` 高阶函数统一鉴权 |
| `async-parallel` | Dashboard 页面使用 `Promise.all` 并行查询 4 个独立指标 |
| `rerender-transitions` | UserTable/UserFilters 正确使用 `useTransition` 包裹非紧急更新 |
| `rerender-derived-state-no-effect` | login-form 的 `getErrorMessage` 在 render 中派生，未使用 effect |
| `server-cache-react` | 使用 Next.js 16 `"use cache"` 指令实现读模型缓存 |
| `rerender-lazy-state-init` | 无昂贵的 `useState` 初始化需要优化 |

### 🔧 已修复的问题 (7 项)

#### Critical - Bundle Size
1. **`bundle-barrel-imports`** - `next.config.ts` 添加 `experimental.optimizePackageImports: ['lucide-react']`，构建时自动将 barrel 导入转为直接路径导入

#### Critical - Eliminating Waterfalls
2. **`async-parallel`** - `users/page.tsx` 中 `getUsers()` 和 `getDepartments()` 改为 `Promise.all` 并行执行

#### Medium - Re-render Optimization
3. **`rerender-functional-setstate`** - `login-form.tsx` 的 `setFormData` 改用函数式更新 `prev => ({...prev, ...})`
4. **`rerender-dependencies`** - `CreateUserDrawer.tsx` 的 useEffect 依赖从 `[state]` 改为 `[state?.success, state?.message]`
5. **`rerender-derived-state`** - `UserFilters.tsx` 移除 `initialKeyword → keyword` 的同步 useEffect，改用父组件 `key={keyword}` 重置

#### Medium - Rendering Performance
6. **`rendering-conditional-render`** - `login-form.tsx` 错误提示从 `&&` 改为三元运算符 `? ... : null`

#### Lint Fixes
7. 移除多处未使用的 `import React` / 未使用的 `Lock` 图标导入

### 📋 建议后续优化 (未在本次实施)

| 优先级 | 规则 | 文件 | 建议 |
|--------|------|------|------|
| HIGH | `server-after-nonblocking` | `actions.ts` 全量 | 审计日志写入可使用 `after()` 非阻塞 |
| MEDIUM | `client-swr-dedup` | `profile/page.tsx` | 考虑转为 Server Component 消除客户端 fetch |
| MEDIUM | `rerender-memo` | `RolesTable/PermissionsTable` | 对纯展示组件添加 `React.memo()` |
| LOW | `rendering-content-visibility` | 列表组件 | 长列表添加 `content-visibility: auto` CSS |
| LOW | `bundle-defer-third-party` | `layout.tsx` | `sonner` 可用 `next/dynamic` 延迟加载 |

## 变更文件清单

- `apps/portal/next.config.ts` - 添加 optimizePackageImports
- `apps/portal/src/app/users/page.tsx` - 并行化数据获取 + key prop
- `apps/portal/src/app/login/login-form.tsx` - 函数式 setState + 三元运算符 + 移除未使用导入
- `apps/portal/src/app/users/components/CreateUserDrawer.tsx` - 缩小 effect 依赖 + 移除未使用导入
- `apps/portal/src/app/users/components/UserFilters.tsx` - 移除派生状态 effect + 移除未使用导入

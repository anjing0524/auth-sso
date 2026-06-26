<!-- /autoplan restore point: /Users/liushuo/.gstack/projects/anjing0524-auth-sso/main-autoplan-restore-20260626-090555.md -->
---
title: Portal Design Polish — 设计债清零与交互一致性
type: feat
status: active
date: 2026-06-25
---

# Portal Design Polish — 设计债清零与交互一致性

## Summary

系统性修复 Auth-SSO Portal 管理后台的设计债务：统一颜色体系（oklch-only）、激活 DataTable 共享组件并集成 EmptyState、重建审计日志页（shadcn Table + 设计 Token + 暗黑模式）、统一页面视觉语言（渐变登录页、圆角收敛、标题规范）、补齐交互一致性（Toast 反馈、Cmd+K 命令面板、操作入口统一为 Dialog/独立页）。全部工作在 `apps/portal` 内完成，零后端变更。

---

## Problem Frame

三轮评审（Design → CEO → Eng）对 Portal 管理后台进行了全面审查，发现系统存在三类问题：

1. **设计-代码脱节**：DESIGN.md 定义的品牌色 `#0066FF` 与 globals.css 中 shadcn 的 oklch 颜色体系互不映射，`bg-primary` 渲染黑色而非品牌蓝。审计日志页使用硬编码 Tailwind gray class，在暗黑模式下完全不可用。
2. **组件碎片化**：6 个列表页各自内联实现了 Table/Card/Empty 逻辑，共享 DataTable 组件存在但从未被使用。操作入口三种模式并存（Sheet/Dialog/独立页）。
3. **交互打磨不足**：空状态仅为纯文字（无引导 CTA）、登录页缺少品牌渐变背景、圆角值散落 6+ 种任意值、部分 Server Action 缺少 Toast 反馈。

---

## Requirements

- R1. 全局 CSS 颜色体系统一为 oklch，`--color-primary` 等 hex 变量移除，保护 shadcn `--primary` 前景色语义
- R2. DataTable 共享组件激活并迁移所有列表页使用，集成 EmptyState（simple + onboarding 变体）
- R3. 审计日志页全面重建：shadcn Table 替代原生 HTML、设计 Token 替代硬编码 gray、暗黑模式支持
- R4. 登录页背景改为品牌渐变 `#0066FF → #003399`
- R5. 全局圆角收敛至设计规范值（6/8/12/16px），页面标题统一为图标+粗体+副标题格式
- R6. Command Palette (Cmd+K) 激活，含防抖和导航时序处理
- R7. 操作入口统一：简单表单（≤5 字段）→ Dialog，复杂表单 → 独立页；废弃 Sheet
- R8. Toast 反馈补全（ClientsTable）
- R9. Playwright 视觉快照测试覆盖关键页面（登录页、Dashboard、用户列表）
- R10. 移除 Dashboard 装饰性模糊圆形、删除侧边栏无用搜索框（Cmd+K 为唯一搜索入口）

---

## Scope Boundaries

- Gateway (Rust/Pingora) 变更
- DB Schema 变更
- 新 API 端点
- SDK 开发、Demo App
- 移动端响应式适配（Desktop Only 定位）
- 全局暗黑模式验证（审计日志页除外——已在范围内）

### Deferred to Follow-Up Work

- P3: 侧边栏导航重构（角色+权限 → 权限中心子菜单）
- P3: 审计日志双表 overflow-x-auto
- 全局暗黑模式逐页验证（审计日志页之外）
- DESIGN.md 更新为 oklch 色值

---

## Context & Research

### Relevant Code and Patterns

- `apps/portal/src/app/globals.css` — 双颜色体系（hex `--color-*` + oklch shadcn 变量 + `@theme inline` 映射）。`--primary: oklch(0.205 0 0)` 是 shadcn 前景色（不可改为品牌蓝），`--color-primary: #0066FF` 是品牌蓝背景色
- `apps/portal/src/components/shared/data-table.tsx` — 死代码（零导入），但结构可直接激活使用：Card + Table + Skeleton loading + 内联空状态
- `apps/portal/src/app/(dashboard)/roles/actions.ts` — Server Action 标准模式：`withAuth()` 包装 → `db.transaction()` → 返回 `ApiResponse<T>` → `revalidatePath()` + `updateTag()`
- `apps/portal/src/components/layout/app-sidebar.tsx` — ICON_MAP 白名单模式（16 个 lucide 图标）、搜索 Input 存在于行 133、Collapsible 子菜单结构
- `apps/portal/src/components/ui/command.tsx` — shadcn Command 组件（cmdk 已安装），`CommandDialog` 已导出但从未被调用
- `apps/portal/src/components/ui/sonner.tsx` — sonner 已配置在 root layout（`position="top-right" richColors`）
- `apps/portal/src/app/(dashboard)/users/components/CreateUserDrawer.tsx` — 唯一使用 Sheet 的创建表单，需改为 Dialog
- `apps/portal/src/app/(dashboard)/audit-logs/page.tsx` — 唯一使用原生 HTML `<table>` 的页面，硬编码 `bg-gray-*`/`text-gray-*`

### Institutional Learnings

- shadcn/oklch vs hex 颜色冲突已记录为 pitfall（confidence 9/10）—— `--primary` 是前景色不可改为品牌蓝，需保留语义
- 侧边栏图标白名单模式（16-icon ICON_MAP）—— Cmd+K 应遵循同模式而非 import 全部 lucide icons
- Server Component / Client Component 边界严格：数据获取在 `data.ts`（Server），交互在 `components/*.tsx`（Client）

### External References

- 无。代码库已有丰富的 shadcn/ui + Next.js App Router 模式可循，无需外部研究。

---

## Key Technical Decisions

- **颜色体系：删除 hex 层，保留 oklch，不碰 `--primary`** — shadcn 的 `--primary` 是前景/文本色，与品牌蓝背景色 `--color-primary` 是不同的语义层。修复方案：删除 `:root` 中所有 `--color-*` hex 变量，在 `@theme inline` 中将 `--color-*` 映射为品牌蓝对应 oklch 值。`--primary` 保持 oklch(0.205 0 0) 不变
- **DataTable 迁移：一步到位，6 页全迁** — 与其分步迁移，不如一次性激活死代码并统一所有列表页的 Table 实现。迁移过程中各页面的 toast/筛选/分页逻辑保持不变，只替换 Table/Card 外壳
- **EmptyState 集成到 DataTable** — 不建独立 EmptyState 组件然后逐页使用。DataTable 新增 `emptyState: ReactNode` prop，simple variant 用于「无数据」、onboarding variant 用于 Dashboard 首次引导。向后兼容：保留 `emptyText` string prop 作为 fallback
- **审计日志页全量重建** — 不满足于 Token 替换。原生 HTML → shadcn Table、硬编码 gray → design Token、零暗黑支持 → `.dark` 响应。同时增加 `error.tsx` + `loading.tsx` 边界
- **操作入口规范** — 简单表单（≤5 字段）→ Dialog，复杂表单 → 独立页。CreateUserDrawer (Sheet) → CreateUserDialog (Dialog)。应用管理保持独立页（多区块 + Tabs）

---

## Open Questions

### Resolved During Planning

- `--primary` 语义：确认为 shadcn 前景色，不可改为品牌蓝 → 保留，只修 `--color-*` 层
- DataTable 迁移范围：6 页全迁（用户在 eng review 中选择）
- 操作入口统一方案：Dialog for simple, 独立页 for complex（用户确认）

### Deferred to Implementation

- EmptyState onboarding variant 的具体步骤文案（需对照实际 Dashboard 数据确认）
- Cmd+K 搜索结果的排序策略（按使用频率 vs 按字母）
- Playwright 快照测试的像素容差阈值（需在 CI 环境中调优）

---

## Implementation Units

### U1. CSS 颜色体系重构

**Goal:** 删除 globals.css 中的 hex `--color-*` 变量层，将所有颜色统一为 oklch 体系，保护 shadcn `--primary` 前景色语义。

**Requirements:** R1

**Dependencies:** None（阻塞所有后续 Unit）

**Files:**
- Modify: `apps/portal/src/app/globals.css`

**Approach:**
- **保留 `@theme inline` 中的 `var(--color-*)` 间接引用** — 不替换为直接 oklch 值。Tailwind 4 的 `@theme inline` 直接值在构建时编译为硬编码颜色，不支持 `.dark` 变量切换。保留 `var()` 间接引用使暗黑模式正常工作
- 将 `:root` 中 hex `--color-*` 变量（第 7-36 行）的**值**从 hex 改为 oklch：`--color-primary: oklch(0.55 0.22 255)`（品牌蓝）、`--color-background: oklch(0.99 0 0)` 等
- 将 `.dark` 块中 hex `--color-*` 覆盖（第 103-111 行）的**值**从 hex 改为暗黑 oklch：`--color-primary: oklch(0.62 0.19 250)` 等
- 保持 `:root` 中 shadcn oklch 变量（`--primary: oklch(0.205 0 0)` 等）完全不变
- `--color-gradient-start` / `--color-gradient-end` 保留变量但值改为 oklch（供 U3 登录页渐变使用）

**Patterns to follow:**
- `apps/portal/src/app/globals.css` 现有的 `@theme inline` 映射结构
- shadcn 默认 oklch 颜色语义（`--primary` = 前景文本，`--primary-foreground` = 背景）

**Test scenarios:**
- Happy path: `bg-primary` class 渲染为品牌蓝 oklch 值（视觉对比验证）
- Happy path: `text-primary-foreground` class 在 primary 背景上保持可读对比度
- Edge case: `.dark` 模式下所有 `--color-*` 映射切换到暗黑 oklch 值
- Edge case: 删除 hex 变量后，无任何组件引用未定义的 `--color-*` 变量（grep 验证）

**Verification:**
- `grep -r '\-\-color-' apps/portal/src/app/globals.css` 仅在 `@theme inline` 块中出现
- `grep '#0066FF\|#0052CC\|#E6F0FF' apps/portal/src/app/globals.css` 无匹配（hex 值已移除）
- 登录页、Dashboard、用户列表在浏览器中视觉回归通过（U6 快照对比）

---

### U2. DataTable 迁移 + EmptyState 集成

**Goal:** 激活死代码 DataTable 共享组件，迁移 4 个列表页使用（DepartmentTree 是树形结构非表格，Dashboard 审计表已有自定义布局，二者保持独立但共享 EmptyState 组件）；创建 EmptyState 组件（simple + onboarding 双变体），集成到 DataTable。

**Requirements:** R2

**Dependencies:** U1（颜色体系正常后，组件渲染结果才有意义）

**Files:**
- Modify: `apps/portal/src/components/shared/data-table.tsx`
- Create: `apps/portal/src/components/shared/empty-state.tsx`
- Modify: `apps/portal/src/app/(dashboard)/users/components/UserTable.tsx`
- Modify: `apps/portal/src/app/(dashboard)/roles/components/RolesTable.tsx`
- Modify: `apps/portal/src/app/(dashboard)/permissions/components/PermissionsTable.tsx`
- Modify: `apps/portal/src/app/(dashboard)/clients/components/ClientsTable.tsx`
- Modify: `apps/portal/src/app/(dashboard)/dashboard/page.tsx`（仅 EmptyState onboarding 集成，表格不迁移）
- Modify: `apps/portal/src/app/(dashboard)/departments/components/DepartmentTree.tsx`（仅 Card 圆角 + EmptyState 集成，不迁移到 DataTable——树形结构非表格）
- Test: `apps/portal/__tests__/components/empty-state.test.tsx`
- Test: `apps/portal/__tests__/components/data-table.test.tsx`

**Approach:**
- **EmptyState 组件** (`empty-state.tsx`): 接受 `variant: 'simple' | 'onboarding'`、`icon`、`title`、`description`、`action`（可选 `{label, href}` 或 `{label, onClick}`）、`steps`（onboarding variant 的步骤列表）。simple：图标+标题+描述+单 CTA。onboarding：图标+标题+描述+步骤 Checklist
- **DataTable 增强** (`data-table.tsx`): 新增 `emptyState?: ReactNode` prop。当 `data.length === 0 && !loading` 且 `emptyState` 存在时渲染之，fallback 到现有的 `emptyText` string 渲染。`rounded-[1.5rem]` 的替换由 U3 全局圆角收敛统一处理
- **页面迁移**: 4 个表格式列表页（RolesTable、PermissionsTable、UserTable、ClientsTable）的 `<Card><Table>` 内联实现替换为 `<DataTable>`。保留各页面特有的搜索/筛选/分页逻辑，只替换 Table/Card 外壳。DepartmentTree 保持树形结构（非表格），Dashboard 审计表保持自定义网格布局，二者仅集成 EmptyState 和圆角收敛
- **EmptyState 变体分配**: 「安全审计动态」表空数据 → simple variant（图标+描述）；「角色/权限/用户/客户端」列表空数据 → simple variant + CTA（创建按钮）；Dashboard 全页空数据（users=0）→ onboarding variant（步骤 Checklist）

**Patterns to follow:**
- `apps/portal/src/components/shared/data-table.tsx` 现有接口（columns/renderRow/loading/emptyText/cardHeader）
- `apps/portal/src/components/ui/` 下的 shadcn 组件风格（class-variance-authority + cn()）
- Dashboard 现有空状态模式：图标+标题+描述+CTA 按钮

**Test scenarios:**
- Happy path: EmptyState simple variant 渲染图标+标题+描述+CTA 按钮
- Happy path: EmptyState onboarding variant 渲染步骤 Checklist + CTA
- Happy path: CTA 按钮点击触发传入的 onClick / Link 跳转
- Happy path: DataTable 传入 `emptyState` prop 且 data 为空时渲染 EmptyState
- Happy path: DataTable 不传 `emptyState` 且 data 为空时渲染 fallback emptyText
- Edge case: DataTable loading=true 时不渲染 EmptyState（渲染 skeleton）
- Edge case: EmptyState 不带 action prop 时不渲染按钮区域

**Verification:**
- Grep 确认 4 个表格式列表页（Roles/Permissions/Users/Clients）不再有内联 `<Table>` 实现（均使用 DataTable）
- Dashboard users=0 时显示 onboarding checklist，users>0 时显示指标卡片
- `pnpm test:components` 通过新增的 empty-state + data-table 测试

---

### U3. 页面级视觉打磨

**Goal:** 统一页面视觉语言 — 登录页渐变背景、全站圆角收敛、页面标题统一、移除装饰性 blob。

**Requirements:** R4, R5, R10（部分）

**Dependencies:** U1

**Files:**
- Modify: `apps/portal/src/app/login/login-form.tsx`
- Modify: `apps/portal/src/app/(dashboard)/dashboard/page.tsx`
- Modify: `apps/portal/src/app/(dashboard)/users/page.tsx`
- Modify: `apps/portal/src/app/(dashboard)/audit-logs/page.tsx`
- Modify: `apps/portal/src/components/shared/data-table.tsx`（全局圆角收敛的一部分——在此替换 `rounded-[1.5rem]` 为规范值）

**Approach:**
- **登录页渐变**: `login-form.tsx` L114 `bg-slate-50` → `bg-gradient-to-br from-[#0066FF] to-[#003399]`。白色卡片保留，增加 `shadow-2xl`。品牌区域（图标+标题）文字改为白色适应深色背景
- **圆角收敛**: 全局搜索 `rounded-[*]`，将 `1.25rem`/`1.5rem`(24px)/`2rem`(32px) 等任意值替换为规范值：Card 容器 → `rounded-xl`(12px)，侧边栏/下拉菜单 → `rounded-2xl`(16px，从 DESIGN.md 扩展)，按钮/输入框保持 `rounded-lg`(8px)。共约 25 个文件。U2 中 DataTable Card 同步收敛
- **页面标题**: 审计日志页加 `<ShieldAlert />` 图标 + `text-2xl font-bold` + 副标题；用户管理页已有图标和标题，补充副标题一致性
- **装饰移除**: Dashboard L223 的 `<div className="absolute -right-8 -bottom-8 h-32 w-32 bg-white/10 rounded-full blur-2xl" />` 删除。侧边栏搜索 Input（L132-136）及外层 `<div className="px-2 py-2 group-data-[collapsible=icon]:hidden">` 删除——Cmd+K 是唯一搜索入口

**Patterns to follow:**
- 角色管理页 `page.tsx` — 标题格式：图标 + `text-3xl font-bold tracking-tight flex items-center gap-3` + `text-muted-foreground text-sm`
- DESIGN.md 分层圆角规范：sm=6px, md=8px, lg=12px

**Test scenarios:**
- Happy path: 登录页渲染品牌渐变背景 + 白色卡片 + 白色品牌文字
- Edge case: 暗黑模式下登录页渐变可读（品牌区域内文字对比度足够）
- Happy path: Dashboard 指标卡片使用规范圆角值（不再出现 `rounded-[1.25rem]` 等任意值）
- Happy path: 审计日志页标题显示图标+粗体标题+副标题
- Happy path: Dashboard 无模糊圆形装饰元素

**Verification:**
- Grep `rounded-\[` 仅匹配规范值：`sm|md|lg|xl|2xl|3xl|full`
- 登录页截图与 DESIGN.md 示意图匹配（渐变 + 白色卡片 + 阴影）
- 各页面标题风格一致（图标 + bold + 副标题）

---

### U4. 审计日志页全面重建

**Goal:** 将审计日志页从原生 HTML table 重建为 shadcn Table + 设计 Token + 暗黑模式 + 错误/加载边界。

**Requirements:** R3

**Dependencies:** U1, U2（颜色体系 + DataTable/EmptyState 就绪）

**Files:**
- Modify: `apps/portal/src/app/(dashboard)/audit-logs/page.tsx`
- Create: `apps/portal/src/app/(dashboard)/audit-logs/error.tsx`
- Create: `apps/portal/src/app/(dashboard)/audit-logs/loading.tsx`
- Test: `apps/portal/__tests__/components/audit-logs.test.tsx`

**Approach:**
- **Table 组件替换**: 原生 `<table>/<thead>/<tr>/<td>` → shadcn `<Table>/<TableHeader>/<TableBody>/<TableRow>/<TableCell>`。登录日志和操作日志两个 Tab 各自独立渲染
- **颜色 Token 化**: 硬编码 `bg-gray-50`→`bg-muted/50`、`text-gray-900`→`text-foreground`、`border-gray-200`→`border-border`、`bg-white`→`bg-card`。暗黑模式自动生效
- **Event Type 徽章**: `EVENT_TYPE_COLORS` 映射表从硬编码 `bg-green-100 text-green-800` → design token 语义色（`bg-success/10 text-success`），暗黑模式对应
- **分页**: 保持 searchParams 驱动的 `<Link>` 分页模式，增加 `aria-disabled` 和无障碍属性
- **Empty State**: 空数据时使用 U2 的 EmptyState simple variant + 「暂无日志」文案
- **边界**: `error.tsx` 捕获数据获取异常，`loading.tsx` 显示 Skeleton 表格

**Patterns to follow:**
- `apps/portal/src/app/(dashboard)/roles/components/RolesTable.tsx` — shadcn Table + Card 组合
- `apps/portal/src/app/(dashboard)/layout.tsx` — error.tsx/loading.tsx 模式

**Test scenarios:**
- Happy path: 登录日志 Tab 渲染 shadcn Table（非原生 HTML）
- Happy path: 操作日志 Tab 切换正确显示对应数据
- Happy path: 分页链接正确拼接 `?tab=login&page=2` searchParams
- Edge case: 暗黑模式下徽章颜色可读（不再硬编码 `bg-green-100`）
- Edge case: 空数据时显示 EmptyState 组件（非纯文字 "暂无登录日志"）
- Error path: 数据获取失败时渲染 error.tsx 边界（非白屏）

**Verification:**
- Grep `bg-gray-\|text-gray-\|border-gray-` 在 `audit-logs/page.tsx` 中无匹配
- Grep `<table\|<thead\|<tbody\|<tr\|<td\|<th` 在 `audit-logs/page.tsx` 中无匹配（原生 HTML table 已移除）
- 暗黑模式下审计日志页所有元素可读、徽章颜色正确

---

### U5. 交互与反馈打磨

**Goal:** 补齐交互一致性 — Command Palette 激活、Toast 反馈补全、操作入口统一（Sheet→Dialog）。

**Requirements:** R6, R7, R8, R10（部分——侧边栏搜索框功能绑定）

**Dependencies:** U1

**Files:**
- Create: `apps/portal/src/components/shared/command-palette.tsx`
- Modify: `apps/portal/src/components/layout/app-sidebar.tsx`
- Modify: `apps/portal/src/app/(dashboard)/users/components/CreateUserDrawer.tsx` → 重命名为 `CreateUserDialog.tsx`
- Modify: `apps/portal/src/app/(dashboard)/users/page.tsx`（更新 import: CreateUserDrawer → CreateUserDialog）
- Modify: `apps/portal/src/app/(dashboard)/clients/components/ClientsTable.tsx`
- Modify: `apps/portal/src/components/layout/DashboardLayout.tsx`（传递 menus prop 给 Command Palette）
- Test: `apps/portal/__tests__/components/command-palette.test.tsx`

**Approach:**
- **Command Palette**: 使用已安装的 shadcn `<CommandDialog>` + cmdk 构建。组件渲染在 `DashboardLayout` 中（与 `AppSidebar` 并排），接收与侧边栏相同的 `menus: SidebarMenuItem[]` prop。注册全局 `Cmd+K` 快捷键（200ms debounce 防双击闪烁）。搜索范围：菜单项 title + url。选择菜单项 → `router.push(url)` + 立即关闭面板（不等动画）。`CommandEmpty` 显示「未找到匹配的功能」+ 搜索图标。侧边栏搜索 Input 已删除（U3），Cmd+K 是唯一搜索入口
- **Toast 补全**: `ClientsTable.tsx` 中删除操作后添加 `toast.success()` / `toast.error()` 调用。创建和详情编辑在独立页面（`/clients/new`、`/clients/[id]`）中已有各自的 toast。其他 4 模块（roles/dept/perms/users）已有 toast，仅确认不遗漏
- **操作入口统一**: 将 `CreateUserDrawer.tsx` 的 `<Sheet>` 替换为 `<Dialog>`（shadcn Dialog 组件，与角色/部门/权限一致）。组件重命名为 `CreateUserDialog`。保留所有表单逻辑不变，仅换壳

**Patterns to follow:**
- `apps/portal/src/components/ui/command.tsx` — 已封装的 shadcn Command 组件
- `apps/portal/src/components/layout/app-sidebar.tsx` — ICON_MAP 白名单模式、displayMenus 数据结构
- `apps/portal/src/app/(dashboard)/roles/components/RolesTable.tsx` — Dialog 弹窗创建表单模式
- `apps/portal/src/app/(dashboard)/users/components/UserTable.tsx` — toast 反馈 + router.refresh() 模式

**Test scenarios:**
- Happy path: Cmd+K 打开 Command Palette，显示菜单项列表
- Happy path: 输入搜索词过滤结果，↑↓ 导航，Enter 跳转到目标页
- Edge case: 快速双击 Cmd+K 不产生闪烁（debounce 生效）
- Edge case: 选择菜单项后，页面导航完成后面板已关闭且无残留 DOM
- Happy path: ClientsTable 创建应用后 toast.success() 弹出
- Happy path: CreateUserDialog (原 CreateUserDrawer) 以 Dialog 弹窗形式打开
- Edge case: Dialog 内的表单提交后自动关闭弹窗 + toast 通知

**Verification:**
- Cmd+K 在任意管理后台页面可打开，搜索「用户」跳转到 `/users`
- Grep `CreateUserDrawer` 在 `apps/portal/src/` 中无匹配（已重命名）
- 手动操作：创建角色/部门/权限/应用/用户后均可见 toast 通知

---

### U6. 视觉回归测试

**Goal:** 为本次设计债清零建立自动化视觉回归防线。Playwright 快照测试覆盖关键页面。

**Requirements:** R9

**Dependencies:** U1, U2, U3, U4, U5 全部完成后执行

**Files:**
- Create: `tests/e2e/visual-regression.spec.ts`
- Modify: `tests/e2e/helpers.ts`（如需新增辅助函数）
- Verify: `apps/portal/__tests__/components/empty-state.test.tsx`（U2 创建，U6 确认通过）
- Verify: `apps/portal/__tests__/components/command-palette.test.tsx`（U5 创建，U6 确认通过）

**Approach:**
- **E2E 快照测试** (`visual-regression.spec.ts`):
  - 登录页：验证渐变背景 + 白色卡片 + 品牌元素渲染。使用 `expect(page).toHaveScreenshot()`（Playwright 原生快照）
  - Dashboard：验证指标卡片、EmptyState onboarding checklist（users=0 场景）、圆角收敛后的卡片样式
  - 用户列表：验证 DataTable 渲染、EmptyState simple variant
  - 审计日志：验证 shadcn Table 渲染、双 Tab 切换、暗黑模式徽章
- **组件测试** (vitest + jsdom): EmptyState（simple/onboarding 渲染 + CTA 点击）+ Command Palette（打开/关闭 + 搜索过滤 + 键盘导航）
- **CI 集成**: 快照测试加入 `pnpm test:e2e` 流程。首次运行生成 baseline 快照，后续运行进行比对

**Patterns to follow:**
- `tests/e2e/helpers.ts` — loginAsAdmin / logout 辅助函数
- `tests/e2e/user-story-screenshots.spec.ts` — 现有截图测试模式
- `apps/portal/__tests__/components/` — vitest + jsdom 组件测试模式

**Test scenarios:**
- Happy path: 登录页快照匹配 baseline（渐变背景渲染正确）
- Happy path: Dashboard 快照匹配 baseline（圆角规范值、无 blob）
- Happy path: 用户列表空数据快照匹配 baseline（EmptyState simple 渲染）
- Edge case: 快照测试在 CI 环境中可重复执行（像素阈值配置合理）
- Integration: 登录 → Dashboard → 用户列表 完整流程快照

**Verification:**
- `pnpm test:e2e` 通过（含视觉回归快照），首次运行生成 baseline
- `pnpm test:components` 通过（含 EmptyState + Command Palette 组件测试）

---

## System-Wide Impact

- **Interaction graph:** CSS 变量变更（U1）影响所有使用 Tailwind color class 的组件（全局）。DataTable 迁移（U2）影响 6 个列表页组件。审计日志重建（U4）仅影响单页面
- **Error propagation:** 操作失败 → Server Action 返回 `{success: false, message: '...'}` → Toast error（无新错误路径，只补齐了可视反馈）
- **State lifecycle risks:** Command Palette 打开状态 → 导航跳转时需手动关闭（已在 U5 处理）。EmptyState onboarding → Dashboard 首次加载后条件渲染切换，无状态残留
- **Unchanged invariants:** Server Action 签名不变、API 响应格式不变、路由结构不变、auth 中间件不变、DB schema 不变

---

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| U1 CSS 变更导致全站颜色异常（`--color-*` 映射错误） | U6 视觉快照覆盖登录+Dashboard+用户列表三页面。修复前 `grep --color-*` 确认无残留引用 |
| U2 DataTable 迁移引入回退（6 页同时改动） | 每页独立 commit。DataTable API 向后兼容（保留 `emptyText` fallback） |
| U4 审计日志重建后分页/筛选行为偏差 | 保持 searchParams 驱动模式不变。Tab 切换和分页逻辑从旧代码行对行迁移 |
| Cmd+K 与系统快捷键冲突 | 仅注册在 Portal 页面内（非全局 OS 级）。`event.preventDefault()` 阻止浏览器默认 Cmd+K 行为 |
| 暗黑模式覆盖不完整 | U4 审计日志页为唯一完整暗黑覆盖目标。其他页面在 deferred —— 不在本次范围内 |

---

## Documentation / Operational Notes

- DESIGN.md 更新为 oklch 色值 → deferred to follow-up（本次任务不阻塞出货）
- 视觉快照 baseline 在 CI 首次运行时自动生成，后续 PR 中 reviewer 可对比快照 diff

---

## Sources & References

- 设计评审: `/plan-design-review` (2026-06-25, score 6→7.5/10, 12 decisions)
- CEO 评审: `/plan-ceo-review` (2026-06-25, HOLD_SCOPE, 1 critical gap)
- Eng 评审: `/plan-eng-review` (2026-06-25, FULL_REVIEW, 5 issues, 3 cross-model resolved)
- DESIGN.md: `DESIGN.md` v2.1 — 颜色/字体/间距/圆角/组件规范
- Test plan: `~/.gstack/projects/anjing0524-auth-sso/liushuo-main-eng-review-test-plan-20260625-134928.md`
- 原始设计文档: `~/.gstack/projects/anjing0524-auth-sso/liushuo-main-design-20260420-104232.md`

---

## /autoplan CEO Review — 2026-06-26

### Mode: SELECTIVE EXPANSION (auto-decided per autoplan rules)

### Implementation Status at Review Time

Plan is ~85% implemented. U1-U5 are substantially complete. Remaining work: U6 (visual regression tests), 5 shadcn base components with arbitrary border-radius values, DESIGN.md oklch update (deferred).

### Premise Challenge (0A)

| Premise | Status | Notes |
|---------|--------|-------|
| "Design debt is blocking release" | **UNCERTAIN** | No user data or analytics to confirm. The product has zero telemetry — we don't know what users actually use or where they struggle. |
| "Cmd+K should be the only search entry point" | **QUESTIONABLE** | SMB admins are not power users. Removing the sidebar search box removes discoverability for the majority who don't use keyboard shortcuts. |
| "Dark mode is a requirement for this release" | **OVER-SCOPED** | B2B admin panel used during business hours. Dark mode validation across all pages is deferred anyway — audit log page alone gets it. |
| "3 visual snapshot tests provide adequate quality coverage" | **INSUFFICIENT** | Snapshots capture rendering but not behavior. They break on every UI change and tend toward baseline rot in CI. |

### Implementation Alternatives (0C-bis)

Since U1-U5 are already implemented, alternatives analysis focuses on remaining work:

**APPROACH A: Complete U6 as planned (visual snapshots)**
- Effort: S (human: ~2h / CC: ~15min)
- Risk: Medium — snapshot maintenance burden over time
- Pros: Fast to implement, catches visual regressions
- Cons: High false-positive rate in CI, undefined pixel thresholds

**APPROACH B: Replace U6 snapshots with component-level interaction tests**
- Effort: M (human: ~4h / CC: ~30min)
- Risk: Low — standard vitest + jsdom, no flakiness
- Pros: Tests behavior not pixels, no CI maintenance, covers loading/empty/error states
- Cons: Doesn't catch CSS rendering bugs (but those are rare and caught in QA)

**RECOMMENDATION: B** — Component tests catch what matters (behavior, states) without the CI maintenance tax of pixel-diff snapshots.

### CEO Dual Voices

**Codex:** Unavailable (UTF-8 encoding error in repo path — Chinese characters incompatible with Codex WS header). Proceeding single-model.

**Claude Subagent (CEO — strategic independence):**
- CRITICAL: Zero analytics/telemetry. Strategic blind spot — flying without instruments.
- HIGH: DESIGN.md drift vs implementation (oklch vs hex in DESIGN.md v2.1). Documentation debt > visual debt.
- HIGH: P1 production-readiness items remain unfixed. Polish before stability is wrong ordering.
- HIGH: U6 visual snapshots will rot in CI without defined thresholds and review discipline.
- MEDIUM: EmptyState onboarding variant is a stub — steps undefined. Ship or remove.
- MEDIUM: Cmd+K global shortcut may conflict with browser/OS shortcuts (Cmd+K clears terminal on Mac).
- MEDIUM: Competitive positioning — framed as "design polish" not "compliance UI."

### CEO Consensus Table

```
CEO DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Premises valid?                   MIXED   N/A    MIXED
  2. Right problem to solve?           PARTIAL N/A    PARTIAL
  3. Scope calibration correct?        YES     N/A    YES
  4. Alternatives sufficiently explored? NO    N/A    NO
  5. Competitive/market risks covered? NO      N/A    NO
  6. 6-month trajectory sound?         CONCERN N/A    CONCERN
═══════════════════════════════════════════════════════════════
CONFIRMED = both agree. DISAGREE = models differ.
N/A = Codex unavailable (path encoding error).
```

### Scope Expansion — Cherry-Pick Ceremony (SELECTIVE EXPANSION)

Per autoplan auto-decision rules (P1 completeness + P2 boil lakes), the following expansions are evaluated:

**E1: Analytics/Telemetry foundation** — Add `POST /api/telemetry` endpoint with minimal client-side event tracking (page views, feature usage, errors). This unblocks data-driven decisions for all future work.
- Effort: M (human: ~4h / CC: ~20min)
- Decision: **DEFER to TODOS.md** — Outside blast radius (new API endpoint, new infra concern). Right problem, wrong PR.

**E2: DESIGN.md oklch update** — Bring DESIGN.md v2.1 color tokens in sync with globals.css reality.
- Effort: S (human: ~30min / CC: ~5min)
- Decision: **ACCEPT** — In blast radius (plan already references DESIGN.md). Prevents documentation drift. One file change.

**E3: P1 production-readiness items** — Fix remaining 6 P1 items from acceptance criteria.
- Effort: M (human: ~3h / CC: ~20min)
- Decision: **DEFER to TODOS.md** — Outside blast radius. Critical but separate concern.

### Completion Summary

```
+====================================================================+
|            MEGA PLAN REVIEW — COMPLETION SUMMARY                   |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                         |
| System Audit         | Plan 85% implemented; globals.css oklch OK  |
| Step 0               | Premises mixed, alternatives under-explored |
| Section 1  (Arch)    | 0 issues — CSS-only, no arch changes        |
| Section 2  (Errors)  | 0 new error paths — UI polish only          |
| Section 3  (Security)| 0 issues — no new attack surface            |
| Section 4  (Data/UX) | 1 gap: EmptyState onboarding steps undefined|
| Section 5  (Quality) | 0 issues — patterns consistent              |
| Section 6  (Tests)   | 1 gap: U6 snapshots → recommend component   |
|                      | tests instead (lower maintenance)            |
| Section 7  (Perf)    | 0 issues — CSS-only changes                 |
| Section 8  (Observ)  | 1 CRITICAL GAP: zero analytics/telemetry    |
| Section 9  (Deploy)  | 0 issues — static frontend changes          |
| Section 10 (Future)  | Reversibility: 5/5 (CSS revert), debt: low  |
| Section 11 (Design)  | 1 gap: DESIGN.md stale vs oklch impl        |
+--------------------------------------------------------------------+
| NOT in scope         | written (3 items)                           |
| What already exists  | written                                     |
| Dream state delta    | written                                     |
| Error/rescue registry| 0 methods (no new backend codepaths)        |
| Failure modes        | 0 (no new backend codepaths)               |
| TODOS.md updates     | 3 items proposed                            |
| Scope proposals      | 3 proposed, 1 accepted (E2: DESIGN.md sync) |
| Outside voice        | Codex unavailable, Claude subagent ran      |
| Lake Score           | 1/1 recommendations chose complete option   |
| Diagrams produced    | 0 (no new architecture)                     |
| Unresolved decisions | 0                                            |
+====================================================================+
```

### NOT in scope
- Gateway (Rust/Pingora) changes — confirmed
- DB Schema changes — confirmed
- New API endpoints — confirmed
- Analytics/telemetry system — deferred to TODOS.md (right problem, wrong PR)
- P1 production-readiness fixes — deferred to TODOS.md (separate concern)

### What already exists
- `globals.css` already uses oklch values for all `--color-*` variables (U1 done)
- `DataTable` already has `emptyState` prop (U2 done)
- `EmptyState` component exists with simple + onboarding variants (U2 done)
- `CommandPalette` component exists (U5 done)
- `CreateUserDialog` replaces CreateUserDrawer (U5 done)
- Login page already has gradient background (U3 done)
- Audit logs already use shadcn Table (U4 done)

### Dream state delta
CURRENT: Functional admin panel with inconsistent design tokens → THIS PLAN: Unified oklch color system, shared DataTable, consistent interactions → 12-MONTH IDEAL: Data-driven product with telemetry, customer onboarding docs, demo sandbox, compliance-certified UI.

### Accepted Scope Expansions
- **E2: DESIGN.md oklch update** — Sync DESIGN.md color tokens with globals.css reality (1 file, ~30min human / ~5min CC)

### Deferred to TODOS.md
- E1: Analytics/Telemetry foundation
- E3: P1 production-readiness items
- DESIGN.md update (already listed as deferred in original plan)
- Global dark mode validation beyond audit log page

---

## /autoplan Design Review — 2026-06-26

### Design Implementation Audit (actual code, not plan)

Since U1-U5 are implemented, this review audits the actual code against the plan's requirements.

### Findings

| # | Severity | Category | File | Issue |
|---|----------|----------|------|-------|
| 1 | **CRITICAL** | Token leak | `CreateUserDialog.tsx` | 8 hardcoded `text-slate-*` / `bg-slate-*` bypassing oklch system |
| 2 | **CRITICAL** | Token leak | `dashboard/page.tsx:186` | Status badge uses `bg-green-100` (hardcoded, no dark mode) |
| 3 | **HIGH** | Token leak | `dashboard/page.tsx:90,100,110,120` | Metric cards use `hover:bg-[#E6F0FF]` hex bypassing oklch |
| 4 | **HIGH** | Error state | Dashboard | Missing `error.tsx` — white screen on data fetch failure |
| 5 | **HIGH** | Token leak | `data-table.tsx:53` | Header uses `bg-slate-50/30` instead of design token |
| 6 | **HIGH** | Consistency | Multiple | Border-radius values inconsistent: `rounded-xl` on buttons, `rounded-b-[1.5rem]` in UserTable |
| 7 | MEDIUM | UX | `login-form.tsx:101` | Login success redirect is abrupt — no transition/confirmation |
| 8 | MEDIUM | Token leak | `audit-logs/error.tsx:29-31` | Hardcoded `bg-amber-50` / `text-amber-500` |
| 9 | MEDIUM | Visual | `command-palette.tsx:70` | Menu icons defined in model but not rendered |
| 10 | LOW | Hierarchy | `login-form.tsx:119` | "Auth-SSO Portal" (tech name) above "企业统一身份认证" (product name) |
| 11 | LOW | Documentation | `DESIGN.md` | Missing `rounded-2xl` (16px) entry in the radius spec table |

### Design Litmus Scorecard

```
DESIGN REVIEW — LITMUS SCORECARD:
═══════════════════════════════════════════════════════════════
  Check                                    Claude  Codex  Consensus
  ─────────────────────────────────────── ─────── ─────── ─────────
  1. Brand unmistakable in first screen?   NO      N/A    NO
  2. One strong visual anchor?             YES     N/A    YES
  3. Scannable by headlines only?          YES     N/A    YES
  4. Each section has one job?             MOSTLY  N/A    MOSTLY
  5. Cards actually necessary?             YES     N/A    YES
  6. Motion improves hierarchy?            N/A     N/A    N/A
  7. Premium without decorative shadows?   YES     N/A    YES
  ─────────────────────────────────────── ─────── ─────── ─────────
  Hard rejections triggered:               0       N/A    0
═══════════════════════════════════════════════════════════════
```

### Design Score: 6.5/10 → 8/10 (after fixing P1 items)
- Initial: Solid infrastructure (oklch system, shared DataTable, gradient login) but 2 CRITICAL token leaks in new components
- Target 10: All components use design tokens, dark mode works on every page, error boundaries catch every data fetch failure

---

## /autoplan Eng Review — 2026-06-26

### Engineering Implementation Audit

### Architecture

Component structure is sound. DataTable is a focused thin wrapper. EmptyState cleanly separates simple/onboarding variants. CommandPalette shares menu props with AppSidebar. No new coupling concerns — all changes are within the existing Portal component tree.

```
ARCHITECTURE DEPENDENCY GRAPH:
═══════════════════════════════════════════════════════════════
  DashboardLayout
  ├── AppSidebar (menus prop)
  ├── CommandPalette (menus prop — same source)
  └── Page Content
       ├── DataTable ← shared component (4 list pages)
       │   ├── Card + Table (shadcn)
       │   ├── Skeleton loading
       │   └── EmptyState (simple | onboarding)
       ├── DepartmentTree (custom, not migrated)
       └── Dashboard widgets (custom, not migrated)
  
  globals.css (oklch variables)
  └── @theme inline → Tailwind color classes
       └── All components consume via Tailwind classes
═══════════════════════════════════════════════════════════════
```

### Findings

| # | Severity | Category | File | Issue |
|---|----------|----------|------|-------|
| H1 | **HIGH** | Tests | `__tests__/components/` | All 4 component test files from the plan are MISSING (empty-state, data-table, command-palette, audit-logs) |
| M1 | MEDIUM | Token leak | `dashboard/page.tsx:90` | Hex `#E6F0FF` hover colors bypassing oklch system |
| M2 | MEDIUM | Inconsistency | `UserTable.tsx:267` | `rounded-b-[1.5rem]` arbitrary value not converged |
| M3 | MEDIUM | Error handling | 4 list pages | Missing `error.tsx` boundaries for roles/permissions/users/clients |
| M4 | MEDIUM | Consistency | `PermissionsTable.tsx:109` | Client-only search filter, not synced to URL (lost on refresh) |
| M5 | MEDIUM | UX | `command-palette.tsx:71` | Menu item `icon` field silently ignored |
| L1 | LOW | Token leak | `data-table.tsx:53` | `bg-slate-50/30` instead of design token |
| L2 | LOW | Token leak | `audit-logs/error.tsx:29` | Hardcoded `bg-amber-50` / `text-amber-500` |
| L3 | LOW | Tests | `visual-regression.spec.ts:54` | Fragile CSS-substring selector for arbitrary radii |
| L4 | LOW | Robustness | `command-palette.tsx:53` | flatMap only handles 1 level of nesting |
| L5 | LOW | Dead code | `UserTable.tsx:87` | Exported `UserTableSkeleton` likely unused |

### Eng Consensus Table

```
ENG DUAL VOICES — CONSENSUS TABLE:
═══════════════════════════════════════════════════════════════
  Dimension                           Claude  Codex  Consensus
  ──────────────────────────────────── ─────── ─────── ─────────
  1. Architecture sound?               YES     N/A    YES
  2. Test coverage sufficient?         NO      N/A    NO
  3. Performance risks addressed?      YES     N/A    YES
  4. Security threats covered?         YES     N/A    YES
  5. Error paths handled?              PARTIAL N/A    PARTIAL
  6. Deployment risk manageable?       YES     N/A    YES
═══════════════════════════════════════════════════════════════
```

### Test Coverage Assessment

| New UX/DATA Flow | Test Type | Covered? | Gap |
|------------------|-----------|----------|-----|
| EmptyState simple rendering | Component | NO | Test file missing |
| EmptyState onboarding rendering | Component | NO | Test file missing |
| DataTable loading→empty transition | Component | NO | Test file missing |
| CommandPalette keyboard nav | Component | NO | Test file missing |
| AuditLogs tab switching | Component | NO | Test file missing |
| Login page gradient rendering | E2E | YES | visual-regression.spec.ts |
| Dashboard cards rendering | E2E | YES | visual-regression.spec.ts |
| Users list DataTable rendering | E2E | YES | visual-regression.spec.ts |

---

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|--------|---------|-----|------|--------|----------|
| CEO Review | `/autoplan` | Strategy & scope | 1 | issues_open | 3 proposals: 1 accepted (DESIGN.md sync), 2 deferred (analytics, P1 fixes) |
| Design Review | `/autoplan` | UI/UX gaps | 1 | issues_open | 11 findings: 2 CRITICAL (token leaks), 4 HIGH, 3 MED, 2 LOW |
| Eng Review | `/autoplan` | Architecture & tests | 1 | issues_open | 10 findings: 1 HIGH (missing tests), 5 MED, 4 LOW |
| DX Review | `/autoplan` | DX gaps | 0 | skipped | No developer-facing scope detected |

**CODEX:** Unavailable — UTF-8 encoding error in repo path (Chinese characters incompatible with Codex WS header). All voices Claude-only.

**VERDICT:** CEO + DESIGN + ENG reviews complete. 2 CRITICAL (token leaks in CreateUserDialog + Dashboard status badge), 1 HIGH (missing component tests), 5 MEDIUM issues to fix before ship. No architectural concerns.

NO UNRESOLVED DECISIONS

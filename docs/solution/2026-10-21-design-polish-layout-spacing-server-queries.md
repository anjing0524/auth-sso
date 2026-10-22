# UI 设计打磨：主内容区 / 间距体系 / 查询侧 / 按钮文字 / 中文优先（2026-10-21）

> 触发（用户）：“有些间距设计不合理，有些查询是客户端查询还是服务端查询，主要内容区域是不是过小了，有些按钮是不是需要加上文字，有些英文按钮是否应该是中文——作为 UI 设计师发现问题并修复，分清主次要，识别层次感与美观感，规范也可以修改。”
>
> 方法：先量后改。写设计审计脚本采集 **主内容区尺寸 / 卡片宽度 / 页面高度 / 图标按钮 / 英文文案**，逐页截图做视觉评审；再按“层次（页头→筛选→数据）→ 密度（间距/主内容区）→ 文案（按钮/中英文）”的顺序修。

## 1. 主要内容区“过小”：改为填满视口的应用壳

**问题实测**：列表页表格区此前用 `max-h-[calc(100vh-30rem)]` 之类的**估算值**控制（权限页只有 420px 高），页面底部整块空白；同时 `SidebarProvider` 高度随内容增长（1217px），页面整体滚动。

**修复（结构性）**：
- 应用壳改为**固定视口高度**：`SidebarProvider className="h-svh overflow-hidden"`，主内容区 `#main-content` 自身是滚动容器；
- 列表页 wrapper 改为 `flex flex-1 flex-col gap-6 min-h-0`，`DataTable` 新增 `fill` 模式：卡片 `flex-1`、表格区内部滚动、表头吸顶、分页固定在卡片底部；
- 详情页/工作台在同一个主内容容器内滚动（不再出现“整页滚动 + 卡片内部滚动”两层）。

**实测（1440×900，改造前后）**：

| 页面 | 改造前表格区 | 改造后 | 页面高度 | 分页底边 |
|---|---|---|---|---|
| 用户管理 | 374px | **515px** | 900 | 876（首屏）|
| 角色管理 | 419px | **515px** | 900 | 876 |
| 权限管理 | 420px | **451px**（含页签行）| 900 | 876 |
| 审计日志 | 500px | **508px** | 900 | 876 |
| 应用管理 | 370px | **579px** | 900 | 876 |

“分页出现在滚动之后”的旧问题仍受保护：5 个列表页分页底边全部 ≤ 876 < 900。

## 2. 间距不合理：收敛到 24px 体系

审计发现 `gap-8`（32）、`px-8 / pt-8 / p-8`、`space-y-8`、错误页 `pt-8` 与主体系（区块 24、卡片内边距 24、栅格 24）混用。统一：

- 用户详情：栅格 `gap-8 → gap-6`（两处）；
- 个人中心：hero `p-8/lg:p-12 → p-6/lg:p-8`、`gap-8 → gap-6`、左列 `space-y-8 → space-y-6`、卡片 `px-8/pt-8 → 标准 24`、`p-8 → p-6`；
- 工作台：卡头 `px-8 → px-6`、卡片内边距统一 24；
- 7 个错误页 `pt-8 → pt-6`；审计 loading 骨架 `gap-8 → gap-6`；
- 工作台“首次使用引导”改为在可视区域内**垂直居中**（原来顶部对齐 + `py-10`，下方整屏空白）。

规范：间距只用 4/8/12/16/24/32 六档；页面区块 24、卡片内边距 24、栅格 24；禁止 8/32 的“孤例”。

## 3. 客户端查询 vs 服务端查询：权限列表收口到服务端

审计结果：users / roles / clients / audit-logs 已是服务端 URL 查询（搜索/过滤/分页参数进 URL，`data.ts` 走 `withPagination`）；**权限管理是唯一例外**——服务端把全量 45+ 行一次传给客户端，浏览器内做关键词过滤与分页（`PAGE_SIZE=15`），并且数据层早已存在未被使用的 `getPermissionPage()`。

修复：
- `getPermissionPage` 支持 `keyword`（name/code `ILIKE`）+ `type` 组合条件；
- 页面按 `page / type / keyword` 解析并**服务端分页**（15/页），菜单父级候选用缓存的全量读模型；
- 表格改为 URL 驱动：搜索 400ms 防抖、类型页签、翻页全部 `router.push` 到带参数的 URL（可分享/可后退/可刷新）；
- 测试实测：45 条 → 每页 15 行；`?page=2`、`?type=API`、`?keyword=portal:user` 均由服务端生效（8 行结果）。

规则（写入 DESIGN）：**列表的搜索/过滤/分页必须在服务端完成并反映到 URL**；客户端过滤只允许用于本地树（部门树）或对话框内的权限勾选搜索。

## 4. 有些按钮需要文字：行内操作与分页补中文

| 位置 | 之前 | 之后 |
|---|---|---|
| 用户行内 | 3 个纯图标 | 编辑 / 分配角色 / 禁用（图标+文字）|
| 角色行内 | 3 个纯图标 | 编辑 / 配置权限 / 删除 |
| 权限行内 | 2 个纯图标 | 编辑 / 删除 |
| 应用行内 | 2 个纯图标 | 编辑配置 / 注销 |
| 部门行内 | 4 个纯图标（+ 符号含义不明）| 子部门 / 成员 / 编辑 / 删除 |
| 分页 | 只有左右箭头 | `‹ 上一页` / `下一页 ›` |
| 应用详情复制 | 图标 | 复制（Client ID / 新 Secret）|

保留纯图标的只有“通用且无歧义”的控件：弹窗关闭 X、侧边栏折叠、树形展开箭头；一律有 `aria-label` + `title`。
好处不仅是可读性：行内操作从“猜图标”变成可直接扫读的动词，主次更清楚（危险操作仍用红色文字）。

## 5. 英文按钮改中文（中文优先，技术词保留）

- `System Control`（侧栏分组标题）→ **系统管理**
- `Toggle Sidebar`（sr-only/aria/title）→ **切换侧边栏**
- 弹窗 `Close` → **关闭**
- 侧栏 `Authenticated Account` → **当前登录账号**；`Sign Out` → **退出登录**

保留英文的只有**协议/凭据/品牌名词**：OAuth、OpenID Connect、Client ID、Client Secret、Token、Scopes、CSV、URL、应用名与角色/权限编码（`SUPER_ADMIN`、`portal:user:list`、`ROOT`）、`Identity OS` 品牌副标。这条边界写进 DESIGN。

## 6. 主操作位置统一（层次感）

应用详情原来“保存修改 / 禁用”在表单卡片**底部**，1440×900 下落在首屏之外；用户详情则是页头右侧操作。统一为：
**详情页主操作放 `PageHeader` 右侧**（禁用/启用 = outline 危险色，保存修改 = 主按钮）；Portal 自身客户端只读时两个按钮 disabled。
这样“页头（是谁）→ 页签（看哪块）→ 内容 → 页头主操作（做什么）”的层次一致，主操作永远在首屏。

## 7. 验证

| 项 | 结果 |
|---|---|
| 设计验证脚本（`.ui-audit/verify-design-rounds.mjs`）| **16/16**：服务端分页/URL 过滤、填充高度、行内文字、分页文字、详情内部滚动、移动端无溢出、无英文按钮、无 JS 异常 |
| 逐控件点击 159 次 | 0 pageerror / 0 console error / 0 5xx / 0 错误 toast |
| 功能闭环 43 / UI 27 / 分页 5 / 发现 6 / 安全 16 / 响应式键盘 30 | 全通过 |
| 组件评分 / a11y | 12 页 × 100；浅色+深色 0 违规 |
| 门禁 | `pnpm test` 全绿、`pnpm test:e2e` 1/1、lint 0 error、typecheck 0 error |

## 8. 变更文件（关键）

- 布局：`components/layout/DashboardLayout.tsx`（固定壳+滚动主区）、`components/shared/data-table.tsx`（fill 模式）、5 个列表页 wrapper、审计页两处表格容器
- 查询：`permissions/data.ts`（keyword）、`permissions/page.tsx`、`permissions/components/PermissionsTable.tsx`
- 按钮文字：`users/UserTable`、`roles/RolesTable`、`permissions/PermissionsTable`、`clients/ClientsTable`、`departments/DepartmentTree`、`shared/table-pagination.tsx`、`clients/[id]/components/ClientInfoSection.tsx`
- 中文：`layout/app-sidebar.tsx`、`ui/sidebar.tsx`、`ui/dialog.tsx`、`ui/sheet.tsx`
- 间距/层次：`users/[id]/UserDetailForm.tsx`、`profile/ProfileClient.tsx`、`dashboard/page.tsx`、7 个 `error.tsx`、`audit-logs/loading.tsx`、`clients/[id]/ClientDetailClient.tsx`
- 规范：`DESIGN.md` v2.8

## 9. 保留判断

- 列表页在数据很少时（如 1 行）表格区会留白：这是“固定表区高度、分页永远可见”的代价，换来跨页一致与无跳动；若将来数据稀少成为常态，可改为 `min-h` 自适应。
- 审计日志顶部导出按钮是两个并列 outline（无主次差别）——导出不是主操作，保持同级。
- 部门树仍为客户端搜索：树结构需整体加载，且规模小；已在 DESIGN 中列为例外。
- 未引入“侧边栏收起时内容区宽度自适应”的改动：当前默认展开、可手动折叠，属既有交互。

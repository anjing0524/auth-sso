# 规模数据 UX 审计与优化（201 用户 / 345 权限 / 25k 日志，2026-10-21）

> 触发（用户）：“构造大量测试数据场景，从用户使用角度出发，检查可优化项目。”
>
> 方法：向验收栈注入真实规模数据（201 用户、32 角色、345 权限、41 部门 3 层、31 客户端、25k+ 审计/登录日志），
> 再逐页做「用户视角」审计：分页可达性、搜索/筛选、导出、对话框容量、长文本、树折叠、构建可复现性；
> 每个问题都修复并回归。测试数据脚本与审计脚本在 `.ui-audit/`（gitignored），验收栈最后已重置为 seed 状态。

## 0. 构造的数据（可重复）

| 表 | 数量 | 覆盖场景 |
|---|---|---|
| users | 201 | 超长姓名、ACTIVE/DISABLED/LOCKED、跨部门 |
| roles | 32 | 超长角色名、每用户 2 角色 |
| permissions | 345 | 12 目录 + 48 页面（父子）+ 240 接口，超长名称 |
| departments | 41 | 根 + 12 一级 + 22 二级 + 6 三级，超长名称 |
| clients | 31 | 超长应用名、31 个回调地址、启用/禁用 |
| audit_logs / login_logs | 25k+ | 两种日志分别 5k+，事件/操作类型混合，失败记录 |

（脚本：`.ui-audit/generate-scale-data.sql`，含 ancestors 路径递归修正——最初漏了祖先链，导致
数据范围把生成用户/部门判为不可见，这本身也是一次“规模数据暴露的隐藏约束”。）

## 1. 高危发现：React #418 hydration mismatch（数据相关，影响所有后台页）

规模数据下**每个后台页** console 报 `Minified React error #418`；seed 数据下不出现。
逐页二分定位到「侧边栏菜单出现**带子节点的目录**」这一条件。抓服务端 HTML 发现：

```html
<button data-base-ui-tooltip-trigger>
  <button data-sidebar="menu-button">调试目录</button>
</button>
```

根因：`SidebarMenuButton` 的 tooltip 分支用 `<TooltipTrigger>{button}</TooltipTrigger>`，
Base UI 的 TooltipTrigger 默认渲染一个 `<button>` 包裹，而 menu button 本身也是 `<button>` ⇒
**嵌套 button 是非法 HTML**，浏览器解析时自动闭合外层，hydration 与服务端 HTML 对不上 → #418。
seed 菜单都是无子节点的 PAGE（`asChild` 渲染 `<a>`），所以一直没暴露。

修复：`<TooltipTrigger render={button} />`，把 trigger 行为合并到同一个元素；全页（桌面 + 移动）
复测 **0 pageerror**。

附带一条工程约束（写入 DESIGN）：**组合组件（Tooltip/Dropdown/触发器等）不得把交互元素嵌套进默认按钮**，
需要合并时用 `render`/`asChild`；此类问题只有真实 HTML（而非 jsdom）能测出来。

## 2. 分页：351 页只能“上一页/下一页”

25k 审计 = 351 页、345 权限 = 23 页、201 用户 = 14 页；原分页只有 prev/next，去中间页要点几十次。
修复 `TablePagination`：

- **首页/末页**按钮、**页码窗口**（1 … 当前±1 … 末页，省略号）；
- **跳页输入**：客户端列表用 `<PaginationJump>`；服务端审计用同构 GET form（无 JS 可用）；
- 移动端隐藏页码窗口，只留「当前/总页 + 上下页」；
- 搜索/筛选时重置到第 1 页（URL 参数驱动）。

实测：用户页跳到第 8 页 URL `?page=8` 生效；越界 `?page=99999` 不报错（夹紧）。

## 3. CSV 导出只导出了 100 行

导出路由用 `getLoginLogs({ page: 1, pageSize: MAX_PAGE_SIZE })`，而 `MAX_PAGE_SIZE=100` ⇒
25k+ 条日志实际只导出 **100 行**。修复：按页循环取全量（上限 10 万行），并把筛选参数
（eventType/operation）透传给导出。

实测：登录 CSV **25,283 行 / 3.2MB / ≈1.8s**，操作 CSV 25,315 行；Excel BOM 与公式注入防护保留。

## 4. 角色权限对话框只能看到 200/345 项

对话框请求 `/api/permissions?pageSize=500`，服务端夹到 `MAX_PAGE_SIZE=100`（分页信封）；
345 项权限下只能加载 200 项（含分页行为），**145 项不可分配**。
修复：按页循环拉全量（`pageSize=100&page=1..N`，上限 50 页）。实测对话框渲染全部 345 项（约 2.6s 打开）。

## 5. 应用列表没有分页/总数

`clients/page.tsx` 固定 `pageSize: 100` 一次拉全量，31 条时整表渲染、无「共 N 条」。
修复：服务端分页 15/页 + 统一分页条 + 总数；搜索保留 `keyword`、翻页写回 URL。实测 31 条 → 3 页，`?page=2` 生效。

## 6. 审计日志 25k 行没有类型筛选

数据层 `getLoginLogs(eventType)` / `getAuditLogs(operation)` 早已支持，UI 只有两个 tab。
修复：新增 `AuditFilters`（登录事件类型 / 操作类型），枚举白名单校验后写 URL，分页与导出均保留筛选。
实测：`?tab=login&eventType=LOGIN_FAILED` → 共 5,019 条，首屏 15 行；导出同样按筛选全量。

## 7. 部门树“折叠”是假的

`expanded` 只切换图标，`filtered` 始终渲染全部节点：点击折叠子节点不会隐藏；40+ 部门时无法聚焦。
修复：
- 可见行真正按 `expanded` 递归（默认只展开根）；
- 工具栏加「展开全部 / 收起全部」；
- 搜索时忽略展开状态并保留命中节点的祖先链（不会“搜到了但父级收起”）；
- 空搜索结果给出专门空态。

实测：默认 13 行 → 展开全部 41 行 → 收起全部 1 行；搜索「规模子部门1」显示 22 行（含祖先链）。

## 8. 长文本把表格撑破（操作列被推出屏幕）

规模数据下表格实际宽度：用户 1307px、角色 1212px、应用 **1452px**（操作列表头右边界 1732 > 1440 视口），
行内操作需要横向滚动才能看到。修复：名称/邮箱/编码/URL 等单元格加 `max-w + truncate + title`
（悬停看全文）。实测 5 个列表表格宽度全部收敛到容器 1136px、无横向溢出，行高仍为 48/49 单一值。

## 9. 构建不可复现：`next/font/google` 依赖外网

本轮 Docker build 因 `Failed to fetch Geist from Google Fonts` 直接失败（网络受限时无法构建）。
修复：把 Geist / Geist Mono woff2 放入 `apps/portal/public/fonts/`，改用 `next/font/local`；
重新构建成功，视觉无变化。这样 Docker 构建**完全离线可复现**（符合本仓“Docker 是唯一构建路径”）。

## 10. 规模场景性能数据（1440×900）

| 场景 | 实测 |
|---|---|
| 列表页导航（含渲染） | 0.65–0.70s |
| 权限搜索（含 400ms 防抖） | ≈0.94s |
| 权限配置对话框（345 项） | ≈2.6s |
| 登录 CSV 导出（25,283 行 / 3.2MB） | ≈1.8s |
| 审计筛选后首屏 | 15 行，URL 可分享 |
| 表格区域 | 451–596px（按页面形态），分页固定在首屏 |

## 11. 验证

| 项 | 结果 |
|---|---|
| 规模 UX 验证（`.ui-audit/verify-scale-ux.mjs`） | **17/17**：分页/跳页/越界、服务端搜索、导出全量、筛选、对话框全量、应用分页、树展开/收起/搜索 |
| 全页 hydration（桌面 + 移动） | **0 pageerror** |
| 回归：功能闭环 43 / UI 27 / 分页 5 / 逐控件点击 / 安全 16 / 响应式键盘 30 | 全通过 |
| 组件评分 / a11y | 12 页 × 100；浅色+深色 0 违规 |
| 门禁 | `pnpm test` 全绿、`pnpm test:e2e` 1/1、lint 0 error、typecheck 0 error |

## 12. 变更文件（关键）

- 修复 hydration：`components/ui/sidebar.tsx`（TooltipTrigger render）
- 分页：`components/shared/table-pagination.tsx`（首页/末页/页码窗口/跳页）、`pagination-jump.tsx`（新增）
- 规模容量：`api/audit/export/route.ts`（全量分页+筛选）、`roles/components/RolePermissionsDialog.tsx`（拉全量）、
  `clients/page.tsx` + `ClientsTable.tsx`（服务端分页）、`audit-logs/page.tsx` + `audit-filters.tsx`（新增）
- 树与长文本：`departments/components/DepartmentTree.tsx`（真折叠/展开全部/搜索祖先链）、
  `UserTable` / `RolesTable` / `PermissionsTable` / `ClientsTable`（truncate+title）、`app-sidebar.tsx`（菜单标题截断）
- 构建：`app/layout.tsx`（next/font/local）、`public/fonts/*.woff2`（新增）
- 规范：`DESIGN.md` v2.9

## 13. 保留判断 / 下一步建议

- **批量操作**（批量禁用/删除）与**列排序**在 200+ 数据下是自然的下一步，但涉及新的写路径与权限语义，本轮未做。
- 审计日志暂无**关键字搜索**（后端查询不支持），规模下依赖事件/操作筛选；需要时先补后端。
- 页大小固定 15：对 25k 审计可考虑 30/50 + 用户可选（需把 pageSize 纳入 URL 与所有数据层）。
- 表格未虚拟化：当前每页 ≤15 行，滚动流畅；若未来改成"一页 200+"再评估虚拟滚动。

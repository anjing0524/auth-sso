# 组件级 UI 审计 + 功能完整性补全（真实 Docker 栈 · 2026-10-20）

> 触发：用户要求"作为一个高级测试人员，从真实 UI 出发，每个组件渲染评分，尤其输入/弹窗这类小组件要**跟着背景一起评分**（大小/布局/统一/美观/易操作）；再从功能出发排查完整性、业务逻辑与 UI 的统一；每个问题自己判断并修复"。
>
> 方法：Docker 部署栈（`https://127.0.0.1:19443`，与 CI/生产同形态）+ Playwright 真实登录。组件采集脚本 `.ui-audit/component-audit.mjs`（12 页 / 355 个组件实例 / 8 个弹窗 / 6 个下拉菜单 / 浅色+深色），评分脚本 `.ui-audit/component-score.mjs`（尺寸/布局/一致性/美观/操作 5 维 × 100 分），无障碍脚本 `.ui-audit/a11y-audit.mjs`（对比度/焦点/标题/目标/标签等 6 维 × 2 主题）。

## 1. 结论

- 组件级评分：**12 页全部 100/100**（5 维全满）；8 个弹窗统一 448×*、16px 圆角、ESC 可关；a11y 浅色+深色 **0 违规**；console 0 错误。
- 功能完整性：发现并补齐 **5 个"后端有、UI 没有"的能力**，修掉 **2 个数据完整性/审计完整性缺陷**（详见 §3、§4）。
- 所有修复都在真实 Docker 栈上回归（§5）。

## 2. 组件级问题：从"各页各写一份"到"单一口径"

评分脚本按 DESIGN 口径逐实例测量，暴露出的问题全部属于**同一类根因**：基类没定义清楚，页面各自覆写。

| 组件 | 修复前实测 | 根因 | 修复 |
|---|---|---|---|
| 输入/下拉 | input 圆角 12px、背景透明；select 圆角 12px、背景白、focus 用 `ring-2 + offset`；textarea 第三种写法 | 三个基础组件各自为政 | 统一为 40px / 8px 圆角 / 透明底 / `focus-visible: ring-3 ring-ring/50` / 同 invalid 态 |
| 按钮 | 默认 36px（工具栏与 40px 输入框不齐）；lg 40px；圆角 8/12/14 混用 | 尺寸表与 DESIGN 不一致 | `sm=32 / default=40 / lg=48 / icon=40 / icon-sm=32`；控件统一 8px 圆角 |
| 弹窗 | 宽度 **384 / 420 / 448 / 500** 四种；圆角 **14 / 18** 两种；内边距 16 | 页面各自 `sm:max-w-[500px]`、`rounded-2xl` 覆写 | 基类固定 448px / 16px / 24px 内边距 / 统一 footer；**删除所有页面级覆写** |
| 表格 | 单元格内边距 **p-2 / py-4 / py-5 / pl-6 / pl-8** 五种；表头两种字号；行高 37–85px | 每个列表页手写单元格 | 基类：表头 44px/10px 大写、单元格 `px-4 py-4`；删除页面级覆写；客户端 URI 列截断为单行 |
| 徽章 | `rounded-md` 8px 100 个 / `rounded-full` 2 个；10px/11px 混用 | 基类与页面覆写叠加 | 基类 `rounded-full / 11px / font-medium`；删除 `text-[10px]` 覆写 |
| Tab | 三种形态：下划线（客户端详情/审计）、h-9、h-11 | 不同页各写一套 | 基类 `h-10 p-1` + trigger `h-8`；服务端页签用同款 Link 样式 |
| 下拉菜单 | 面板 8/12px 圆角、条目高 28–36、分组标题 9/10px | 页面覆写 | 基类统一 12px 面板 / 36px 条目 / 10px 分组标题 |
| 卡片 | 圆角 12/14/18px 三种；内边距 16/24 混用 | 基类 padding 16 + 页面覆写 | token 对齐：卡片 12px、内边距 24 |
| 文案 | 角色/权限直接渲染 `ACTIVE`；用户表"正常"、应用表 `ACTIVE`、个人中心 `Active`；`登录账号 (Username)`/`正常 (Active)` 双语；登录页写 "OpenID Connect 2.1" | 各页自写三元表达式 | 新增 `lib/status-label`（`accountStatus/enableStatus`）；统一中文，技术专名保留英文；登录页改为 `OAuth 2.1 · OpenID Connect 1.0` |
| 颜色 | `text-blue-500`/`bg-slate-50`/`text-orange-500`/`text-red-500` 等硬编码 | 绕过 token 与暗色模式 | 替换为 `text-primary/bg-muted/text-warning/text-destructive` |
| 时间 | 工作台用 `Date.getHours()`（容器 UTC → 显示 06:32，实际 14:32） | 服务端时区 ≠ 用户时区 | `lib/format-date` 新增 `formatTime`（固定 `Asia/Shanghai`） |
| 面包屑 | 角色 → "角色权限"，部门 → "组织架构"，与页面标题（角色管理/部门管理）不一致 | 静态映射表过期 | 统一为 角色管理 / 部门管理；DB 菜单 "客户端管理" → "应用管理"（seed + 现状数据） |

**防回归**：`DESIGN.md` 新增「实现约定（2026-10-20 组件统一后）」——圆角 token 映射、控件/弹窗/表格/徽章/Tab/菜单尺寸表、`status-label`/`format-date`/禁硬编码色 三条展示口径；评分脚本可随时重跑。

## 3. 功能完整性：发现 5 个"后端有、UI 没有"（按 P1 优先补齐）

| # | 需求 | 修复前事实 | 修复 |
|---|---|---|---|
| 1 | **FR-ROL-05 / C-ROL-PA 角色权限授予** | 后端只有 `GET /api/roles/:id/permissions`；`ROLE_PERMISSION_ASSIGN` 在 contracts 里是"预留审计码"，注释写明"该能力尚未构建"——**没有写路径、没有 UI** | 新增 `lib/role-permission-assignment.ts`（唯一写路径：范围守卫 + 系统角色守卫 + 权限有效性 + 事务内删旧插新 + 详细审计 + 撤销绑定用户 AT/刷缓存）；`updateRolePermissionsAction`；REST POST/PUT（此前注释声称存在、实际只有 GET）；角色页菜单「配置权限」对话框（按类型分组勾选/搜索/全选/计数）；contracts 预留清单改为空 |
| 2 | **FR-USR-09 / B-USR-PW 重置用户密码** | `resetPasswordAction` 早已实现（策略/历史密码/会话失效），**UI 无入口** | 用户详情页新增「重置密码」对话框（权限守卫 + 字段级错误 + 新密码真实登录验证） |
| 3 | **FR-DEP-05 / F-DEP-M 部门成员** | `GET /api/departments/:id/members` 与读模型存在，无入口 | 部门行菜单「查看成员」对话框（姓名/邮箱/状态，空态） |
| 4 | **FR-LOG-02 / J-LOG-001 审计详情** | 列表只有摘要，`params` 无展示入口 | 登录/操作日志每行「查看详情」对话框（时间/用户/类型/IP/状态/请求地址/**变更参数 JSON**） |
| 5 | **FR-MNU-02/03/04/05 菜单管理** | 权限领域层本就支持 DIRECTORY/PAGE 的 `path/icon/visible/parentId/sort`，但新建/编辑对话框只采集 name/code/type——菜单只能靠 seed | 权限页对话框按类型展开菜单字段（父级菜单/路由路径/图标/排序/侧边显示）；列表内联展示路径与父级；页面传入父级候选；删除目录/页面提示并**级联删除子菜单**（FK cascade 实测） |

> 判断说明：菜单管理没有另开页面，而是**扩展「权限管理」**——因为 v2 起菜单已合并进 permissions 表（`lib/menu-tree.ts` 注释："数据源从 menus 表迁移至 permissions 表（统一权限树）"），另开页面会制造第二套菜单模型。

## 4. 两个数据完整性/审计完整性缺陷（最值得记）

1. **`GET /api/users/:id/roles` 是 `restSuccess(array)` 裸数组，但分配角色对话框只读 `data` 字段** ⇒ 打开对话框时已有角色**全部显示为未勾选**，直接保存会**清空用户原有角色**（数据丢失级）。修复：兼容裸数组 + 新增 UI 回归测试 `__tests__/components/assign-role-dialog.test.tsx`（断言已有角色默认勾选）。
2. **控制面审计静默失败**：`recordActionAudit` 把 `method` 取成 Next.js 的 `next-action` 头（40 字符 Server Action 哈希），而 `audit_logs.method` 是 `varchar(10)` ⇒ **所有 Server Action 的通用审计插入全部失败**（档②设计为"永不抛出"，只记日志，所以业务成功、审计缺失，长期无人发现）。实测容器日志连续报 `Failed query: insert into "audit_logs" ...`，DB 里没有 PERMISSION_CREATE 等记录。
   修复：`method` 语义回归 HTTP 方法（Server Action = `POST`）；更新单测为"40 字符 next-action 哈希不得写入 method"的回归断言；实测创建/删除权限后 DB 出现 `PERMISSION_CREATE/POST/200` 记录。

顺带修掉：**审计日志页在"日志超过 20 条"时整页 error boundary**（`TablePagination` 在服务端渲染时把 `onClick` 传给 DOM，React 报 "Event handlers cannot be passed to Client Component props"，随后页面显示"审计日志加载失败"）。修复：服务端用法不再生成 handler（仅 Link/disabled），并实测 21 条日志页正常渲染、分页可用。

## 5. 验证（真实 Docker 栈）

```bash
pnpm stack:build && pnpm stack:up          # 镜像内 next build（Turbopack）成功，栈全 healthy
node .ui-audit/component-audit.mjs         # 12 页 / 355 组件 / 8 弹窗 / console 0 错误
node .ui-audit/component-score.mjs         # 12 页 × 5 维 全部 100
node .ui-audit/a11y-audit.mjs              # 浅色：对比度/焦点/目标/标签… 全 0
A11Y_DARK=1 node .ui-audit/a11y-audit.mjs  # 深色：全 0
node .ui-audit/functional-new-features.mjs # 7/7：角色授权持久化、新密码真实登录、部门成员、审计详情、清理
pnpm test                                  # 全量 vitest（含新增 API/UI 回归）
pnpm test:e2e                              # Docker 发布闭环（登录→OAuth→会话→登出）
```

关键实测记录：
- 弹窗统一后：`新建用户/新建角色/新建权限/添加子部门/分配角色/重置密码/编辑资料/修改密码` 全部 `w=448 r=16px`，ESC 可关、footer 右对齐。
- 角色授权：临时角色勾选 `portal:user:list` → 保存 → `/api/roles/:id/permissions` 读回包含该项 → DB `audit_logs` 出现 `ROLE_PERMISSION_ASSIGN`（含 params）→ 删除角色清理。
- 重置密码：临时用户重置 → `POST /api/auth/login` 用新密码 **200** → 删除用户清理。
- 菜单：新建"目录 + 页面（父级=目录）"→ 侧边栏出现 → 删除目录 → 子页面随之消失（DB 级联）。
- 审计写入：创建/删除权限后 DB 出现 `PERMISSION_CREATE|POST|/permissions|200`、`PERMISSION_DELETE|POST|/permissions|200`。
- 审计页分页：21 条日志正常渲染（修复前 error boundary）。

## 6. 未做/保留判断（诚实清单）

- **FR-MNU-01 菜单树形视图**：目前权限页是"按类型筛选的列表 + 父级内联展示"，不是可视化树。判断：菜单树与权限列表是同一数据的两种视图，做树会增加一个维护面；先保证"层级/父级/路径"可读可编辑，树形视图留待有明确交互需求时再做。
- **强制下线 UI（`POST /api/users/:id/force-logout`）**：API 已实现，但"重置密码/禁用账号"已覆盖主要场景（都会踢会话），没有为它单独造按钮；如需要可后续在同一菜单加入。
- **登录日志 UA 展示**：`login_logs` 表未存 UA（只有 access_logs 有），详情如实只展示已有字段，未伪造。
- **E2E 断言范围**：`pnpm test:e2e` 仍只覆盖发布闭环（CI 同路径）；本轮新增的组件/功能验证是本地审计脚本（`.ui-audit/`，gitignored），不进入 CI 门禁——避免把"需要浏览器/长跑"的审计塞进每次 CI。

## 7. 变更文件（关键）

- 基础组件：`globals.css`（radius token）、`ui/{button,input,select,textarea,badge,dialog,table,tabs,dropdown-menu,card}.tsx`
- 共享：`shared/table-pagination.tsx`（新增）、`lib/status-label.ts`（新增）、`lib/format-date.ts`（`formatTime`）
- 功能：`lib/role-permission-assignment.ts`（新增）、`roles/actions.ts`、`api/roles/[id]/permissions/route.ts`、`roles/components/RolePermissionsDialog.tsx`（新增）、`users/[id]/ResetPasswordDialog.tsx`（新增）、`departments/components/DepartmentMembersDialog.tsx`（新增）、`audit-logs/components/audit-log-detail-dialog.tsx`（新增）、`permissions/components/PermissionsTable.tsx` + `permissions/page.tsx`（菜单字段）
- 修复：`users/components/AssignRoleDialog.tsx`（裸数组）、`lib/audit.ts`（method）、`shared/table-pagination.tsx`（服务端 handler）、`dashboard/page.tsx`（动作中文化/时区）、`packages/contracts/src/index.ts`（预留审计码清空）
- 测试：`__tests__/api/role-api.test.ts`（+4 用例）、`__tests__/components/assign-role-dialog.test.tsx`（新增）、`src/lib/format-date.test.ts`（+formatTime）、`__tests__/api/audit-durability.test.ts`（method 回归）
- 文档：`DESIGN.md`（实现约定）、`docs/roadmap.md`（续七十七）、本文件

# 功能闭环验收 + 列表页工具条/分页统一（2026-10-20 第三轮）

> 触发（用户原话）："分页出现在滚动之后；表格的搜索、表格本部、表格上面的按钮，搜索旁边的按钮都没有统一；而且功能是不是都没测试到闭环啊，有些功能直接就报错了——你有能力也有责任把业务逻辑梳理清楚，把功能实现完整，把 UI 优化完成。"
>
> 结论：三个批评都成立。本轮**先补功能闭环测试**（43 项，抓出 2 个真实缺陷），再统一工具条与分页可见性，最后把"闭环"作为可重跑的证据固化。

## 1. 功能闭环：43 项真浏览器验收（`.ui-audit/verify-full-functional.mjs`）

覆盖范围（全部在 Docker 栈上真实点击，事务式创建临时数据并清理）：

| 页面 | 闭环项 |
|---|---|
| 登录 | 错误密码报错 → 正确密码进入工作台 |
| 用户 | 重复邮箱就地报错 → 创建 → 分配角色弹窗 → 禁用/恢复 → 搜索 → 详情 → 重置密码（两次不一致拦截 + 成功）→ **新密码真实登录 HTTP 200** → 删除 |
| 角色 | 重复编码就地报错 → 创建 → 配置权限（勾选→保存→接口读回）→ 删除；系统内置角色无无效操作 |
| 权限 | 新建接口权限 → 分页存在 → PAGE 不填路径被拦截 → 编辑 → 删除 |
| 应用 | 非法回调地址被拦截 → 注册成功回列表 → 行内进详情 → 保存 → 轮换 Secret（只显示一次）→ 禁用 → 回列表注销（设计系统弹窗）|
| 部门 | 新建子部门 → 查看成员（真实成员）→ 编辑 → 删除 |
| 审计 | 登录/操作 Tab → 详情（含变更参数）→ 导出登录/操作 CSV（HTTP 200）|
| 个人中心 | 编辑资料保存 → 错误当前密码被拒绝 → 会话记录为真实数据 |

**结果：43/43 通过**，页面/网络错误仅剩"错误密码登录"用例产生的预期 400 与表单提示。

## 2. 闭环测试抓出的两个真实缺陷（"有些功能直接就报错了"）

### 2.1 React 19 `<form action>` 会自动 reset —— 校验失败后表单被清空

- 现象：新建用户时先填一个已存在邮箱 → 提交 → 就地报错；把邮箱改掉再点"创建" → **没有任何请求、没有提示、弹窗不动**（用户视角就是"功能坏了"）。
- 定位：探针显示第二次点击 **无网络请求**；`form.checkValidity()` 为 false，四个必填框 value 全为空——React 19 对 `<form action={fn}>` 的提交结束会 `reset()` 非受控表单，所以第一次失败把用户输入全清空了，第二次提交被 HTML5 `required` 静默拦住。
- 修复：`CreateUserDialog` 四个字段改**受控**（value + onChange），成功后清空；失败保留输入。
- 沉淀规则（DESIGN / solution）：**凡 `<form action={serverAction}>` 的表单，字段必须受控**；校验失败不得丢失用户输入。

### 2.2 应用注销用原生 `confirm()` —— 自动化/内嵌浏览器里"点了没反应"

- 现象：应用列表行内「注销」依赖 `window.confirm()`，Playwright 默认 dismiss ⇒ 删除不执行；真实的内嵌 WebView / 部分 PWA 也会拦截原生 confirm。
- 且这是全站最后一个原生 `confirm()`（其它页面早已是设计系统 Dialog），违反"二次确认必须用 Dialog"的既有规范。
- 修复：改为设计系统 Dialog（标题带应用名、危险说明、取消/确认注销按钮）。

## 3. 分页出现在滚动之后 → 表格内部滚动 + 吸顶表头 + 分页首屏可见

问题实测：权限管理 15 行时页面 1185px、审计日志 20 行时 1420px，分页在 900px 视口之外，要先滚页才看到。

修复：
- `DataTable` 的表格区改为**内部滚动容器**（`max-h` 按页面形态计算：无页签列表 `calc(100vh-21rem)`，权限页 `calc(100vh-30rem)`，审计页 `calc(100vh-25rem)`），表头 `sticky top-0 z-10`；
- 分页条保留在卡片内、始终在首屏内；页面本身不再滚动；
- 实测（`verify-pagination.mjs`，1440×900）：

| 页面 | 页面高度 | 分页底边 | 表头 | 内部可滚 |
|---|---|---|---|---|
| 用户管理 | 900 | 486 | sticky | 否（数据少）|
| 角色管理 | 900 | 531 | sticky | 否 |
| 权限管理 | 900 | 869 | sticky | 是（15 行/页）|
| 审计日志 | 900 | 868 | sticky | 是（15 行/页）|
| 应用管理 | 900 | 461 | sticky | 否 |

## 4. 搜索/筛选/按钮不统一 → 唯一工具条组件

修前各页自写工具条（实测差异）：

| 页面 | 搜索框 | 筛选器 | padding | 其它 |
|---|---|---|---|---|
| 用户 | 本页自绘 w-96、`bg-card`、自绘清空按钮 | 自绘 Select `w-[150px]` 右对齐 | 与按钮分两层 flex | 新建按钮单独一行右侧 |
| 角色 | `SearchInput` w-72 | — | py-4 | 新建按钮在搜索右侧 |
| 权限 | `SearchInput` w-64 | Tab 挤在同一行 | py-4 | 新建按钮紧贴搜索 |
| 应用 | `SearchInput` w-96 | 统计文案 + 新建 | py-4 | 统计与按钮同组 |
| 部门 | `SearchInput` w-72 | — | py-4 | 空树才显示"新建根部门" |

修复：
- 新增 `shared/table-toolbar.tsx`（左槽：搜索 + 筛选；右槽：统计 + 主操作；`px-6 py-3`、槽内 gap-3）；
- `SearchInput` 统一为 `md:w-80` + 内置清空按钮（`aria-label="清空搜索"`）；`SelectTrigger` 统一 `w-40`；
- 权限页 Tab 从工具条移出，独立成行（与审计日志页签同形态）；
- 实测（组件审计）：5 个列表页工具条内所有控件高度**全部 40px**；组件评分新增"工具条控件统一性"维度后 12 页 100 分。

## 5. 业务逻辑闭环矩阵（"能力/责任"的交代）

| 领域 | 读 | 写 | 状态机 | 二次确认 | 审计 |
|---|---|---|---|---|---|
| 用户 | 列表/搜索/筛选/详情 ✅ | 创建/编辑/删除/重置密码/分配角色 ✅ | 禁用↔恢复 ✅ | 删除/重置 ✅ | USER_* 已入库 ✅ |
| 角色 | 列表/搜索 ✅ | 创建/编辑/删除/配置权限 ✅ | 系统内置只读（UI 不再给无效按钮）✅ | 删除 ✅ | ROLE_*/ROLE_PERMISSION_ASSIGN ✅ |
| 权限 | 列表/分页/类型筛选/菜单字段 ✅ | 创建/编辑/删除（目录级联提示）✅ | 启用/禁用 ✅ | 删除 ✅ | PERMISSION_* ✅ |
| 应用 | 列表/搜索/详情/Token 列表 ✅ | 注册/编辑/轮换 Secret/撤销 Token/注销 ✅ | 启用↔禁用 ✅ | 轮换/撤销/状态/注销均 Dialog ✅ | CLIENT_* ✅ |
| 部门 | 树/搜索/成员 ✅ | 新建子部门/编辑/删除 ✅ | 根部门单例（非空树不给新建根）✅ | 删除 ✅ | DEPARTMENT_* ✅ |
| 审计 | 登录/操作 Tab/分页/详情/CSV 导出 ✅ | 只读 ✅ | — | — | — |
| 个人中心 | 资料/权限矩阵/会话（JWT claims + refresh_tokens）✅ | 编辑资料/改密码 ✅ | 密码错误路径 ✅ | 改密 ✅ | PASSWORD_CHANGE ✅ |

## 6. 验证汇总

- 功能闭环：43/43；第三轮 UI 验收（`.ui-audit/verify-round3.mjs`）：27/27；分页首屏：5/5。
- 组件评分：12 页 100（含工具条统一、分页首屏、行高、行内操作、页面长度维度）；a11y 浅+深 0 违规。
- `pnpm test`：116 文件 / 940 用例全绿；`pnpm test:e2e`：Docker 发布闭环 1/1；lint 0 error；typecheck 0 error。

## 7. 未做/保留判断

- 审计页没有搜索框：后端审计查询未提供关键字参数，本轮不"造一个假搜索"；需要时先补 API 再补 UI。
- 应用寄存器跳回列表（而非详情）保持现状：列表能立即看到新应用并继续操作，属产品选择，已按该行为写闭环断言。
- 表格内部滚动高度用 `calc(100vh - Xrem)` 按页面形态估算（900px 视口实测全部不滚页）；更小高度（如 768px）下仍可能轻微滚动，属可接受折中。

## 8. 变更文件

- 新增：`components/shared/table-toolbar.tsx`；`.ui-audit/verify-full-functional.mjs`、`verify-pagination.mjs`（本地证据，gitignored）
- 工具条：`users/page.tsx`、`users/components/UserFilters.tsx`、`roles/components/RolesTable.tsx`、`permissions/components/PermissionsTable.tsx`、`clients/components/ClientsTable.tsx`、`departments/components/DepartmentTree.tsx`、`components/shared/search-input.tsx`
- 分页/滚动：`components/shared/data-table.tsx`、`audit-logs/page.tsx`
- 缺陷修复：`users/components/CreateUserDialog.tsx`（受控字段）、`clients/components/ClientsTable.tsx`（注销 Dialog）
- 回归测试：`__tests__/components/create-user-dialog.test.tsx`（失败后输入保留 + 可再次提交，钉住 React 19 form reset 缺陷）
- 规范：`DESIGN.md` v2.5（工具条、分页首屏、原生 confirm 禁令、受控表单规则）

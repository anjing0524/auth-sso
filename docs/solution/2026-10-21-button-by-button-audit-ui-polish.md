# 逐按钮实机审计 + UI 打磨（2026-10-21）

> 触发（用户）：“功能还有报错，你需要按照功能点打开每一个页面，操作每一个按钮，并优化 UI 效果。”
>
> 方法：写两个**逐控件**审计脚本（非抽样）：
> - `.ui-audit/audit-click-all.mjs`：9 个页面 + 登录页 + 404，去重后**点击 159 个可见控件**（按钮/链接/页签/下拉），逐个捕获 pageerror / console error / HTTP 5xx / 错误 toast；覆盖侧边栏全部导航、命令面板、分页、全部页签、状态筛选全部选项；
> - `.ui-audit/audit-click-destructive.mjs` + 详情页探针：用**临时数据**点击所有破坏性按钮（禁用/恢复、删除、注销、轮换 Secret、撤销 Token、分配角色、重置密码……），走完二次确认弹窗。
>
> 结果：修复 8 个真实问题（1 个会导致**全站无法登录**的高危问题），审计从“发现 1 个 pageerror + 4 个缺失/异常”变为**159 次点击 0 异常**。

## 1. 高危：Portal 自身客户端可被轮换 Secret / 禁用 / 注销 → 全站登录中断

**实测复现**：在“应用管理 → Auth-SSO Portal”点「重新生成 Secret」并确认后，Gateway 日志立刻出现
`Token 交换失败: invalid_client: 客户端密钥不匹配`；此后登录页进入 PKCE 回跳循环，
**所有用户（含管理员）都无法登录**，只能改库/重新 seed 才能恢复。

原因：`portal` 这个 OAuth client 就是 Portal 登录链路自己的凭据。管理面此前对它提供
「保存修改 / 重新生成 Secret / 禁用 / 注销」，等于给了用户一个“一键锁死系统”的按钮。

修复（纵深防御）：
- 领域守卫 `guardPortalSelfClient(clientId, action)`：`PORTAL_CLIENT_ID` 的**修改/注销/轮换**一律抛业务错误（服务端拦得住）；
- 详情页整页**只读**：输入框/保存/禁用/轮换全部 disabled，顶部警示条说明“修改会中断全站登录，请通过部署配置调整”；
- 应用列表对 `portal` 的「注销」按钮 disabled + title 说明。

## 2. 复制 Client ID：fire-and-forget → pageerror + 假成功

点击「复制 Client ID」，在剪贴板权限被拒的环境（无头浏览器 / iframe / 非安全上下文）抛
`Failed to execute 'writeText' on 'Clipboard': Write permission denied` **未处理 pageerror**，
且 UI 无条件显示“已复制”对勾——用户以为复制成功，实际没有。

修复：`await navigator.clipboard.writeText` + 失败回退 `execCommand`；两者都失败才 `toast.error('复制失败，请手动选择…')`，
只有真正成功才显示已复制状态。详情页复制同理（回退也检查 `execCommand` 返回值）。

## 3. 审计“操作人”列全是 “-”

操作日志写入时只写 `user_id`（`username` 快照为空），列表直接渲染 `log.username` ⇒ 全列 “-”，
无法回答“谁操作的”。修复：`getAuditLogs` 读时 `leftJoin users` 补登录账号（历史数据也受益）；
实测列表从 `-,-,-` 变为 `admin,admin,admin`。

## 4. 个人中心 Tab 不可寻址：`?tab=security` 打不开会话记录

Tab 是纯本地 `useState`：刷新/深链/浏览器后退都会丢；且截图证据显示 `?tab=security` 仍停在“权限矩阵”。
修复：Tab 与 URL 双向同步（`?tab=security`，默认页删参数），深链/刷新/后退均正确；自动化已验证。

## 5. 用户详情：同一能力两个入口 + 保存文案不一致

- 页头「分配角色」与右侧系统信息卡「管理角色」打开的是**同一个对话框**——交互入口重复；
- 保存按钮叫「保存更改」，应用详情叫「保存修改」，其它页面叫「保存」。
修复：移除重复「管理角色」入口（系统信息改为静态提示“通过右上角分配角色管理”）；保存文案统一为「保存修改」。

## 6. 部门：根部门显示“删除”按钮，但领域禁止删除

根部门是 ADR-002 单例，领域 guard 会拒绝删除；UI 却给出按钮 ⇒ 点击必失败。
修复：仅 `depth > 0` 渲染删除按钮（与“领域禁止的操作不出现在 UI”规则一致）。

## 7. 应用详情：「禁用」实心红主按钮

危险状态切换用 `variant="destructive"` 实心红，视觉权重高于「保存修改」，易误触。
修复：改为 outline + 危险色文字（hover 红底），保存仍是唯一主按钮。

## 8. 注册新应用：右列卡片被拉成等高，留下大片空白

`grid` 默认 stretch ⇒ “高级安全设置”卡片被拉长到与主卡等高、内部空 200px。
修复：`items-start`，卡片按内容收缩。

## 9. 验收

| 审计 | 结果 |
|---|---|
| 逐控件点击（159 个控件） | **0 pageerror / 0 console error / 0 5xx / 0 错误 toast** |
| 破坏性按钮（临时数据） | 禁用↔恢复、删除、注销、轮换 Secret、撤销 Token、分配角色、重置密码全部走通并清理 |
| 功能闭环 43 项 | 43/43 |
| 第三轮 UI 27 项 / 分页首屏 5 项 | 27/27、5/5 |
| 发现轮 6 项 / 安全边界 16 项 / 响应式键盘 30 项 | 全通过 |
| 组件评分 / a11y | 12 页 × 100；浅色+深色 0 违规 |
| 门禁 | `pnpm test` 全绿、`pnpm test:e2e` 1/1、lint 0 error、typecheck 0 error |

## 10. 变更文件

- 高危修复：`domain/client/client.ts`（`guardPortalSelfClient`）、`clients/actions.ts`（三条写路径守卫）、
  `clients/[id]/ClientDetailClient.tsx`、`clients/[id]/components/ClientInfoSection.tsx`（只读态+警示）、
  `clients/components/ClientsTable.tsx`（列表注销禁用）
- 复制：`clients/components/ClientsTable.tsx`、`clients/[id]/ClientDetailClient.tsx`
- 审计操作人：`app/audit/data.ts`
- Tab 可寻址：`profile/ProfileClient.tsx`
- 详情页：`users/[id]/UserDetailForm.tsx`、`departments/components/DepartmentTree.tsx`、`clients/new/page.tsx`
- 测试：`__tests__/domain/client.test.ts`（Portal 客户端守卫）
- 规范：`DESIGN.md` v2.7

## 11. 未做/保留判断

- 移动端表格仍是横向滚动（已有“左右滑动”提示）；彻底列裁剪/卡片化需要逐页信息架构设计，留作后续。
- 审计页无搜索（后端查询无关键字参数，不造假搜索）。
- 组件评分/点击审计是本地脚本（gitignored），不进入 CI 门禁；CI 仍由 Vitest + Docker e2e 守住。
- 本轮发现并修掉的高危“自锁死”只用领域测试钉住（`guardPortalSelfClient`），未加 E2E 轮换 portal client 用例——
  该用例本身有把验收栈锁死的风险，故以“服务端守卫 + UI disabled”两层保证。

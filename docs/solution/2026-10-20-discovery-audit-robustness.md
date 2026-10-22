# 发现轮：响应式/键盘/安全/边界实机审计（修复 5 类真实缺陷，2026-10-20）

> 触发（用户）：“你有能力和责任发现更多问题。”
>
> 方法：不再只测已知路径，而是四组**主动发现型**审计
> （`.ui-audit/audit-responsive-keyboard.mjs` / `audit-security-edge.mjs` / `verify-discovery-fixes.mjs`，
> 均针对 Docker 栈 `https://127.0.0.1:19443` 真浏览器运行）。
> 结果：**发现并修复 5 类真实缺陷**；另有两处“看起来像缺陷”的自动化误判被证伪并记录方法。

## 1. 找到并修复的真实缺陷

| # | 严重度 | 现象 | 根因 | 修复 |
|---|---|---|---|---|
| 1 | P1 | 390px 移动端每个后台页 console 报 **React #418 hydration mismatch** | `useIsMobile` 用 `useState(() => window.innerWidth < 768)`：SSR 为 false、客户端首帧为 true，Sidebar 渲染分支不一致 | 首帧固定 `false`，挂载后 `matchMedia` 校正（SSR/客户端首帧一致） |
| 2 | P1 | 超长输入（如 300 字符角色名）→ toast「服务器内部错误」 | 领域 Schema 只有 `min` 没有 `max`；DB `varchar(100)` 抛 `22001 value too long`，落到通用 500 | 五个实体 Schema 按 DB 列宽补 `.max()`；表单加 `maxLength`；`dataViolation` 把 `22001/22P02/23514` 映射为 422 校验错误（安全网） |
| 3 | P1 | `/users?status=BOGUS` → 服务端 SQL 报 `22P02 invalid input syntax for type enum` | 查询参数未做枚举白名单，直接下沉数据库 | users/permissions 页参数白名单回退 `ALL`；配合 #2 的错误映射 |
| 4 | P1 | `/users/not-a-uuid` → 整页服务端报错（`22P02 invalid input syntax for type uuid`） | 路由参数直接进 Drizzle | 新增 `lib/uuid.ts` + 详情页 `isUuid()` 前置校验 → `notFound()`（404 同形）；**同时记录一个坑**：`clients.id` 是 `client_` 前缀业务 ID，不是 UUID 列，不能套同一规则（本轮改动一度把新建应用全判成不存在，已回退并写进注释） |
| 5 | P2 | 网关 401 **无响应体**（只有 `WWW-Authenticate`），API 调用方无法判别 | `build_401_headers` 只写头；`respond_401_with_cookies` 不写 body | 补 JSON 错误信封 `{"error":"AUTH_SSO_1002","message":"未认证或会话已过期"}` + Content-Type/Length；Rust 单测同步断言 |

附：移动端表格此前**横向滚动但零提示**（首屏只看到前两列）。已加“左右滑动查看完整表格”提示（`md:hidden`），并在 `DESIGN.md` 记录"宽表必须给可发现性提示"。

## 2. 审计中确认“没有问题”的项（防误报，方法也记录）

- **移动端侧边栏**：`Toggle Sidebar` 的可访问名被中文 `aria-label="切换侧边栏"` 覆盖，自动化按英文名找不到 → 非缺陷，修正选择器后开关/展开均正常。
- **弹窗焦点陷阱**：Base UI 的焦点守卫是**异步回跳**；连续快速 Tab 会瞬时看到焦点在守卫上，误判“逃逸”。改为每次 Tab 后等 150ms，实测 12 次循环不逃逸、ESC 关闭、焦点回到触发按钮。
- **未认证深链**：curl 直接请求 `/dashboard` 得 401，但浏览器导航带 `Accept: text/html` 时会走网关 PKCE 302 → 授权链路；用浏览器语义复测确认（不是缺陷）。
- **CSRF**：设计是“有 Origin 且跨站才拦”（服务间无 Origin 放行）。实测跨站 Origin → 403、同源 → 200；按设计语义断言而不是按“缺 Origin 应拦”误报。
- **XSS / CSV 注入**：角色名 `<img onerror>` 按文本转义；登录日志导出中用户可控 UA（`=cmd|...`）未形成公式单元格（导出侧已中和）。
- **分页/过滤/登出**：`page=999999` 夹紧、非法关键词不 500、深链 `?status=DISABLED` 回填、登出后 API 401 + 页面 302 授权链路，均正常。

## 3. 回归与复验

- 主动发现型脚本：响应式+键盘 **30/30**、安全/边界 **16/16**、发现项复验 **6/6**。
- 既有闭环（回归）：功能闭环 **43/43**、第三轮 UI **27/27**、分页首屏 **5/5**；组件评分 12 页 **100**；a11y 浅+深 **0 违规**。
- 行高进一步统一：`TableCell py-1.5 → py-1`，令“单行/两行”内容都收敛到 **48px**（此前角色表 48/49 混排）。
- 门禁：`pnpm test` 全绿、`pnpm test:e2e` 1/1、lint 0 error、typecheck 0 error；Rust `cargo fmt/clippy/test` 全绿。

## 4. 变更文件

- 修复：`apps/portal/src/hooks/use-mobile.ts`、`lib/uuid.ts`（新增）、`lib/db-errors.ts`、`lib/server-error.ts`、`domain/{role,user,permission,department,client}/types.ts`、`app/(dashboard)/users/page.tsx`、`permissions/page.tsx`、`users/[id]/page.tsx`、`clients/[id]/page.tsx`、`components/ui/table.tsx`、`components/shared/data-table.tsx`、`audit-logs/page.tsx`、`gateway/src/http.rs`
- 表单约束：`CreateUserDialog`、`RolesTable`、`PermissionsTable`、`DepartmentTree` 增加 `maxLength`
- 测试：`src/lib/uuid.test.ts`（新增）、`db-errors.test.ts`（dataViolation）、`domain/role.test.ts`（长度上限）、`gateway/src/http.rs`（401 JSON 头）
- 规范：`DESIGN.md` v2.6

## 5. 未做/保留判断（诚实清单）

- **移动端表格仍是横向滚动**（已加提示）：彻底的移动端列裁剪/卡片化需要逐页设计，当前优先保证"不隐藏信息 + 有可发现提示"。
- **网关 401 只有单一错误码**：不区分"未携带凭证 / 已过期 / 续签失败"；细分需要网关与 Portal 的错误码族协同，留作后续。
- **审计页仍无搜索框**：后端审计查询没有关键字参数，不造假搜索（前轮已记录）。
- 长文本输入只做了上限，没有做"剩余字数"提示；属于体验增强项。

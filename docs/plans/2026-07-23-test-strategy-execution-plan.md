# Auth-SSO 全面测试策略与执行计划 (v1.0)

> 日期: 2026-07-23
> 来源: 全栈代码审计 + 测试基础设施分析 + 规范文档对齐
> 当前基线: 35 TS 测试文件 (~290+ it), 2 Rust 测试文件 (11 test fn), 2 集成验收测试, 94.7% 需求追溯覆盖率

---

## 一、测试成熟度评估

### 当前状态

| 维度 | 评级 | 证据 |
|------|------|------|
| 单元测试（领域层） | **A** (9 files, 64 it) | 纯函数 TDD，零 mock，边界覆盖完整 |
| API 集成测试 | **B-** (18 files, ~180 it) | 真实 DB + vi.mock 注入，但 12A 审计显示 6/18 为"弱测试" |
| 组件测试 | **B** (6 files, 41 it) | jsdom + @testing-library，交互覆盖充分 |
| 端到端测试 | **F** (0 files) | Playwright 配置、目录、脚本均不存在 |
| 集成验收测试 | **C** (2 files, ~12 cases) | 纯 Node.js http，无框架，无 CI 集成 |
| Rust 测试 | **B** (2 files, 11 fn) | 核心验签路径覆盖，缺少 AuthDecision/续签分支 |
| 基准测试 | **A** (5 benches) | 覆盖限流/路径分类/JWKS/Cookie 热路径 |
| 需求追溯 | **A-** (94.7%) | 自动化脚本 + 阈值门禁，4 条需求未覆盖 |
| Mock 策略 | **C** | 碎片化 inline mock，1000+ 行重复，缺少抽象层 |
| CI 可靠性 | **B** | PR + Main 双流水线，但 E2E Job 因无测试文件等于空跑 |

### 差距分析

```
层级               当前的      目标         差距
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
E2E (Playwright)   0 test     20+ test    ❌ 完全缺失
集成验收测试        12 cases   30+ cases   ⚠️ 量不足
API 测试真实度      58.8%      90%+        ⚠️ 虚假覆盖
Rust AuthDecision   0 test     8+ test     ❌ 新特性未测
Proxy 测试          0 test     6+ test     ❌ 完全缺失
Redis 故障模式      0 test     5+ test     ❌ 完全缺失
GW 续签 e2e         0 test     4+ test     ❌ 完全缺失
```

---

## 二、需求 → 代码追溯与功能完备性验证

### 2.1 追溯矩阵静态验证

当前自动追溯系统 (`tests/traceability/generate-report.mjs`) 扫描测试文件中的 `@req` 标注。但存在三个盲区：

**盲区 1**: 标注仅证明"有测试文件覆盖该需求"，不验证测试是否真正测试了该需求的正确行为

**盲区 2**: `@req` 只存在于测试文件，不存在于生产代码中，无法验证"每个需求都有对应的生产代码实现"

**盲区 3**: 4 条未覆盖需求需要手动分析是否真的缺失：

```
J-LOG-003: 登录日志不可篡改、不可删除 → lib/audit.ts fire-and-forget + DB 权限收口
J-LOG-004: 审计日志 180 天分区保留  → access_logs 按月分区
A-NAV-02:  登录后可无缝回到之前操作的页面 → return_to Cookie + redirect 参数
A-NAV-03:  刷新页面后不丢失导航状态  → 由 RSC 天然保证
```

### 2.2 修复方案：三层追溯加固

#### Phase 1: 生产代码 `@impl` 标注

在每个 Route Handler / Server Action 的 JSDoc 中添加 `@impl` 标注，链接到实现的需求：

```typescript
// app/api/auth/login/route.ts
/**
 * POST /api/auth/login
 * @impl AUTH-001 — 邮箱/密码登录
 * @impl H-FLOW-001 — 标准登录流程
 * @impl NFR-SEC-06 — 暴力破解防护（Redis INCR 原子计数）
 * @impl J-LOG-003 — 登录日志写入
 */
```

在追溯报告中新增 `@req ↔ @impl` 双向覆盖检查——需求有测试无实现=假阳性。

#### Phase 2: 追溯报告增强（generate-report.mjs v2）

```
新增能力:
  - @impl 标注扫描（生产代码）
  - 双向匹配: @impl 覆盖 / @req 覆盖 / 两者均无
  - 模块级覆盖率（按 auth/user/role/permission/dept/client/audit 分组）
  - 变化趋势: 上次报告 ↔ 本次报告增量/减量
  - 阈值分层: requirements 90% / arch constraints 70%
```

#### Phase 3: 覆盖 4 条未覆盖需求

| 需求 | 实现文件 | 测试文件 | 操作 |
|------|----------|----------|------|
| J-LOG-003 | `lib/audit.ts` + DB 权限脚本 | `__tests__/api/audit/*` | `@req J-LOG-003` 标注 |
| J-LOG-004 | `scripts/maintain-access-log-partitions.ts` | 集成测试 | 新增验证分区策略的测试 |
| A-NAV-02 | `lib/session/cookies.ts` + `login-form.tsx` | E2E 测试 | 新增 Playwright 测试 |
| A-NAV-03 | RSC 架构特性 | E2E 测试 | 新增 Playwright 测试 |

---

## 三、分层测试设计

### 3.1 T1 — 领域层纯函数测试（已覆盖，加固）

**当前**: 9 文件 / 64 it — 评级 A
**加固项**:

| 领域 | 新增测试 | 原因 |
|------|----------|------|
| `domain/auth/password.ts` | NFR-SEC-15 密码历史上限截断 | 边界条件：空的 prevHistory、超上限 |
| `domain/permission/permission.ts` | 树操作：循环引用检测、移动节点 | 当前仅测创建/更新 |
| `domain/shared/tree-utils.ts` | 空输入、单节点、多层级树构建/搜索 | 泛型树工具，跨 BC 使用 |
| `domain/client/types.ts` | redirect_uris Zod 正则拒绝 | 注入攻击模式（`javascript:`、`data:`） |

### 3.2 T2 — API 集成测试（重点加固）

**当前**: 18 文件 / ~180 it — 评级 B-

**核心问题**（来自 2026-07-14 深度审计）：

```
API 测试真实度评级 (12A):
  ✅ 有效(10): session-lifecycle, brute-force, auth-login, permission-enforcement,
               data-scope, role-api, department-api, client-api, auth-logout, me-endpoints
  ⚠️ 弱(6):   user-api, user-actions, user-role-api, role-actions, 
              permission-api, permission-actions
  ❌ 无效(1):  client-actions (模拟的 DB 写入未验证实际持久化)
```

**修复方案**:

#### Phase 2.1: Mock 基础设施统一化

```typescript
// __tests__/helpers/mock-factory.ts — 新增统一 Mock 工厂

import { vi } from 'vitest';

type MockConfig = {
  db?: boolean;        // 默认 true
  redis?: boolean;     // 默认 false
  auth?: 'pass' | 'fail' | { userId: string; permissions: string[] };
  audit?: boolean;     // 默认 false (fire-and-forget 可不 mock)
};

/**
 * 统一 Mock 工厂 —— 消除 18 个 API 测试中 ~1000 行重复 inline mock。
 * 
 * 所有 API 测试文件统一调用此工厂，而非各自 vi.mock。
 * 新增模块只需声明依赖哪些基础设施，工厂自动装配。
 */
export function setupTestEnvironment(config: MockConfig) {
  const td = createTestDbHandle();
  
  if (config.db) {
    vi.mock('@/infrastructure/db', () => ({
      get db() { return td.db; },
      get schema() { return td.schema; },
    }));
  }
  
  if (config.redis) {
    const store = new MockRedisStore();
    vi.mock('@/infrastructure/redis', () => ({
      getRedis: () => createMockRedis(store),
    }));
  }
  
  if (config.auth) {
    vi.mock('@/lib/auth', () => {
      const mockAuth = createMockAuth(config.auth);
      return { ...mockAuth };
    });
  }
  
  return {
    td,
    cleanup: td.cleanup,
    seed: (data: SeedData) => seedTestData(td.db, data),
  };
}
```

#### Phase 2.2: 写入路径验证加固

对 6 个弱测试文件，追加写入验证断言：

```typescript
// 当前（弱）：只验证函数返回正确
const result = await createUserAction(formData);
expect(result.success).toBe(true);

// 加固后：验证 DB 实际持久化
const result = await createUserAction(formData);
expect(result.success).toBe(true);
const saved = await db.select().from(schema.users).where(eq(schema.users.id, expectedId));
expect(saved.length).toBe(1);
expect(saved[0].username).toBe('testuser');
```

#### Phase 2.3: 事务回滚模式（替代 TRUNCATE CASCADE）

当前 `test-db.ts` 使用 TRUNCATE CASCADE 隔离。该模式在每个测试间清空全部表，导致：
- 测试串行执行（`fileParallelism: false`）
- 清空耗时随表数据增长而增加
- 无法并行

**优化方案**: 每测试文件包裹在 SAVEPOINT/ROLLBACK 事务中：

```typescript
// vitest.globalSetup.ts — 新增
beforeAll(async () => {
  await td.sql`BEGIN`;
});

afterAll(async () => {
  await td.sql`ROLLBACK`;  // 文件级事务回滚，无需 TRUNCATE
});
```

### 3.3 T3 — 组件测试（jsdom）

**当前**: 6 文件 / 41 it — 评级 B

**加固方向**:

| 组件 | 新增测试 | 优先级 |
|------|----------|--------|
| `DashboardLayout.tsx` | 侧边栏折叠/展开、响应式断点 | P1 |
| `UserTable.tsx` | useOptimistic 乐观更新失败回退 | P1 |
| `CreateUserDialog.tsx` | 表单校验反馈、提交中禁用 | P1 |
| `PermissionGuard.tsx` | 嵌套权限组合（all/some） | P2 |
| `login-form.tsx` | 错误展示、session_id 恢复 | P1 |

### 3.4 T4 — 端到端测试（Playwright）— 新建

**当前**: 0 文件 — 评级 F

这是系统最大测试缺口。需要从零搭建 Playwright 测试套件：

#### 基础设施

```bash
# playwright.config.ts（根目录）
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30000,
  retries: 1,
  use: {
    baseURL: 'https://localhost:19443',  // 经 Gateway
    ignoreHTTPSErrors: true,
    storageState: undefined,  // 不共享 auth state
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
  ],
});
```

#### 测试场景（20+ test）

```
Cycle 1: 未认证流程 (4 tests)
  ├── T4-01: Gateway PKCE 302 跳转到 /login
  ├── T4-02: 直接访问 /login 展示登录表单
  ├── T4-03: 提交无效凭据显示错误 + 不跳转
  └── T4-04: 连续 5 次失败后账户锁定

Cycle 2: 认证全流程 (6 tests)
  ├── T4-05: 有效凭据登录成功 → /login → Set-Cookie portal_jwt_token
  ├── T4-06: 登录后访问受保护页面 → 内容正常加载
  ├── T4-07: OAuth SSO 流程 → 登录 → authorize 自动签发 code → callback → Dashboard
  ├── T4-08: SSO 免登 → 已有 JWT → 访问 authorize 跳过登录
  ├── T4-09: return_to 保留 → 从 /dashboard 访问受保护路径 → 登录后回到该路径
  └── T4-10: 登出 → Cookie 清除 → 受保护页面 302 /login

Cycle 3: 用户管理 (4 tests)
  ├── T4-11: 管理员创建用户 → 新用户可登录
  ├── T4-12: 管理员禁用用户 → 该用户无法登录
  ├── T4-13: 管理员删除用户 → 该用户无法登录 + 数据保留
  └── T4-14: 数据范围限制 → 非管理员看不到跨部门用户

Cycle 4: Token 生命周期 (3 tests)
  ├── T4-15: AT 过期后静默续签 → 请求自动恢复（无需用户感知）
  ├── T4-16: RT 过期后无法续签 → 重定向到 /login
  └── T4-17: 安全事件 → 管理员强制下线 → 用户被踢出

Cycle 5: 权限与 RBAC (3 tests)
  ├── T4-18: 无权限用户看不到菜单项
  ├── T4-19: 无权限用户无法通过 URL 直接访问
  └── T4-20: 角色变更后 → 刷新页面 → 权限即时生效
```

### 3.5 T5 — 集成验收测试（扩展）

在受 CI 管控的 `tests/e2e/` Docker 发布验收栈基础上，新增：

```
T5-01: Gateway → Portal 全链路（真实 HTTP，经 localhost:19443）
  ├── 前置: docker compose up -d + pnpm build + Gateway 启动
  ├── 步骤: 浏览器无 Cookie → GET /dashboard → 302 /login → 登录 → 302 /dashboard
  └── 断言: 最终状态 200 + Cookie 存在 + Body 含 Dashboard 内容

T5-02: Gateway 续签链路
  ├── 步骤: 登录获得 AT (exp=3600) → mock 时间前进 3595s → 发起请求
  ├── 断言: 响应中 Set-Cookie 含新 AT/RT → 旧 AT 被覆盖
  
T5-03: Gateway Redis 故障模式
  ├── 步骤: Redis 停止 → 发起受保护请求
  ├── 断言: Gateway fail-open 放行（jti 黑名单不可用不阻断）
  
T5-04: 跨服务 HMAC 签名
  ├── 步骤: Gateway → Portal refresh 端点
  ├── 断言: X-Gateway-Signature 签名验证通过
```

### 3.6 T6 — Rust Gateway 测试（扩展）

**当前**: 11 test fn — 缺 AuthDecision + 续签 + 路径分类

```
T6-01: authenticate::check AuthDecision 三态 (3 tests)
  ├── 有有效 AT → AuthDecision::Pass
  ├── 无 AT + HTML 导航 → AuthDecision::PkceRequired
  └── 无 AT + API 请求 → AuthDecision::Interrupted + 401

T6-02: TokenRefresher (2 tests)
  ├── 有效 RT → 续签成功 → 返回 RefreshedTokens
  └── 过期 RT → 返回 None

T6-03: PathMatcher (3 tests)
  ├── 扩展名白名单不在 /api/ 命名空间生效
  ├── 显式白名单优先于 Microservice 分类
  └── Protected 为默认分类

T6-04: RateLimiter (2 tests)
  ├── 20/min 认证端点 → 第 21 个请求被拒绝
  └── 不同 IP 独立计数
```

### 3.7 T7 — 安全与故障模式测试（新增）

```
T7-01: JWT alg 混淆攻击 (1 test)
  ├── 签发 HS256 JWT（使用公钥作为密钥）→ Gateway 应拒绝
  └── ES256 硬锁: 非 ES256 算法一律拒绝，无论密钥格式

T7-02: jti 黑名单 fail-open (1 test)
  ├── Redis 不可用时
  └── Gateway 应放行（可用性优先）

T7-03: PKCE 验证层次 (3 tests)
  ├── code_challenge 不匹配 → Token 交换被拒绝
  ├── 授权码重复使用 → 第二次被拒绝
  └── 授权码过期 → Token 交换被拒绝

T7-04: 开放重定向防护 (2 tests)
  ├── redirect_uri 不在白名单 → 拒绝
  └── return_to 非安全路径 → 消毒/拒绝

T7-05: CSRF 防护 (2 tests)
  ├── state 参数不匹配 → callback 拒绝
  └── 无 state Cookie → callback 拒绝

T7-06: 暴力破解 (2 tests)
  ├── 5 次失败 → 账户锁定
  └── 锁定后即使正确凭据也被拒绝
  
T7-07: SQL 注入 (1 test)
  └── username/email 含 SQL 注入 payload → Drizzle 参数化查询自动转义
```

---

## 四、UI/UX 完整性验证

### 4.1 视觉回归测试（Playwright Screenshot）

```typescript
// tests/e2e/visual/*.spec.ts
test('Dashboard layout renders correctly', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page).toHaveScreenshot('dashboard-full.png', {
    maxDiffPixels: 100,  // 允许最小像素差异
  });
});
```

关键截图点（12 个）:

| 页面 | 状态 | 关键检查 |
|------|------|----------|
| `/login` | 默认 | 表单布局、输入聚焦、按钮样式 |
| `/login` | 错误 | 错误消息展示位置、颜色 |
| `/dashboard` | 管理员 | 侧边栏全展开、统计卡片、日志表 |
| `/dashboard` | 受限用户 | 菜单项正确隐藏（PermissionGuard） |
| `/users` | 列表 | DataTable 分页、状态 Badge 着色 |
| `/users/[id]` | 编辑 | 表单字段对齐、只读/编辑区分 |
| `/roles` | 权限分配 | 权限树选择器 UI |
| `/clients` | 密钥管理 | Secret 显示/隐藏切换 |
| `/oauth/error` | 错误 | 错误码、返回链接 |
| `/profile` | 个人 | 头像、字段排列 |
| 404 页面 | 默认 | 导航提示 |
| 响应式 | <768px | 侧边栏折叠、表格横滚 |

### 4.2 交互可用性验证

| 检查项 | 方法 | 验收标准 |
|--------|------|----------|
| 表单双击提交 | Playwright `click()` × 2 | 第二个请求被 `useActionState` pending 阻断 |
| 网络断开重连 | DevTools 模拟 offline | 友好错误提示，非空白页/崩溃 |
| Token 过期静默续签 | mock Token exp 为 5s | 页面无闪动，请求自动恢复 |
| 侧边栏导航 | 点击菜单项 | URL 变化 + 内容区域更新（非整页刷新） |
| Cmd+K 命令面板 | 快捷键触发 | 搜索、导航、操作面板正常打开 |
| 分页操作 | 翻页、跳转 | URL query string 同步 |
| 权限即时生效 | 管理员修改权限 → 切换到该用户 | 刷新后菜单变化（无需重登录） |

### 4.3 无障碍基础检查

```
a11y-01: 所有按钮/链接有 aria-label 或可见文本
a11y-02: 表单输入有关联 label
a11y-03: 颜色对比度 ≥ 4.5:1（正常文本）/ ≥ 3:1（大文本）
a11y-04: 焦点可见、焦点顺序合理（Tab 导航）
a11y-05: 错误消息通过 aria-live 宣布
```

---

## 五、系统可靠性验证

### 5.1 故障注入测试

| 场景 | 方法 | 预期行为 |
|------|------|----------|
| PostgreSQL 断开 | `docker stop postgres` | Portal 返回 500，非挂起/泄露信息 |
| PostgreSQL 恢复 | `docker start postgres` | 自动重连，后续请求正常 |
| Redis 断开 | `docker stop redis` | Gateway fail-open（jti 检查跳过），Portal 权限降级 DB |
| Redis 恢复 | `docker start redis` | 缓存重新预热，恢复正常 |
| Gateway 崩溃 | `kill -9 <gateway-pid>` | systemd/docker 自动重启，无缝恢复 |
| Portal 滚动重启 | 逐实例重启 | 另一实例继续服务（需多实例部署） |
| 时钟偏移 | 系统时间前调 2 小时 | JWT exp 判定 <= 5s 容忍窗口，超阈值返回 401 |

### 5.2 性能基准

| 场景 | 工具 | 目标 | 当前基线 |
|------|------|------|----------|
| Gateway JWKS 验签 | `benches/jwks_cache_bench.rs` | 100K QPS/核心 | ✅ 已有基准 |
| Gateway 续签并发 | 自定义 Rust bench | 10K 并发无死锁 | ❌ 未测试 |
| Portal API 吞吐 | k6 | 500 RPS @ p99 < 200ms | ❌ 未测试 |
| DB 查询（分页） | k6 | 100 RPS @ p95 < 50ms | ❌ 未测试 |
| Redis 权限缓存 | k6 | 10K RPS @ p99 < 5ms | ❌ 未测试 |

### 5.3 长期稳定性

| 测试 | 时长 | 验证项 |
|------|------|--------|
| GW 7×24 + 随机请求 | 24h | 内存无泄漏、连接池无泄漏、续签正确率 100% |
| Portal 7×24 + CRUD 循环 | 24h | DB 连接池稳定、审计日志持续写入 |
| JWKS 轮换 + 混合请求 | 72h | 新旧密钥过渡期零拒绝 |
| 授权码并发 100 个 | 瞬时 | 无竞争条件、无重复签发 |

---

## 六、执行路线图

```
Phase 0: Mock 基础设施统一化（3 天）
  ├── mock-factory.ts 创建
  ├── 迁移 6 个弱测试文件至统一工厂
  ├── 追加写入路径验证
  └── CI PR 验证门禁

Phase 1: E2E Playwright 搭建（5 天）
  ├── playwright.config.ts
  ├── docker-compose.e2e.yml 统一启动 Portal + Gateway 依赖
  ├── Cycle 1-2 (10 tests): 未认证 → 认证全流程
  ├── CI main.yml 集成 Playwright
  └── 验收: 全绿通过

Phase 2: E2E + API 加固（5 天）
  ├── Cycle 3-5 (10 tests): 管理 CRUD → Token 生命周期 → RBAC
  ├── Phase 2.1-2.3 API 加固（弱测试 → 有效测试）
  ├── T7 安全测试 (14 tests)
  └── 验收: 需求追溯率 100%

Phase 3: Rust Gateway 扩展（3 天）
  ├── T6-01~04 (10 tests): AuthDecision + TokenRefresher + PathMatcher + RateLimiter
  ├── 基准测试 CI 集成
  └── 验收: cargo test 全绿 + bench 无回归

Phase 4: 可靠性测试（5 天）
  ├── 故障注入 (6 scenarios)
  ├── k6 性能基准 (4 benchmarks)
  ├── UI 截图回归 (12 screenshots)
  └── 验收: 性能基线建立

Phase 5: CI 门禁加固（2 天）
  ├── main.yml E2E Job 修复（安装 Playwright 浏览器 + 超时调整）
  ├── pr.yml 增补 cargo audit、覆盖率阈值
  └── 追溯报告 → PR comment 自动发布
```

---

## 七、验证门禁矩阵

| 门禁 | Phase | 阈值 | 违例后果 |
|------|-------|------|----------|
| `pnpm test:api` | 0 | 100% pass | PR 不可合并 |
| `pnpm test:components` | 0 | 100% pass | PR 不可合并 |
| `cargo test` | 0 | 100% pass | PR 不可合并 |
| `pnpm lint` | 0 | 0 error | PR 不可合并 |
| `pnpm typecheck` | 0 | 0 error | PR 不可合并 |
| `cargo clippy -D warnings` | 0 | 0 warning | PR 不可合并 |
| E2E Playwright | 1 | 100% pass | PR 不可合并 |
| 需求追溯覆盖率 | 2 | ≥ 95% | PR 标记 ⚠️ |
| 架构约束覆盖率 | 2 | ≥ 80% | PR 标记 ⚠️ |
| k6 性能回归 | 4 | p99 < 2x baseline | Rollback 触发告警 |
| 截图回归 | 4 | maxDiffPixels < 200 | PR 人工审查 |

---

## 八、测试覆盖率目标 (Go/No-Go)

| 层级 | 当前 | Phase 0 | Phase 1 | Phase 2 | Phase 3 | Phase 4 | 目标 |
|------|------|---------|---------|---------|---------|---------|------|
| 领域层 (it) | 64 | 72 | 72 | 80 | 80 | 80 | **80+** |
| API 集成 (it) | ~180 | 180 | 180 | 210 | 210 | 210 | **210+** |
| 组件 (it) | 41 | 50 | 50 | 55 | 55 | 55 | **55+** |
| E2E (test) | 0 | 0 | 10 | 20 | 20 | 20 | **20+** |
| Rust 单元 (fn) | 11 | 11 | 11 | 11 | 21 | 21 | **21+** |
| Rust 基准 (bench) | 5 | 5 | 5 | 5 | 5 | 5 | **5** |
| 安全测试 (case) | 0 | 0 | 0 | 14 | 14 | 14 | **14+** |
| 截图回归 | 0 | 0 | 0 | 6 | 6 | 12 | **12** |
| 需求追溯率 | 94.7% | 95% | 97% | **100%** | 100% | 100% | **100%** |
| 架构约束覆盖 | 17/27 | 18/27 | 20/27 | **22/27** | 24/27 | 25/27 | **25/27** |

---

## 九、风险与缓解

| 风险 | 概率 | 影响 | 缓解 |
|------|------|------|------|
| E2E 测试环境不稳定（Gateway + Portal 双服务） | 中 | 高 | Docker 发布验收栈健康检查 + Playwright 重试 |
| 测试 DB TRUNCATE 影响并行执行速度 | 高 | 中 | Phase 0 改为 SAVEPOINT/ROLLBACK 事务隔离 |
| 追溯报告与代码不同步（`@req` 遗漏） | 中 | 中 | CI 强制追溯率 ≥ 95% 门禁 |
| Gateway Rust 测试需要真实 PostgreSQL/Redis | 低 | 高 | 当前已验证：JWT 验签 100% 离线，零基础设施依赖 |
| Playwright + Gateway SSL 自签名证书 | 高 | 低 | `ignoreHTTPSErrors: true` |

# 2026-09-29 代码坏味道深度修复：架构收敛残骸、双真相源、决策表与伪测试

> 来源：全库坏味道审计（Gateway Rust / Portal 页面层与核心库 / contracts / 测试体系）P0×5、P1×7、P2×15+ 的逐项修复。
> 关联：ADR-010（OAuth Client 收敛残骸）、ADR-011（故障语义分级的落点修正）、AGENTS.md 自身规范（Controller ≤20 行、枚举契约派生）。

## 设计原因与修复对照

### P0 — 违反自身规范 / 配置说谎

| 问题 | 背后设计原因 | 修复 |
|---|---|---|
| A1 `oauth_enabled` 死配置（定义+默认值+夹具，零消费方） | H-1 二期把 OAuth 收敛到 `[gateway.oauth]` 后，per-upstream 开关失去语义但没删——重构"留尾巴"是配置说谎的典型来源 | 删除字段 + `default_true` 助手 + 三处夹具；serde 忽略未知表，存量 toml 不受影响 |
| A2 Controller ≤20 行 15/20 违反 | data.ts 读模型重复 select+count+拼装五件套；重复本身是坏味道，行数只是症状 | 新增 `lib/pagination.ts` 读模型原语（`paginationMeta`/`withPagination`/`countRows`），5 个 data.ts 收敛；行映射器提升为具名模块函数（可单测）；参数对象提升为接口。20 个导出函数全部 ≤20 行 |
| A3 合法空权限用户缓存永不命中 | `check-permission.ts` 用"空数组"推断 cache miss，而 `getUserPermissionContext` 恰恰会缓存合法的空上下文 | 删除手写的第二条 Redis 读取路径，统一走 `getUserPermissionContext`（缓存→null 标记→DB 三态自管理）；ctx 为 null 按 fail-close 拒绝（ADR-011 否决性数据） |
| A4 env 缓存单例被热路径 getter 绕过 | 单例 schema 含必填 DATABASE_URL，而 getter 有"最小 env 可用"的正当场景（脚本/测试）——两者被错误地做成了二选一 | 两层 schema：`runtimeConfigSchema`（DATABASE_URL 放宽为可选）承载缓存单例，热路径 getter 全部走缓存；`getDatabaseUrl` 保留专属 strict 解析承担 fail-fast |
| A5 授权码 `used:true` 双写 | 原子领取改造（条件 UPDATE + returning 置位）后，旧的显式置位语句残留 | 删除二次更新，注释说明置位语义已在领取时完成 |

### P1 — 双真相源 / 逻辑瑕疵

| 问题 | 背后设计原因 | 修复 |
|---|---|---|
| B1 `rotateRefreshToken` 家族撤销 SQL 重复 + 事务后失败产生孤儿 RT | 两个拒绝分支各自手写同一段 UPDATE；权限缓存/签名步骤在事务提交后，失败即留下"已入库但永不发放"的 RT 行 | `revokeTokenFamily(tx, userId, clientId)` 原语两分支共用；后置步骤 try/catch + 补偿回收新 RT（仅回收新行，不级联家族——infra 故障不牵连其他会话） |
| B2 默认 scope 字面量双源（token.ts + DB 列默认） | 同一决策写在两处，分叉后签名/发库 scope 静默不一致 | contracts 新增 `DEFAULT_SCOPES`（从 `SCOPES_SUPPORTED` 派生），token.ts 与 schema 列默认同源 |
| B3 权限缓存两条读取路径 | checkPermission 为省一次映射手写 GET+parse，形成与 permissions.ts 的漂移面 | 同 A3：单一读取路径 |
| B4 续签 `skipped` 语义坍缩为失败 | `try_endpoint` 返回 Option，"无需续签"与"端点故障"同形，回退循环对同一 Portal 重复注定 skipped 的请求 | `EndpointOutcome{Tokens,Skipped,Failed}` 三态；skipped 终止全部重试 |
| B5 clients 详情页读路径 REST 自调用 | audit-logs 页已消灭 client→API→data 双跳，clients 页漏改——同类页面两种范式 | `page.tsx` server 化直调 data.ts，交互态拆分 `ClientDetailClient`，变更后 `router.refresh()`；DTO `username` 对齐真实可空性 + 组件空值兜底 |
| B6 `authenticate.rs` 伪测试（assert_eq!(X,X)） | 决策逻辑内嵌 check() 无法脱离 Pingora Session 测试 → 写了同义反复充数 | 抽出纯函数 `refresh_failure_blocks(expiry, refreshed)`，决策表 6 真值全覆盖；删除"编译器强制穷举"式伪测试 |
| B7 config.rs 陈旧 fixture（`[upstreams.oauth]` 旧格式、raw-string `\n` 字面量） | serde 静默忽略未知表，错误 fixture 永远"绿" | 删除幽灵表 + 测试名改为记录"忽略未知表"语义；invalid-toml 用例改真实换行的类型错误 |
| B7+ 两套 upstream 测试助手 | `oauth_upstream`/`upstream` 重复 | 合并为 `upstream(name, oidc_provider)` |

### P2 — 洁癖级（已全部修复或显式豁免）

- **文档腐化五处**：main.rs 启动横幅 Pingora 0.8.1→0.9.0；`gateway.rs` LB 选择注释 0.8→0.9；`oauth.rs` 失效引用 `is_secure_host` 改为陈述部署拓扑事实；`auth/mod.rs` `signRefreshToken`→`issueRefreshToken`；`gateway.rs` doctest 仍引用已删除的 `RouteEntry.oauth` 字段——随 GatewayDeps 重写。
- **GatewayDeps 参数对象**：13 个裸位置参数（5 个 Option/bool）→ 具名字段结构，删除 `#[allow(too_many_arguments)]`；调用点逐项自解释。
- **`default_upstream_name` 只喂日志**：改为 `router.fallback_prefix()`——兜底语义由 Router 单一真相源陈述，不再用"路由表首项"近似。
- **http.rs 死回退**：`get("accept").or_else(get("Accept"))`（HeaderMap 查找大小写不敏感，回退永不命中）删除并注释归一化事实。
- **死分支**：`oauth_flow.rs` 的 `secure = true` 后再 `if secure` 翻译 scheme → `SECURE` 命名常量 + `/authorize` base URL 复用 `build_redirect_uri`（与 redirect_uri 同一函数构造，消除第三处 scheme 翻译）。
- **nonce fail-open 闭合**：原先"cookie 无 nonce 即跳过校验"存在单侧篡改缺口；改为 `(cookie, id_token)` 双向匹配，仅两侧皆无才放行（OIDC Core §3.1.2.2）。
- **jwks.rs 双刷**：`start_with_ready_notifier` 首刷成功后 `run_refresh_loop` 立即再刷一次 → 循环改为先等待后刷新，周期首刷落在 interval 之后；UnknownKid 按需唤醒语义不变。
- **`build_session_cookies` 绕开 helper**：复用 `build_set_cookie`，消除三份重复的 Cookie 属性串。
- **`verifyAccessToken` TS 侧坍缩 null（豁免）**：Rust 侧 VerifyError 枚举服务于网关三态决策（401/PKCE/续签）；TS 侧全部调用方只消费"通过/不通过"布尔语义，引入类型化错误是无消费方的 YAGNI。**记录为刻意不对称**。
- **`trackUserJti` 失败吞掉（豁免）**：best-effort 索引；验签时 jti 黑名单本身 fail-close（Redis 挂→token 不可用），追踪缺口不构成放行面。
- **`insert_key_for_test`/`set_metadata_for_test` 编译进生产（豁免）**：`#[doc(hidden)]` 测试支撑 API 惯例；`#[cfg(test)]` 会破坏 benches（独立 target 不带 test cfg）。
- **any 清理**：`response.ts` 泛型 cast 修正；`audit/data.ts` column/orderBy/table 用 `AnyColumn`/`PgTable`/`SQL` 真实类型，仅保留 mapRow 一处已注释的内部边界；`CreateUserDialog` prevState 走 action 的 FormData 双签名（修正"ApiResponse 冒充输入"的类型谎言）；`users/new` + `UserTable` 状态从手写字面量联合改为 contracts `UserStatus`/`USER_ACTIVE` 派生（发现 `users/new` 手写联合缺 DELETED——正是"禁止手写枚举"规则要防的漂移实例）。
- **`users` 版 `getDepartments` 与 departments 版同名不同义**：改名 `getDepartmentOptions`。
- **permissions.ts 守卫与日志**：`cacheUserPermissionContext` 的 `getRedis()` 纳入守卫（预填充属缓存性故障，fail-open）；四处无插值反引号日志改正；`audit.ts` 不可达的外层 `.catch` 删除；`server-logger.ts` 死合并 `sub ?? null` 删除。
- **config.rs 测试污染 CWD**：三个固定名文件改 `std::env::temp_dir()`。
- **ESLint 测试区策略化**：`eslint.config.mjs` 测试区显式豁免 no-console/no-explicit-any/max-lines-per-function（策略化而非 284 条静默堆积），生产区保持严格；lint 警告 284 → 79（0 错误）。
- **seed 工厂返回类型**：`SeedData['x']`（可选属性→undefined）改为 `NonNullable<SeedData['x']>`——工厂恒返回数组，8 处同类一次修净（协作方在途测试的类型错误即源于此）。

## 协作并行改动说明

修复期间检测到同仓并行工作（JWT typ 显式校验 RFC 8725 §3.11、GATEWAY_JWT_AUDIENCE、JWKS 轮换宽限窗口 F3 及其测试）：本批修复全部避开其改动面，仅做两类兼容性收敛——auth-logout 测试期望同步到 3 参 typ 契约；seed 工厂类型从源头修正。

## 验证矩阵

| 门禁 | 结果 |
|---|---|
| `cargo clippy --all-targets --all-features -- -D warnings` | ✅ 0 告警 |
| `cargo clippy --all-targets --no-default-features -- -D warnings` | ✅ 0 告警 |
| `cargo fmt --all -- --check` | ✅ |
| `cargo test`（含新决策表测试） | ✅ 全绿 |
| `pnpm -r typecheck` | ✅ 0 错误 |
| `pnpm -r lint` | ✅ 0 错误 / 79 警告（测试区策略化后） |
| `pnpm test` | ✅ 46 文件 / 384 测试全绿（含协作方并行新增 28 项） |
| Docker 生产等价构建（node:26-alpine + Turbopack） | ✅ |
| 容器冒烟 | ✅ discovery/login 双 200 |

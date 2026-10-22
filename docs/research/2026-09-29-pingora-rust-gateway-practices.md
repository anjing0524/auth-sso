# 研究笔记：Pingora / Rust 网关实践对照（2026-09-29）

> 研究范围：`apps/gateway`（Pingora 0.9.0 + OpenSSL）的 HTTPS 终结与 TLS 管理、JWKS 离线验签、限流、ProxyHttp 生命周期回调、依赖版本，对照官方文档/源码与 RFC 8725 的一手来源差距分析。
> 方法：先完整读取对应源码，再逐条回溯到拥有该事实的来源；无法从一手来源验证的说法显式标注"未验证"。

## TL;DR — 最重要的 5 条行动建议

1. **【低/维护】版本字面量漂移**：`main.rs:37` 启动日志写 "Pingora 0.8.1"，`gateway.rs:22` 注释引用 "pingora-load-balancing 0.8 select 签名"，实际依赖均为 0.9.0。0.9.0 已是 crates.io 最新版（2026-09-09 发布），建议同步字面量防止后续升级误导。
2. **【中/多节点才触发】上游无健康检查**：`LoadBalancer::try_from_iter` 后未配置任何主动/被动健康检查，节点宕机时请求命中该节点 → 502，需等人工移除。Pingora 生态提供 LB 健康检查机制，多节点部署前建议接入（见 §4）。
3. **【低】Gateway 未校验 JWT `aud`**：`jwks.rs:71` 设 `validate_aud = false`（注释：校验职责在 Portal 侧）。当前体系级 `aud='auth-sso'` 下安全等价；但 Portal 演进 per-client aud（ADR-012 决策 4）后 Gateway 必须重开（RFC 8725 §3.9）。
4. **【低】JWT 显式类型缺失**：LoginSession 与 Access Token 共用同一 claims 形状与 aud，未设 `typ` header——RFC 8725 §3.11 建议 JWT 显式类型化以防跨用途类型混淆（见 §2）。
5. **【确认】零停机升级未纳入部署路径**：Pingora 内建 `-u/--upgrade`（监听 fd 经 Unix socket 交接、旧进程排水），当前部署文档/脚本未体现，建议验证并固化（见 §4）。

---

## 1. HTTPS 终结 / TLS 管理

### 官方/规范结论

- `pingora_core::listeners::TlsAccept::certificate_callback`："This function is called in the middle of a TLS handshake"——每次服务端 TLS 握手中途调用，通过 `ssl_use_certificate` / `ssl_use_private_key` 提供证书；**仅支持 openssl / boringssl**（[docs.rs/pingora-core 0.9.0 TlsAccept](https://docs.rs/pingora-core/0.9.0/pingora_core/listeners/trait.TlsAccept.html)）。这正是动态证书/SNI 选择与证书热替换的官方机制，配合 `TlsSettings::with_callbacks` 装配。
- 另有 `handshake_complete_callback`（握手完成后注入自定义连接元数据）本项目未使用——无需求，正确。
- 零停机升级：Pingora 内建 `-u/--upgrade` 命令行——新进程经 Unix 升级 socket 从旧进程接管监听 fd，旧进程排水在途请求后退出，无请求丢弃（[Dev.to Pingora 网关指南](https://dev.to/warren_jitsing_dd1c1d6fc6/pingora-guide-how-to-make-a-programmable-api-gateway-1oim)；[Pingap（基于 Pingora 的反向代理）文档](https://github.com/vicanso/pingap)描述同一机制的交接语义）。

### 本项目现状（代码事实）

- `tls.rs:206-216` 实现 `TlsAccept::certificate_callback`，每次握手 `ArcSwapOption` wait-free 读取当前快照并应用到 `TlsRef`——与官方"每握手回调"语义精确对齐，热路径零磁盘 IO、无锁。✅
- 快照安装前完整解析证书链并校验叶证书公钥与私钥匹配（`tls.rs:64-66` `public_eq`），SHA-256 摘要去重（`Unchanged` 短路），新对非法时**保留旧快照**（`tls.rs:177-189` + 测试 `store_retains_last_snapshot_when_new_pair_is_invalid`）——证书加载失败不会清空服务能力。✅
- `acme.rs`：内建 ACME 客户端（instant-acme），**ARI 续期**（`renewal_info` + suggested window + 按证书摘要的确定性抖动，`acme.rs:398-440/598-610`），ARI 不支持时回退"2/3 生命周期"评估（`acme.rs:612-636`）；HTTP-01 challenge 进程内应答 + token 严格校验（`acme.rs:114-120`）；状态以 0600 单 JSON bundle 原子持久化（fsync + rename + 目录 fsync，`acme.rs:255-295`）。✅ 超出常见实践（多数方案用 cron + certbot 外部热加载）。
- `main.rs:210-220`：`TlsSettings::with_callbacks` + `enable_h2` + `add_tls_with_settings` 装配；ACME 引导模式下 HTTPS 监听器先起、证书签发后自动上线（`tls_ready_at_boot` 分支）。✅

### 差距与建议

- **证书热更新路径完整**（ACME → install_pem → 原子快照替换 → 下一次握手生效），无需 Pingora 额外的 certificate reload 机制；`TlsAccept` 官方回调即为此设计。无差距。
- **建议**：将 `-u` 零停机升级写进部署 runbook 并演练一次（含 ACME 状态目录、Redis/JWKS 就绪门控的启动顺序在新进程上的表现——`add_dependency` 就绪门控 `main.rs:163-164/222-223` 在升级路径同样生效，值得实测确认）。
- 握手期阻塞：回调内仅一次原子读 + OpenSSL 应用证书，无 IO——无阻塞风险。✅

## 2. JWKS 离线验签

### 官方/规范结论

- **RFC 8725（JWT BCP）与网关验签直接相关的强制/建议项**：
  - §3.1 Perform Algorithm Verification：不得信任 JWT header 的 alg，必须用固定白名单（防 alg confusion / HS256 降级）。
  - §3.10 Do Not Trust Received Claims：`kid` 仅能用于在**可信来源**的密钥集中查找，禁止 `jku`/`x5u` 类 URL 拉取。
  - §3.9 Use and Validate Audience：JWT 带有 `aud` 时，接收方 MUST 校验自己是预期受众。
  - §3.11 Use Explicit Typing：新用途的 JWT 建议（RECOMMENDED）设置 `typ` 并校验，防跨用途类型混淆。
- **jsonwebtoken 9.3 官方语义**（[docs.rs/jsonwebtoken 9.3](https://docs.rs/jsonwebtoken/latest/jsonwebtoken/)）：`Validation` 指定 `algorithms` 白名单，`decode` 拒绝白名单外 alg；`validate_exp`/`validate_aud` 默认开启、可显式关闭；默认 leeway 60s 仅作用于其内置校验。
- **JWKS 缓存/轮换推荐模式**：kid 未命中 → 有节流地重新拉取 JWKS（防止伪造 token 风暴借"每个坏 token 触发拉取"打爆上游），新集合原子替换、旧密钥保留宽限期。

### 本项目现状（代码事实）

- **alg 硬锁**：`validation.algorithms = vec![ES256]` 且不从 OIDC Discovery 动态填充（`jwks.rs:319-323`，注释明言防 alg 混淆降级）——RFC 8725 §3.1 ✅。
- **kid 仅查本地可信缓存**：`verify.rs:108-126` 单次 ArcSwap 快照内 `keys.get(&kid)`，无任何 URL 拉取——RFC 8725 §3.10 ✅。
- **UnknownKid 按需刷新**：CAS 单飞 + 30s 最小间隔（`jwks.rs:209-224`），由后台循环消费 Notify 信号（`jwks.rs:633-642`）；本次请求仍拒绝、下一请求受益。✅ 业界最佳实践水平。
- **24h 密钥宽限期**：`merge_keys` 对不在新集合中的旧 kid 保留 24h（`jwks.rs:21/137-164`）——上游瞬时返回残缺 JWKS（轮换维护窗口）不会顶掉在用密钥。✅
- **就绪门控**：覆盖 `start_with_ready_notifier` 先首刷后放行，配合 `add_dependency`（`jwks.rs:564-601`、`main.rs:163-164`）；首刷连续 5 次失败降级放行（401/PKCE 循环），渐进退避 30→300s（`jwks.rs:469-475`）。✅
- **jti 黑名单 fail-close**：Redis EXISTS 带 2s 超时，连接池未就绪/超时/命令异常一律视为已撤销拒绝请求（`redis.rs:86-113`、`verify.rs:135-143`）——与 ADR-004 2026-09-28 修订一致。✅
- **exp 手写三态**：`validate_exp = false`（`jwks.rs:71-72`），Gateway 自行比较 `claims.exp`（`verify.rs:146-154`）→ `Valid / NearlyExpired(<300s) / Expired`，后两者触发静默续签（`authenticate.rs:100-111`），续签去重用 SET NX EX 单命令原子抢占（`redis.rs:119-138`）。
- issuer 校验来自 Discovery 的 `set_issuer`（`jwks.rs:320`）✅（OIDC Discovery §4.3 语义，issuer 已 URL 化，见 OIDC 研究笔记）。

### 差距与建议

1. **【低】`validate_aud = false` 与 RFC 8725 §3.9 的偏差**：`verify.rs` 注释说明 aud 职责在 Portal 侧。当前 `aud` 恒为体系级 `PORTAL_AUD`（Portal 签发时统一写入），Gateway 不校验与校验等价；但 Portal 演进 per-client aud（ADR-012 决策 4）后，Gateway 作为通用验签方需要重新评估（跨 client token 替代防线）。建议在 ADR-012 决策 4 落地清单中显式列入"Gateway 重开 aud 校验或引入 aud 白名单配置"。
2. **【低】显式类型（RFC 8725 §3.11）**：LoginSession（5min TTL）与 Access Token（1h）共用 `PortalJwtClaims` 形状 + 同 aud + 同签发密钥，均未设 `typ`。客户端把 LoginSession 塞进 `portal_jwt_token` Cookie 可被 Gateway 当 AT 接受 5 分钟（权限相同故实际影响小，但违反显式类型化建议）。建议签发时加 `typ: access+jwt` / `typ: login+jwt` 并在验签侧校验。
3. **【低】exp 手写比较无 leeway**：jsonwebtoken 内置校验默认带 60s leeway，关闭后 `claims.exp < now` 为精确比较（`verify.rs:148`）——Portal/Gateway 时钟偏差会线性影响到期边界（1h TTL 下影响小）。若两端无 NTP 基线保证，可给手写比较引入 30-60s 偏差容忍。
4. **【跨引用/中】冷启动 JWKS 受 Portal 侧零重叠窗口影响**：Gateway 的 24h 宽限仅保护**缓存内**旧 kid；进程冷启动拉到的 JWKS 由 Portal 生成——Portal 的 jwks 端点在 90 天密钥过期瞬间立即移除旧公钥（详见 [OIDC 研究笔记 §6](./2026-09-29-oidc-oauth2-provider-practices.md)）。Portal 侧加宽限窗口是根治点。

## 3. 限流

### 官方/规范结论

- `pingora_limits::rate::Rate` 官方定位："A stable rate estimator that reports the rate of events per period of interval time"——按 interval 分周期计数，`observe(key, events)` 返回当前周期已见事件数（[docs.rs/pingora-limits 0.9.0](https://docs.rs/pingora-limits/0.9.0/pingora_limits/rate/struct.Rate.html)）。内部基于哈希 Estimator（列槽数据结构），是**估计器而非精确计数**，官方未承诺误差界；适合进程内限流基线，不适合计费级精确计量。
- **分布式限流**：需要跨实例共享计数时走 Redis；"检查 + 写入"的原子性应优先用单命令（`SET NX EX`）或 Lua/eval 脚本消除 TOCTOU。连接池（bb8）在热路径的开销主要是 `pool.get()` 借还与连接健康维护。

### 本项目现状（代码事实）

- 双计数器：`AUTH_RATE`（/api/auth/*，默认 20/min）与 `OIDC_TOKEN_RATE`（/oauth2/token，默认 30/min），`LazyLock<Rate>` 模块级单例、60s 周期（`rate_limiter.rs:24-27`）。observe 计数 ≤ 阈值判定，超限 `respond_429(60)`（Retry-After，`rate_limiter.rs:123-128`）。
- **分布式限流显式不做**：模块文档声明单容器部署、进程内已足，Redis 保留给 jti 黑名单/续签去重等真正需要跨实例状态的场景（`rate_limiter.rs:1-8`）。✅ 有据可依的取舍，非遗漏。
- Redis 侧原子性：续签去重用 `SET NX EX` 单命令（`redis.rs:119-138`，注释明言消除 TOCTOU）——无需 Lua；jti 检查 `EXISTS` 单命令。✅ 当前用例全部单命令原子，Lua 仅在未来 token-bucket 型分布式限流时需要。

### 差距与建议

1. **【标注】估计器语义**：`Rate` 是双桶估计器（当前周期 + 上一完成周期），60s 窗口边界附近有 ≤1 个周期的滞后与估计误差——对爆破防护场景足够；若未来对阈值精确性有要求（如配额），换精确计数。
2. **【低】`is_tracked_path` 前缀匹配**：`path.starts_with("/api/auth/")`（`rate_limiter.rs:35-37`）与 token 精确匹配并存，语义一致且有测试覆盖，无风险；仅提示该谓词是路径分类的第二处实现（与 `PathMatcher` 并存），保持单一真相源是后续重构方向。
3. **多实例时的路线**：已有 `SET NX EX` 原子化经验；token bucket 落地时用 Lua 保证"读-改-写"原子，bb8 池需按 QPS 评估 `pool_max_size`（默认 16）。

## 4. ProxyHttp 生命周期回调

### 官方/规范结论

- `ProxyHttp` 各阶段官方语义（[docs.rs/pingora-proxy 0.9.0](https://docs.rs/pingora-proxy/0.9.0/pingora_proxy/trait.ProxyHttp.html)）：
  - `request_filter` 返回 `Ok(true)` 表示本阶段已直接响应、**短路整个代理流程**（官方推荐的提前响应通道）；
  - `upstream_peer` 必须实现，返回选中上游；
  - `upstream_request_filter` 在发往上游前修改请求（header 注入/剥离的正确阶段）；
  - `response_filter` 在上游响应下发给客户端前修改响应；
  - `logging` 在请求结束后调用（仅记录，不能改响应）。
- 连接复用/重试：`HttpPeer` 默认选项含连接超时与重试次数；`fail_to_connect` 回调默认返回 false（失败后不再换节点重试）；`pingora-load-balancing` 提供健康检查模块（官方 examples/gateway 演示了 ActiveHealthCheck + BackgroundService 用法——**该 API 细节本次未逐字核对，标注未验证**）。
- 零停机升级：`-u/--upgrade` 机制见 §1。

### 本项目现状（代码事实）

- 回调使用三件套（`gateway.rs:389-611`）：`request_filter`（metrics → 路由 → 分类 → 限流 → callback 拦截 → 公开放行 → 鉴权三态）短路语义全部走 `Ok(true)` ✅；`upstream_request_filter`（零信任头剥离/权威注入/HMAC 签名/trace-id）✅ 修改 header 的正确阶段；`response_filter` 仅做续签 Set-Cookie 注入 ✅。
- **零信任头清洗**（`gateway.rs:91-137`）：`Authorization` + 全部 `X-*`（黑名单兜底，白名单仅代理标准头）无条件剥离后权威注入——下游身份 100% 来自 Gateway。✅ 超出常规实践。
- 权威覆写 `X-Forwarded-For`/`X-Real-IP`（`gateway.rs:540-546`）：自管 TLS 只信 socket 对端，平台 TLS 只信 Vercel 专用单值头且必须是合法 IP 字面量（`gateway.rs:50-53`）。✅ 防 XFF 伪造链。
- **未覆盖的回调**：`fail_to_connect` / `upstream_response_filter` / `logging` 均用默认实现——当前无重试与访问日志定制需求，语义安全。
- **无健康检查**：`LoadBalancer::try_from_iter`（`main.rs:77-79`）裸装配；节点宕机 → `select` 仍返回该节点 → 连接失败 → 默认不换节点 → 502（`gateway.rs:369-377` 对 `select=None` 有 502 兜底，但仅覆盖"全部节点缺失"场景）。

### 差距与建议

1. **【中】多节点部署前接入健康检查**：pingora-load-balancing 的健康检查（主动探活 + `BackgroundService` 周期执行，或连接失败被动标记）可将故障节点摘出轮询。单节点现状无影响；扩展 `addresses` 逗号多节点（`config.rs:203-211` 已支持解析）前建议落地。API 细节以 docs.rs/pingora-load-balancing 0.9.0 为准（本次未逐字核对）。
2. **【确认】`-u` 升级演练**：见 §1 建议。
3. **【低】`logging` 回调缺位**：访问日志目前依赖 request_filter 内 metrics + tracing 散点；如需统一访问日志（status/耗时/upstream），官方 `logging` 阶段是正确挂点。

## 5. 版本核对

| 依赖 | 本项目 | 最新状态（2026-09-29 查证） | 结论 |
|------|--------|---------------------------|------|
| pingora-* | 0.9.0 | **0.9.0 即最新**，2026-09-09 发布；前版 0.8.1（2026-06-04）（[crates.io API](https://crates.io/api/v1/crates/pingora-core)） | ✅ 无落后 |
| jsonwebtoken | 9.3.0 | 9.3.1（2025-02-06 发布）（[crates.io](https://crates.io/crates/jsonwebtoken)） | 小版本落后，建议升级；检索中见 RustSec 相关提示**未核实**，升级前查 RustSec 数据库 |
| redis | "1" | redis-rs 1.0 线（1.0.x，tokio/smol 双运行时）（[GitHub releases](https://github.com/redis-rs/redis-rs/releases)） | ✅ 已在 1.x 线，`cargo update` 即可跟进 |
| edition | 2024 | 当前最新 edition | ✅ |

## 未验证条目

1. `pingora-load-balancing` 0.9.0 健康检查 API 细节（模块存在性来自官方仓库 examples 的一般知识，未逐字核对 0.9.0 文档）。
2. Pingora `-u/--upgrade` 机制的官方 user guide 原文（GitHub 直连超时，结论经 Dev.to 指南与 Pingap 文档交叉验证）。
3. jsonwebtoken 9.3.1 的 RustSec 提示（检索摘要含糊，未在 RustSec 数据库确认）。
4. redis-rs 1.0 线相对 0.x 的破坏性变更清单（本项目已在 1.x 线内，未核对跨大版本迁移细节）。
5. Pingora 0.9.0 相对 0.8.x 的 CHANGELOG 逐项变更（GitHub 直连超时；本项目依赖即 0.9.0，无升级动作需求）。

## 参考来源（访问日期：2026-09-29）

- Pingora TlsAccept（docs.rs 0.9.0）：https://docs.rs/pingora-core/0.9.0/pingora_core/listeners/trait.TlsAccept.html
- pingora-limits Rate（docs.rs 0.9.0）：https://docs.rs/pingora-limits/0.9.0/pingora_limits/rate/struct.Rate.html
- pingora-proxy ProxyHttp（docs.rs 0.9.0）：https://docs.rs/pingora-proxy/0.9.0/pingora_proxy/trait.ProxyHttp.html
- jsonwebtoken（docs.rs）：https://docs.rs/jsonwebtoken/latest/jsonwebtoken/
- crates.io pingora-core 版本（API）：https://crates.io/api/v1/crates/pingora-core ；https://crates.io/crates/jsonwebtoken
- Pingora 零停机升级（交叉验证）：https://dev.to/warren_jitsing_dd1c1d6fc6/pingora-guide-how-to-make-a-programmable-api-gateway-1oim ；https://github.com/vicanso/pingap
- redis-rs releases：https://github.com/redis-rs/redis-rs/releases
- RFC 8725（JWT BCP）：https://www.rfc-editor.org/rfc/rfc8725.html
- 本仓库依据：AGENTS.md、docs/adr/ADR-004、apps/gateway/src/ 相关源码（file:line 见正文）

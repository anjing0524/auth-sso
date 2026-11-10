# ADR-033: 入口 Host 规范化 —— 非规范 Host 302 回规范入口，替代「放宽回调白名单」

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | implemented (2026-11-06)              |
| **日期**   | 2026-11-06                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | apps/gateway 入口过滤、GatewayConfig、docker/compose、deploy.sh 校验 |

## 背景

2026-11-06 PM/UI-UX 走查（PM-01）发现：Gateway 按请求 Host 逐字节构造 OAuth `redirect_uri`
（`apps/gateway/src/oauth.rs` 的 `build_redirect_uri`），而 Portal 自身客户端的回调白名单
来自 `PORTAL_REDIRECT_URL`（seed 精确匹配，符合 OAuth 2.1）。用户经未注册 Host
（如 `localhost`）入口登录时，构造出的回调地址不在白名单内 → `AUTH_SSO_2033`
访问受限，且错误页无自助恢复路径。测试栈 `docker/compose/test.yml` 只登记了
`https://127.0.0.1:19443/api/auth/callback` 单一入口，问题在「换 Host 访问」时必现。

关键事实（代码验真）：白名单**并非**代码写死——`PORTAL_REDIRECT_URL` 支持逗号分隔
多地址（`apps/portal/scripts/seed.ts` 的 `parseRedirectUrls`），生产部署
`docs/docker.md` 与 `scripts/docker/deploy.sh` 已要求按域名配置。真因是
**入口 Host 与已注册回调地址逐字节绑定**，多入口（IP/域名/反代）部署时漏登记即死锁。

## 决策

对非规范 Host 的对外请求做 **302 重定向回 `https://<规范Host> + 原 path?query`**，
而非放宽 redirect_uri 精确匹配：

1. **配置**：`GatewayConfig.canonical_host: Option<String>`，环境变量
   `GATEWAY_CANONICAL_HOST` 覆盖；**空串视为未配置**（compose `${VAR:-}` 缺省展开
   为空串的场景，保持「未配置即不重定向」的单一定义）；`None` = 完全不启用，
   既有部署零侵入。test.yml 显式 `127.0.0.1:19443`；prod.yml 缺省取
   `LETSENCRYPT_DOMAIN`。
2. **启动期校验**（`validate_production_security`）：只接受 `host[:port]`
   （如 `sso.example.com` / `127.0.0.1:19443` / `[::1]:8443`）；含协议、路径、
   空白即 bail，杜绝运行期产出畸形 `Location`。
3. **触发条件**：已配置 ∧ 请求 Host 与规范 Host **ASCII 大小写无关、端口敏感**
   不等 ∧ 非探针路径。端口敏感是因为 `redirect_uri` 含端口，端口不同即不同入口。
4. **探针豁免（硬约束而非优化）**：`/healthz` 与 `/__gateway/metrics` 永不重定向。
   容器内/K8s 探针的 Host 常是内部地址（test.yml 容器内探测 Host 为
   `127.0.0.1:443`，规范入口却是 `127.0.0.1:19443`），对探针 302 会让健康检查
   撞上宿主机不可达端口、把整个栈判死。test.yml 健康检查同步改探 `/healthz`
   （原探 `/login` 在启用规范化后会被 302）。
5. **执行位置**：`request_filter` 中位于 H-D-05（Host 必填 400）与 H-D-03
   （dot-segment 拒绝）之后——`Location` 的 path/query 已过入口校验，
   不引入开放重定向面。
6. **部署断言**：`deploy.sh` 的 `check_env` 断言 `PORTAL_REDIRECT_URL`
   （逗号分隔多值）同时登记 `NEXT_PUBLIC_APP_URL` 的 authority 与网关规范 Host，
   任一缺失即 fail 并给出含 `db:seed` 的修复指引。

### 否决的替代方案

- **放宽 redirect_uri 匹配**：违反 OAuth 2.1 精确匹配（防授权码劫持），不可接受。
- **301 永久重定向**：浏览器/CDN 缓存含 query 的 Location，运维切换入口后旧缓存难回收。
- **307/308**：登录流为 GET，无需保留方法语义。
- **在 AUTH_SSO_2033 错误页自救**：错误页无原入口上下文，且依赖用户手动改 URL；
  错误页改进（错误码指引/联系渠道配置化）另行跟进，不构成本决策的替代。
- **前置 LB/Nginx 层做**：本栈 Gateway 是唯一 TLS 终止点，无该层。

## 后果

- 正面：多入口部署的用户被自动带回唯一注册过的入口，登录不再因 Host 差异死锁；
  默认关闭、零侵入；与 H-D-03/05/10 的入口校验链天然衔接。
- 负面/注意：`canonical_host` 配置成用户不可达的 Host 会导致登录不可用（由启动期
  形态校验 + deploy.sh 登记断言双重缓解）；多入口部署仍需在 `PORTAL_REDIRECT_URL`
  登记全部入口回调。
- 残余风险：无无限重定向循环（重定向后 Host == canonical 即短路）；HTTP/1.0 等
  Host 缺失的边缘请求不重定向（H-D-05 已在 HTTP/1.1 缺 Host 时 400）。

## 验证

- `cargo fmt` 无改动；`cargo clippy --all-targets -- -D warnings` 零告警；
- `cargo test`：默认 features **193 passed / 0 failed** + doc-tests 7 passed；
  `--no-default-features`（平台 TLS 构建）**178 passed / 0 failed**；
- 新增 8 个测试：config 启动校验 2 个（合法 host[:port] 接受、URL/路径/空白拒绝）；
  纯函数 `canonical_host_redirect` / `is_probe_path` 6 个（未配置禁用、Host 相等
  noop（大小写无关/含端口）、不匹配重定向且 path+query 保留无尾随 `?`、
  探针豁免、Host 缺失跳过、探针名单精确覆盖含形近变体不误豁免）；
- 端到端验收：重建 Docker 验收栈后以 `https://localhost:19443/` 访问应被 302 到
  `https://127.0.0.1:19443/` 并完成登录（集成阶段执行）。

## 相关 ADR

- ADR-010：统一 OAuth 客户端（`issuer = NEXT_PUBLIC_APP_URL`，入口 URL 语义的来源）。
- ADR-012：OIDC 协议合规（issuer URL 化；redirect_uri 精确匹配是同一合规面）。

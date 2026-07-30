# Vercel 上的 Gateway 唯一公网入口

> 2026-07-30 生产部署复盘：Vercel Services、Docker 容器、Neon PostgreSQL 与 Upstash Redis。

## 目标

生产流量必须保持同一条链路：

```text
Browser → Vercel TLS → Rust Gateway → 127.0.0.1:4100 Portal
```

Portal 不得拥有独立公网路由；Gateway 是唯一监听 Vercel `$PORT` 的进程。PostgreSQL 与 Redis 使用 Vercel Marketplace 托管资源，不放入应用容器。

## 被否决的双 Service 方案

第一版把 Gateway 和 Portal 声明为两个 Vercel Service，并通过 `url` binding 让 Gateway 访问内部 Portal。真实生产日志暴露出以下问题：

- binding 域名在部分容器实例中解析为平台 IPv6 地址 `[100::1]:443`；
- 当前容器实例没有对应 IPv6 路由，Pingora 和 reqwest 均返回 `Network unreachable`；
- 同一路径会因实例不同而在 200 与 502 之间抖动，重试只能降低可见概率，不能恢复确定性。

因此不能把“偶尔可达”的平台私网绑定当作认证系统的稳定上游。

## 最终拓扑

根 `Dockerfile.vercel` 在同一镜像内构建并运行两个进程：

1. Next.js 使用官方 `output: "standalone"` 产物，只监听 `127.0.0.1:4100`。
2. Portal 的静态 OIDC Discovery 就绪后，启动 Rust Gateway。
3. Gateway 在 `external_tls_termination` 模式下只监听 Vercel `$PORT`。
4. `vercel.json` 只声明 `gateway` 一个 Service，catch-all rewrite 全部进入 Gateway。

这不是把 Portal 变成第二个公网服务器：4100 没有容器端口映射，也没有 Vercel Service 或 rewrite，只有同一网络命名空间内的 Gateway 能访问。

## 平台边界

### TLS

公网 TLS 由 Vercel 终结。Gateway 不启动 ACME、TLS listener 或 HTTP→HTTPS redirect，但仍把浏览器侧协议权威转发为 `X-Forwarded-Proto: https`。自管 Docker/Compose 部署继续使用 Gateway 内建 ACME，两种模式互斥。

这条边界必须落实到编译期，而不只是运行时 `if`：

- `self-managed-tls` 是 Gateway 默认 Cargo Feature，包含 `acme`、`redirect`、`tls` 模块及其专属直接依赖；
- `Dockerfile.vercel` 使用 `cargo build --release --bin gateway --no-default-features`；
- 平台构建的正常依赖图不得出现 `instant-acme`，也不编译上述三个模块；
- 裁剪版若未配置 `external_tls_termination = true`，启动校验直接失败。

Pingora 自身的代理/TLS 抽象仍传递依赖 OpenSSL，因此验收目标是排除 ACME 客户端与自托管 TLS 代码，而不是错误宣称二进制完全不含任何 TLS/加密依赖。

### 客户端 IP

自管 TLS 模式继续只信任 socket 对端。Vercel 模式下 socket 对端是平台代理，因此只读取 Vercel 权威覆写的 `X-Vercel-Forwarded-For`：

- 仅在 `external_tls_termination = true` 时启用；
- 仅接受单个可解析的 IPv4/IPv6 字面量；
- 逗号链、文本或缺失值全部退回 socket；
- 同一个权威值同时用于认证限流键和下游 `X-Forwarded-For` / `X-Real-IP` / `X-Client-IP`。

普通入站 `X-Forwarded-For` 永不作为信任来源。

### 配置

- `GATEWAY_SHARED_SECRET`、`PORTAL_CLIENT_SECRET`、`JWKS_ENCRYPTION_KEY` 只存在于 Vercel 加密环境变量。
- `DATABASE_URL` 与 `REDIS_URL` 由 Marketplace integration 注入。
- Portal OAuth 客户端的 `redirect_uris` 必须显式包含正式 Gateway callback。
- Docker 构建不会自动把项目环境变量转换为 `ARG`；会参与 Next.js 静态生成的公开 URL 必须有可复现的生产默认值，手工构建可用 `--build-arg` 覆盖。

## 验证门禁

上线前至少验证：

1. `docker build --check -f Dockerfile.vercel .` 无告警。
2. 完整镜像构建成功，Next.js 生产构建生成全部路由。
3. `cargo fmt --all -- --check`，以及 `--all-features`、`--no-default-features` 两套严格 Clippy 和 tests 通过。
4. `cargo build --release --bin gateway --no-default-features` 成功，`cargo tree --no-default-features` 不含 `instant-acme`。
5. 公网 `/api/health`、OIDC Discovery、JWKS 连续请求稳定返回 200。
6. 未携带密钥访问 `/__gateway/metrics` 返回 401，用于证明流量确实经过 Gateway。
7. 生产日志中 upstream 固定为 `127.0.0.1:4100`，不得再出现 `services.vercel-infra.com` 或 `[100::1]`。

## 可复用结论

- “内部 Service”不等于“已经满足当前容器网络栈”；必须以生产连续请求和运行时日志验证。
- 入口隔离应由部署拓扑保证，不能依赖一个隐藏 URL 或应用层约定。
- Next.js standalone 的 `public` 与 `.next/static` 必须显式复制到运行镜像。
- OAuth 回调白名单属于部署数据，域名切换时必须与环境变量、数据库记录一起变更。
- 平台已经托管某项能力时，应通过 Cargo Feature 形成编译边界；运行时开关只负责选择已编译能力，不能替代依赖裁剪。

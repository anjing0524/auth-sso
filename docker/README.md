# Auth-SSO Docker 构建 / 部署 / 运行

> **本文是 Docker 的唯一出处**（`AGENTS.md` 只留摘要与指针）。分两条路径：
> - **生产部署**（§1–§6）：Gateway 内建 ACME + 自托管证书；
> - **本地开发 / 发布验收**（§7）：`docker/compose/test.yml` 自签证书栈，`pnpm test:e2e` 的正式路径；
>   与 CI 的 `validation-suite.yml` 同一条路径。
>
> 日常命令与验收命令**只在 §7.2 维护**（本文不重复列表，避免两处漂移）。

## 目录结构

```text
docker/
├── compose/                # 编排：按生命周期分档
│   ├── local.yml           # 本地 PG16 + Redis7（pnpm test 前置）
│   ├── test.yml            # 发布验收 / CI 栈（含 acme profile）
│   ├── prod.yml            # 生产部署（deploy.sh）
│   └── acme-staging.yml    # 公网 Let's Encrypt staging 联调
├── images/                 # 镜像定义（被 compose / vercel.json 引用）
│   ├── portal.Dockerfile
│   ├── gateway.Dockerfile
│   ├── pebble.Dockerfile
│   └── vercel.Dockerfile
├── acme/                   # Pebble 配置与测试 CA（仅 test.yml 的 acme profile）
├── init-db.sql             # PG 首启初始化：创建 auth_sso_test
└── README.md               # 本文（唯一出处）
```

`.dockerignore` 必须留在**仓库根**（构建上下文根约束，见 §2）。

四份 compose 都显式声明 `name:`（实际取值为 `auth-sso` / `auth-sso-test` / `auth-sso-acme-staging` 三个；
其中 `local.yml` 与 `prod.yml` 共用 `auth-sso`）：
文件所在目录变化不会改变卷、镜像与网络名；`prod.yml` 的 `name: auth-sso` 也是 `deploy.sh`
按 `auth-sso-portal` / `auth-sso-gateway` 打 `:previous` 标签的前提。

## 文件有效性审计（2026-10-23；2026-10-23 二次校正：补 CI 专用服务与仓库相对路径）

结论：**全部有用，无死文件**。每个文件都有真实消费者；「可选」只表示仅在某条部署路径下启用，不代表无人使用。
下表列的是**文件**，不是目录内全部服务；`compose/test.yml` / `compose/local.yml` 里另有 profile 与 CI 专用服务（见各行「消费者」列）。

| 文件 | 职责 | 消费者（证据） | 结论 |
|---|---|---|---|
| `compose/local.yml` | 本地 PG16 + Redis7，`redis-commander` 在 `tools` profile 下可选 | `AGENTS.md` / `README.md` 的 `docker compose -f … up -d`；`pnpm test` 前置 | 必需（开发） |
| `compose/test.yml` | 发布验收 / CI 栈：postgres/redis/cert-init/db-init/portal/gateway；`node-test`（`workspace` target，CI lint/typecheck/test 用）；acme profile（pebble/challtestsrv/gateway-acme） | `scripts/docker/stack.sh`（仅前 6 个服务）、`scripts/e2e/acme-e2e.sh`、CI `validation-suite.yml`（`node-test` 与 acme 服务） | 必需（CI / 验收） |
| `compose/prod.yml` | 生产形态（ACME、健康检查、db-init、数据卷） | `scripts/docker/deploy.sh`、`apps/portal/__tests__/api/delivery-config-guard.test.ts` | 必需（生产） |
| `compose/acme-staging.yml` | 公网 staging ACME 联调 | `scripts/e2e/acme-staging.sh` | 可选（首次上线演练） |
| `images/portal.Dockerfile` | portal 镜像（`workspace` / `builder` / `runner` 三个 target） | `compose/test.yml`、`compose/prod.yml` | 必需 |
| `images/gateway.Dockerfile` | gateway 镜像（`cert-init` / builder / runtime） | `compose/test.yml`、`compose/prod.yml`、`compose/acme-staging.yml` | 必需 |
| `images/pebble.Dockerfile` | Pebble / challtestsrv 测试镜像 | `compose/test.yml` 的 acme profile、`scripts/e2e/acme-e2e.sh` | 必需（ACME 验收） |
| `images/vercel.Dockerfile` | Vercel 单镜像变体（gateway + portal 同进程组） | `vercel.json` 的 `entrypoint` | 可选（仅 Vercel 部署） |
| `acme/pebble-config.json` 等 4 个 fixture | Pebble 配置与测试根证书 | `compose/test.yml`、`scripts/e2e/acme-e2e.sh` | 必需（ACME 验收） |
| `init-db.sql` | 创建 `auth_sso_test`（API 测试库） | `compose/local.yml`、`compose/test.yml`、`apps/portal/vitest.globalSetup.ts`（该文件会补建缺失的测试库） | 必需（本地 / CI 测试） |

## 0. 生产部署总纲（生产路径 = §1–§6）

生产拓扑以 Gateway 为唯一公网入口。Gateway 的 Rust 进程内建 ACME 客户端，直接向 Let's Encrypt 申请和自动续期证书；不依赖 Certbot、宿主机脚本或本地自签证书。

> 编号说明：§0 是生产路径的总纲（一句话结论 + 本文档分工），**生产部署的具体步骤在 §1–§6**；§7 是本地开发 / 发布验收栈。根 `README.md` 与 `AGENTS.md` 里的「§0–§6 / §1–§6」指的就是这一套编号。

## 1. 拓扑

- **Gateway（Pingora/Rust）**：监听公网 80/443，执行 ACME HTTP-01、HTTP→HTTPS 跳转、TLS 终结、证书自动续期和离线 JWT 验签。
- **Portal**：管理门户和 OIDC Provider，仅在 Compose 内网提供服务。
- **PostgreSQL / Redis**：仅在 Compose 内网提供服务。
- **`gateway_acme` named volume**：仅由 Gateway 的固定非 root UID 10001 访问，持久化 ACME 账户凭据及当前证书 bundle。

ACME challenge 只存在于 Gateway 内存中。证书链和私钥被写入同一个 `0600` JSON bundle，经同目录临时文件、`fsync` 和原子 `rename` 持久化；握手路径只读取内存快照。

## 2. 前置条件

1. 域名的 A/AAAA 记录已指向部署主机；若配置了 AAAA，IPv6 也必须可达。
2. 公网 TCP 80 和 443 已放通。Let's Encrypt HTTP-01 必须通过 80 端口完成。
3. 没有 CDN/WAF 规则拦截或改写 `/.well-known/acme-challenge/`。
4. 已安装 Docker Engine 和 Docker Compose v2。

部署在**仓库根**执行（`compose/prod.yml` 的 `context: ../..` 需要读取源码）；除源码外只需生产环境变量与业务数据目录，不需要证书脚本或宿主机证书目录：

```text
/opt/auth-sso/            # 仓库根（含源码）
├── docker/
│   ├── compose/
│   │   └── prod.yml
│   ├── images/
│   └── init-db.sql
├── .env.prod
└── data/
    ├── postgres/
    └── redis/
```

`.dockerignore` 例外地保留在**仓库根**：Docker 只从构建上下文根读取它，而所有镜像的 context 都是仓库根
（compose 中写作 `context: ../..`，Dockerfile 路径再指向 `docker/images/*.Dockerfile`）。把它移进 `docker/` 会让
`node_modules`、`.next`、`.git` 全被送进构建上下文。

当前实现面向单个域名和单个 Gateway 实例。若未来水平扩展 Gateway，应先增加 ACME leader election 或改用集中式证书控制器，避免多个实例同时写同一账户状态。

## 3. 配置

在 `.env.prod` 中提供现有应用密钥和以下证书参数：

```dotenv
LETSENCRYPT_DOMAIN=portal.example.com
LETSENCRYPT_EMAIL=ops@example.com
ACME_CHECK_INTERVAL_SECS=21600
ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory

NEXT_PUBLIC_APP_URL=https://portal.example.com
PORTAL_REDIRECT_URL=https://portal.example.com/api/auth/callback

# 数据层凭据（生产必填；POSTGRES_USER 可选，默认 postgres）
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<强随机密码>
REDIS_PASSWORD=<强随机密码>
PORTAL_CLIENT_SECRET=<随机串>
GATEWAY_SHARED_SECRET=<随机串>
```

> 生产 Compose **不向宿主机发布 PostgreSQL 端口**（仅 Compose 内网可达），Redis 同样不发布端口；
> 数据库/缓存运维请用 `docker compose exec postgres psql` 或临时 `docker compose port` 转发。

生产环境强制要求 `LETSENCRYPT_DOMAIN`、`LETSENCRYPT_EMAIL` 和 `GATEWAY_SHARED_SECRET`。域名必须是有效 DNS 名，ACME directory 必须使用 HTTPS。
生产 Compose 将 `ACME_STATE_DIR` 固定为 `/var/lib/gateway/acme` 并挂载 `gateway_acme` volume，无需在 `.env.prod` 重复配置。

首次上线建议先把 `ACME_DIRECTORY_URL` 临时设为 Let's Encrypt staging：

```dotenv
ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory
```

连通性验证成功后再切回生产 directory。Gateway 会识别 directory 变化，忽略 staging 证书与账户状态并为生产 CA 重新签发，避免把不受信任的 staging 证书继续用于 HTTPS。

## 4. 首次部署

统一入口是 `scripts/docker/deploy.sh`（**唯一推荐路径**）。它做四件事：校验 `.env.prod` 必填项 →
`docker compose config` 校验 → 构建/备份旧镜像 → 启动并等待 Portal/Gateway 健康检查。
任何一步失败立即退出并打印最近日志，不会静默成功。

```bash
cp .env.example .env.prod   # 按 §3 填写生产参数（LETSENCRYPT_DOMAIN 等）
./scripts/docker/deploy.sh --check # 只校验配置（环境必填项 + compose config），不启动
./scripts/docker/deploy.sh         # 构建 + 迁移/seed + 启动 + 健康检查
```

`deploy.sh` 的完整模式（`--no-build` / `--status` / `--rollback` / `--down` / `--help`）以 `./scripts/docker/deploy.sh --help`
的输出为准；其中 `--status` 会先做环境校验再 `compose ps`，`--rollback` 只切镜像不回滚数据（见 §4.1）。

部署顺序（Compose 依赖已声明，无需手工干预）：

1. `postgres`/`redis` 健康后，一次性 `db-init` 执行 `pnpm db:migrate && pnpm db:seed`
   （schema、内置 RBAC、portal client 幂等就绪）；
2. `portal` 在 `db-init` 成功后才启动，并通过 `/api/health` 健康检查；
3. `gateway` 在 `portal` healthy 后才启动，监听 80/443 并恢复/创建 ACME 账户。

```bash
docker compose --env-file .env.prod -f docker/compose/prod.yml ps
docker compose --env-file .env.prod -f docker/compose/prod.yml logs -f gateway
```

升级部署：重复执行 `./scripts/docker/deploy.sh`（会先给当前镜像打 `:previous` 标签）。
不重建镜像时用 `--no-build`；停止服务用 `./scripts/docker/deploy.sh --down`（保留数据目录与 `gateway_acme` 卷）。

### 4.1 回滚与数据备份

- **镜像回滚**：`./scripts/docker/deploy.sh --rollback` 把 `auth-sso-portal:previous` / `auth-sso-gateway:previous`
  切回 `:latest` 并重启；**数据库 schema/数据不会自动回退**。
- **部署前必须备份**：`data/postgres/` 是宿主机 bind mount，建议在升级前 `pg_dump` 或停机快照；
  回滚镜像后若 schema 已前滚，需用备份恢复数据。
- 健康检查失败时脚本只打印日志并退出，不自动重建/清空数据——避免把可恢复故障放大成数据事故。

启动顺序无需人工干预：

1. Gateway 先监听 80/443，并在 Rust 后台服务中恢复或创建 ACME 账户。
2. Gateway 创建 order，将 HTTP-01 token/key-authorization 发布为无锁内存快照。
3. Let's Encrypt 访问 80 端口完成验证；Gateway 生成 ECDSA P-256 私钥和 CSR 并下载完整证书链。
4. Gateway 先校验证书链和私钥匹配，再原子持久化并原子替换 TLS 内存快照，无需重启。

首次签发前 HTTPS 握手不可用是预期的短暂引导状态；80 端口的 challenge 路径仍可用，其他 HTTP 请求继续返回 HTTPS 重定向。

## 5. 验证

```bash
docker compose --env-file .env.prod -f docker/compose/prod.yml logs gateway
curl -I http://portal.example.com
openssl s_client -connect portal.example.com:443 -servername portal.example.com </dev/null 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

预期结果：

- 普通 HTTP 请求返回 301 到 HTTPS；签发期间精确的 `/.well-known/acme-challenge/{token}` 由 Gateway 内存直接提供。
- Gateway 日志出现“ACME 账户已创建并持久化”和“ACME 证书已持久化并原子热加载”。
- HTTPS 证书的 SAN、签发者和有效期正确。
- `gateway_acme` volume 的核心持久状态为 `account.json` 与 `certificate.json`，状态目录为 `0700`、文件为 `0600`；写入被中断时可能短暂保留同名 `.next` 临时文件，后续写入会覆盖它。

## 6. 自动续期与故障行为

Gateway 优先使用 ACME Renewal Information（ARI）建议窗口，并以证书摘要在窗口内选择稳定、均匀分布的续期时刻；CA 不支持 ARI 或查询失败时，回退到证书实际生命周期的三分之二处，不假设固定的 90 天证书或“提前 30/60 天”。

证书维护默认每 6 小时复核。网络、CA、challenge 或持久化失败时按 60 秒到 1 小时指数退避，并继续使用上一有效 TLS 快照。新证书只有在以下步骤全部成功后才生效：

1. 完整证书链与私钥能够解析且公钥匹配；
2. 证书 bundle 已完成原子持久化；
3. `ArcSwapOption` 内存快照已原子替换。

CI 使用 Pebble v2.8.0 真实执行 HTTP-01 协议，不向公共 CA 消耗速率限制：

```bash
pnpm test:e2e:acme
```

该门禁从无证书状态启动真实 Gateway，依次断言首次签发、HTTPS 同进程热上线、TLS 链与域名、`0700/0600` 状态权限、进程重启恢复，以及 CA 停止后保留上一证书。证据写入 `.context/compound-engineering/acme-e2e/latest/`，CI 同步上传 artifact。Pebble 官方发布包按 v2.8.0 和 SHA-256 固定；测试根证书只能通过 `ACME_CA_CERT_PATH` 在非生产环境加载，生产配置显式拒绝该变量。

首次公网部署还必须在域名已解析、入站 80/443 可达的目标主机执行一次 Let's Encrypt staging 演练：

```bash
LETSENCRYPT_STAGING_DOMAIN=staging-sso.example.com \
LETSENCRYPT_STAGING_EMAIL=ops@example.com \
ACME_STAGING_PUBLIC_REACHABLE=true \
pnpm test:e2e:acme:staging
```

该脚本使用公共 staging directory，验证首次签发无需重启和持久化证书的重启恢复，实际演练证据写入 `.context/compound-engineering/acme-staging/latest/`。公网 staging 依赖真实 DNS 与网络条件，不进入普通 CI。脚本会在访问 Docker 和公共 CA 前拒绝单标签域名及 `.local`、`.localhost`、`.test`、`.example`、`.invalid` 保留后缀，校验联系邮箱，并要求 `ACME_STAGING_PUBLIC_REACHABLE=true` 作为“DNS 已生效且公网 80/443 已放通”的操作员声明；该声明只防止误操作，最终可达性仍由 Let's Encrypt HTTP-01 验证证明。前置条件缺失或无效时在独立的 `acme-staging/preflight/summary.txt` 写入对应阻塞状态并以状态码 2 退出，不覆盖既有公网通过证据；进入执行但未完成时保留 `status=failed_or_incomplete`；全部断言通过后才写入 `status=passed`。

`8.8.8.8` 是递归 DNS 解析器地址，不能替代域名的 A/AAAA 记录，也不能让外部 CA 访问本机。没有公网入口时继续使用 `pnpm test:e2e:acme` 的 Pebble 本地闭环，不能把它记为公共 staging 通过。

本地开发和发布 E2E 继续使用只包含 loopback SAN 的运行时临时自签证书，因为 Let's Encrypt 不为 `localhost` 签发证书；该路径位于 `docker/compose/test.yml`，与生产 ACME 路径隔离——完整用法见 **§7**。

参考：

- [Let's Encrypt Challenge Types](https://letsencrypt.org/docs/challenge-types/)
- [Let's Encrypt Best Practice — Keep Port 80 Open](https://letsencrypt.org/docs/allow-port-80/)
- [ACME Renewal Information（ARI）](https://letsencrypt.org/docs/ari/)
- [instant-acme 0.8.5](https://docs.rs/instant-acme/0.8.5/instant_acme/)

## 7. 本地开发 / 发布验收（`docker/compose/test.yml`，与 CI 同路径）

> 结论：**构建、部署、验收 e2e 全部走 Docker**。host 进程只用于断点调试。
> 2026-10-20 实测（离线镜像）：`pnpm stack:build` 成功（portal 的 `next build` 走 Next 16 默认
> **Turbopack**：`✓ Compiled successfully in 10.5s`；gateway `cargo build --release`）、
> `pnpm stack:up` 全健康、`pnpm test:e2e` **1/1 通过**。
>
> **host 进程入口已移除**：`pnpm dev` / `dev:*` / `dev-gateway-stack.sh` / `check-portal-boot.sh` /
> `verify-turbopack-container.sh` 全部删除；`tests/e2e` 只保留 Docker 验收闭环（无 host `next dev` webServer）。

### 7.1 运行入口

| 入口 | 用途 | 何时用 |
|---|---|---|
| **`scripts/docker/stack.sh`** | **统一入口**：`up / build / status / logs / e2e / down / clean` | 日常 |
| `scripts/e2e/release.sh` | `pnpm test:e2e` 实现（`stack.sh e2e --build` + 退出清理；`E2E_KEEP_STACK=1` 保留） | 验收闭环 |
| `scripts/e2e/acme-e2e.sh` / `scripts/e2e/acme-staging.sh` | ACME 验收 | `pnpm test:e2e:acme[:staging]` |
| `scripts/docker/deploy.sh` | 生产部署（§4） | 上线 / 回滚 |

> 文件职责与有效性见文首「文件有效性审计」；脚本归属规则见 [`scripts/README.md`](../scripts/README.md)。

### 7.2 常用命令（命令的唯一维护处；其他文档只引用本节）

`pnpm stack:*` 只是 `scripts/docker/stack.sh` 的薄封装（见根 `package.json`）；`clean` 没有 pnpm 别名，只能走脚本。
下面每条都对应脚本里的真实分支（`scripts/docker/stack.sh` 的 `case`）；改脚本时同步本表——这是命令的唯一维护处。

```bash
pnpm stack:build         # 只构建：portal + gateway + cert-init + db-init（test.yml 前 6 个服务里的 4 个可构建项）
pnpm stack:up            # 起栈并等待健康（复用镜像；缺镜像请先 build）
./scripts/docker/stack.sh up --build   # 先构建再启动
pnpm stack:status        # 服务状态（compose ps）
pnpm stack:logs portal   # 跟随日志（不传服务名=全部；gateway/postgres/redis 同理）
pnpm stack:down          # 停机并删卷（compose down --volumes --remove-orphans；脚本注释写的是"保留卷"，行为以代码为准，见 7.6）
./scripts/docker/stack.sh clean        # down + 删本仓镜像（--rmi local）；无 pnpm 别名
./scripts/docker/stack.sh e2e [--build]  # 起栈后跑 tests/e2e 下全部 spec；**不自动停机**
pnpm test:e2e            # release.sh：stack.sh e2e --build → 跑完自动 stack.sh down（默认构建）
SKIP_BUILD=1 pnpm test:e2e          # 复用镜像（不传 --build）；该变量只被 release.sh 读取
E2E_KEEP_STACK=1 pnpm test:e2e      # 跑完保留栈（跳过退出清理），便于继续看 UI
```

**入口**：`https://127.0.0.1:19443`（gateway，自签证书；`curl -k` / Playwright `ignoreHTTPSErrors`）。
portal 仅在 compose 网络内暴露 4000，不映射宿主端口。

### 7.3 栈与健康检查

| 服务 | 镜像 | 端口 | 健康检查 |
|---|---|---|---|
| postgres | postgres:16-alpine | 内部 5432 | `pg_isready` |
| redis | redis:7-alpine | 内部 6379 | `redis-cli ping` |
| cert-init / db-init（一次性） | 本仓构建 | - | 退出码 0（`Exited (0)` 属正常） |
| portal | `auth-sso-test-portal` | 内部 4000 | `/api/health` 200 |
| gateway | `auth-sso-test-gateway` | 容器内 80/443；**宿主只映射 19443 → 443**（80 不映射，宿主跑 `stack.sh` 时不受 80 占用影响） | `wget --no-check-certificate https://127.0.0.1:443/login` |

一次性服务显示 `Exited (0)` 是正常现象，`docker compose up --wait` 会正确放行。

### 7.4 构建注意

- **`BUILDX_CONFIG` 必须可写**：部分沙箱/CI 里 `~/.docker/buildx` 只读，直接 build 会报
  `open .../buildx/...: read-only file system`。`stack.sh` 默认把它指向 `<repo>/.tmp-buildx`（已 gitignore）
  ——这不是"构建不可用"，只是配置目录要可写。CI 直接调 `docker compose build`，不经过 `stack.sh`，故不受影响。
- portal 镜像里的 `next build` 走 **Next 16 默认 Turbopack**；gateway 镜像里 `cargo build --release`。
- 镜像名由 compose 项目名（`name: auth-sso-test`）+ 服务名决定，`docker compose build` 产出的镜像带 `latest` 标签：
  `auth-sso-test-portal:latest`、`auth-sso-test-gateway:latest`、`auth-sso-test-db-init:latest`、`auth-sso-test-cert-init:latest`
  （pebble profile 另有两个：`auth-sso-test-pebble:v2.8.0`、`auth-sso-test-pebble-challtestsrv:v2.8.0`，见 `compose/test.yml`）。

### 7.5 为什么不用 host 进程做验收

- CI/生产都是容器形态（standalone、非 root、容器网络、gateway TLS 终结）：验收必须与部署形态一致。
- 有些缺陷**只在容器环境才暴露**：Next 16 Cache Components 的 `instant` 路由声明、
  `Date.now()` 预渲染校验、服务端/浏览器 locale 差异导致的 hydration 不一致等。
- host 的 glibc/Turbopack、端口占用、DB 连接泄漏等噪声会干扰判断。

### 7.6 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| build 报 `read-only file system`（buildx） | 用 `stack.sh`（已设 `BUILDX_CONFIG`）；手工命令加 `BUILDX_CONFIG=$PWD/.tmp-buildx` |
| `Bind for 0.0.0.0:19443 failed` | 宿主有旧 gateway/进程占用：`ss -ltn \| grep 19443` 后停掉，或先 `pnpm stack:down` 再起 |
| `up` 报缺镜像 | 先 `pnpm stack:build` |
| cert-init/db-init `Exited` | 正常（一次性任务）；失败才看 `pnpm stack:logs db-init` |
| 浏览器证书告警 | 自签证书；验收用 `ignoreHTTPSErrors` / `curl -k` |
| e2e 连不上 | `pnpm stack:status`；确认 gateway healthy 且宿主 19443 映射存在 |
| 想保留现场（**数据会被删**） | `E2E_KEEP_STACK=1 pnpm test:e2e`，或 `pnpm stack:up` 后跑 `pnpm test:e2e:release` |
| 想保留**数据卷** | 不要在排查中跑 `pnpm stack:down` / `clean`（两者都是 `--volumes`）；只停容器用 `docker compose -f docker/compose/test.yml stop` |

### 7.7 CI 对应关系

CI 不走 `stack.sh`（`.github/workflows/validation-suite.yml` 的 `gateway-e2e` job）：
先 `docker compose … up --detach --build --wait` 起栈，再用 `mcr.microsoft.com/playwright` 容器（`--network host`）
执行 `pnpm test:e2e:release`（**只跑 `tests/e2e/docker-release.spec.ts` 一个 spec**，不是全部），最后收集日志并清理：

```bash
docker compose -f docker/compose/test.yml up --detach --build --wait --wait-timeout 600 \
  postgres redis cert-init db-init portal gateway
docker run --rm --network host -v "$PWD:/work" -w /work \
  -e E2E_TARGET=docker -e E2E_BASE_URL=https://127.0.0.1:19443 -e E2E_SKIP_SEED=true \
  mcr.microsoft.com/playwright:v1.60.0-noble bash -lc "… pnpm test:e2e:release"
docker compose -f docker/compose/test.yml logs --no-color > gateway-e2e.log
```

本地 `pnpm test:e2e` 与它是同一条路径（同 compose、同 base URL），差别有三处：
①本地跑 `tests/e2e` 下**全部** spec（`stack.sh e2e`），CI 只跑 release 闭环那一个；
②本地多了退出清理（`stack.sh down`）与 buildx 兜底（`BUILDX_CONFIG`）；
③浏览器用本机 Playwright（CI 用官方镜像）。

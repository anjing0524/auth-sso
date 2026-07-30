# Auth-SSO 生产环境 Docker 部署

生产拓扑以 Gateway 为唯一公网入口。Gateway 的 Rust 进程内建 ACME 客户端，直接向 Let's Encrypt 申请和自动续期证书；不依赖 Certbot、宿主机脚本或本地自签证书。

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

部署目录只需包含 Compose、生产环境变量和业务数据目录，不需要证书脚本或宿主机证书目录：

```text
/opt/auth-sso/
├── docker-compose.prod.yml
├── .env.prod
└── data/
    ├── postgres/
    └── redis/
```

当前实现面向单个域名和单个 Gateway 实例。若未来水平扩展 Gateway，应先增加 ACME leader election 或改用集中式证书控制器，避免多个实例同时写同一账户状态。

## 3. 配置

在 `.env.prod` 中提供现有应用密钥和以下证书参数：

```dotenv
LETSENCRYPT_DOMAIN=portal.example.com
LETSENCRYPT_EMAIL=ops@example.com
ACME_CHECK_INTERVAL_SECS=21600
ACME_DIRECTORY_URL=https://acme-v02.api.letsencrypt.org/directory

BETTER_AUTH_URL=https://portal.example.com
NEXT_PUBLIC_APP_URL=https://portal.example.com
PORTAL_REDIRECT_URL=https://portal.example.com/api/auth/callback
```

生产环境强制要求 `LETSENCRYPT_DOMAIN`、`LETSENCRYPT_EMAIL` 和 `GATEWAY_SHARED_SECRET`。域名必须是有效 DNS 名，ACME directory 必须使用 HTTPS。
生产 Compose 将 `ACME_STATE_DIR` 固定为 `/var/lib/gateway/acme` 并挂载 `gateway_acme` volume，无需在 `.env.prod` 重复配置。

首次上线建议先把 `ACME_DIRECTORY_URL` 临时设为 Let's Encrypt staging：

```dotenv
ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory
```

连通性验证成功后再切回生产 directory。Gateway 会识别 directory 变化，忽略 staging 证书与账户状态并为生产 CA 重新签发，避免把不受信任的 staging 证书继续用于 HTTPS。

## 4. 首次部署

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

启动顺序无需人工干预：

1. Gateway 先监听 80/443，并在 Rust 后台服务中恢复或创建 ACME 账户。
2. Gateway 创建 order，将 HTTP-01 token/key-authorization 发布为无锁内存快照。
3. Let's Encrypt 访问 80 端口完成验证；Gateway 生成 ECDSA P-256 私钥和 CSR 并下载完整证书链。
4. Gateway 先校验证书链和私钥匹配，再原子持久化并原子替换 TLS 内存快照，无需重启。

首次签发前 HTTPS 握手不可用是预期的短暂引导状态；80 端口的 challenge 路径仍可用，其他 HTTP 请求继续返回 HTTPS 重定向。

## 5. 验证

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml logs gateway
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

本地开发和发布 E2E 继续使用只包含 loopback SAN 的运行时临时自签证书，因为 Let's Encrypt 不为 `localhost` 签发证书；该路径位于 `docker-compose.test.yml`，与生产 ACME 路径隔离。

参考：

- [Let's Encrypt Challenge Types](https://letsencrypt.org/docs/challenge-types/)
- [Let's Encrypt Best Practice — Keep Port 80 Open](https://letsencrypt.org/docs/allow-port-80/)
- [ACME Renewal Information（ARI）](https://letsencrypt.org/docs/ari/)
- [instant-acme 0.8.5](https://docs.rs/instant-acme/0.8.5/instant_acme/)

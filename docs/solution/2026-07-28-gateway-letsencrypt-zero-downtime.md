# Gateway Rust 内建 Let's Encrypt 零重启证书生命周期

## 问题与错误方案复盘

生产 Compose 曾把被 Git 忽略的 `apps/gateway/ssl` 直接挂载到 Gateway，证书获取、续期和重载依赖人工操作。第一版修订又引入 Certbot 容器与 shell entrypoint，虽然解决了自动化，却把 Gateway 的核心传输安全生命周期拆成“Rust + shell + 共享 webroot + 多个卷”四个状态源，不符合“证书能力应由 Gateway 自身拥有”的架构边界。

同类问题归纳为：

1. 仓库或宿主机路径被当成生产证书来源，部署不可复现且容易误用开发自签证书。
2. Compose 中声明证书变量，但 Rust 配置未消费，形成表面配置与真实行为漂移。
3. 80 端口无条件重定向，无法完成 ACME HTTP-01。
4. Pingora 只在启动时加载证书，续期必须重启。
5. Certbot 脚本方案引入跨进程、跨文件的发布协议，证书链和私钥可能短暂不成对，且续期策略不受 Gateway 统一治理。

最终方案删除 Certbot 服务和脚本，由 Gateway Rust 进程完整负责 ACME。

## 架构决策

`apps/gateway/src/acme.rs` 使用 `instant-acme 0.8.5` 实现 RFC 8555 生命周期：

1. 从专用状态目录恢复 ACME 账户；无状态时创建账户并立即持久化 opaque credentials。
2. 创建单域名 order，选择 HTTP-01 challenge。
3. 把 token 和 key-authorization 发布到 `AcmeChallengeStore` 的 `ArcSwapOption` 单值快照。
4. `RedirectService` 只对当前精确 token 返回 200；其余 challenge 返回 404，普通 HTTP 继续 301。
5. challenge 验证完成后，由 `instant-acme`/`rcgen` 生成 ECDSA P-256 私钥和 CSR，并下载完整证书链。
6. 校验证书链可解析且 leaf 公钥与私钥匹配；持久化成功后才替换 TLS 内存快照。

首次没有证书时，Gateway 仍先监听 80/443。80 可以完成 challenge，443 在首张证书安装前无法握手；签发成功后无需进程重启即可恢复 HTTPS。这消除了“先有证书才能启动、先启动才能验证”的循环依赖。

## 自动续期策略

固定“90 天证书、提前 30/60 天续期”的假设已不可靠。Gateway 使用两级策略：

- 首选 ACME Renewal Information（ARI，RFC 9773）。以证书 DER 的 SHA-256 摘要在 CA 建议窗口内选择确定性时刻，使重启后调度稳定，同时让不同证书自然分散。
- CA 不支持 ARI、ARI 请求失败或证书无法生成 ARI 标识时，解析证书真实 `notBefore/notAfter`，在生命周期三分之二处续期。

正常复核间隔默认 6 小时。网络、CA、challenge 或持久化失败时从 60 秒指数退避到 1 小时；旧 TLS 快照始终继续服务。续期 order 带 `replaces` 标识，以便支持 ARI 的 CA 正确关联替换证书。

## 原子状态与热加载

ACME 状态目录权限为 `0700`，账户和证书文件为 `0600`。生产容器使用固定非 root UID/GID 10001，专用 `gateway_acme` named volume 只挂载到 Gateway。

证书链与私钥不分成两个发布文件，而是保存在同一个 `certificate.json` bundle：

1. 在目标目录创建固定临时文件并写入完整 bundle。
2. `fsync` 临时文件。
3. 同文件系统 `rename` 原子替换目标。
4. `fsync` 父目录，保证重启恢复的持久性。

bundle 同时绑定 `domain` 和 `directory_url`。域名或 CA directory 变化时旧证书不会进入内存，Gateway 会自动重新签发；这也避免从 staging 切到 production 后继续提供不受信任证书。

`TlsCertificateStore` 在安装前解析完整链、验证公私钥匹配，并将不可变快照放入 `ArcSwapOption`。`TlsAccept::certificate_callback` 每次握手只做一次 wait-free 原子读取，不访问磁盘，也不会观察到半更新证书对。

## 安全边界

- challenge token 仅允许 ASCII 字母、数字、`-`、`_`，长度 1–256；禁止 `/`、`.` 和目录穿越。
- key-authorization 只存在于当前 order 的内存 lease；order 验证结束或错误返回时通过 RAII 自动清除。
- challenge 响应设置 `Cache-Control: no-store`。
- ACME directory 必须使用 HTTPS；生产必须提供合法域名、联系邮箱和共享密钥。
- 生产不挂载 `apps/gateway/ssl`，不运行 Certbot，也不执行证书 shell 脚本。
- 当前实现为单域名、单 ACME 写者。多 Gateway 实例需要 leader election 或独立集中式证书控制器，不能共享 volume 并并发签发。
- 本地和 E2E 因 Let's Encrypt 不签发 `localhost`，继续使用运行时生成、仅含 loopback SAN 的短期自签证书；测试 Compose 与生产 ACME 路径严格隔离。

## 同类问题审阅

本次同步审阅了 Gateway 的端口、TLS、Redis、共享密钥、JWKS 刷新和无配置文件默认分支。所有新 ACME 环境变量都进入 `Config::apply_env_overrides()` 和统一启动校验，避免再次出现“部署声明了变量但进程未读取”的配置漂移。

生产 Compose 删除 Certbot service、webroot、证书发布卷及本地 `ssl` bind，仅保留 Gateway 自有状态卷。手动证书文件来源只在本地开发/E2E 启动时加载一次，不引入第二套轮询生命周期。

后续简化复审进一步沉淀出三条规则：

1. 生产 ACME 热更新与测试文件证书是两种明确模式。只有前者需要后台生命周期；为后者增加轮询服务、配置项和错误状态属于 YAGNI。
2. crate 直接使用 feature-gated API 时必须显式声明对应 feature，不能依赖其他依赖的 Cargo feature union 偶然启用。本实现直接使用 `tokio::net::TcpStream`，因此在自身 Tokio 依赖中声明 `net`。
3. 互斥运行状态使用枚举表达。续期判断从可组合出无效状态的 `due + replacement + next_check` 字段组收敛为 `Issue(replacement) | Wait(delay)`，让编译器保证分支完整性。

真实协议验收又暴露了四类测试基础设施问题，并形成同类预防规则：

1. 外部测试镜像标签不是可复现输入。Pebble 改为从官方 v2.8.0 Release 下载 amd64/arm64 二进制，并在镜像构建时校验固定 SHA-256。
2. 故障注入期间不能执行会隐式重建依赖的 `compose up --build`。验收先完成全部镜像构建，再暂停 CA，并用 `--no-deps` 启动 Gateway，保证“CA 不可用时启动”场景真实且稳定。
3. 静态验证地址必须和动态地址池隔离。只有 Gateway、Pebble 和 challenge server 接入 ACME 子网并使用明确地址；Gateway 同时接入默认网络访问 Redis，避免普通测试基础设施进入验证子网或抢占 HTTP-01 目标地址。
4. Compose profile 资源的清理必须显式启用同一 profile，否则失败现场会残留网络和容器。脚本的启动前清理和退出清理统一使用 `--profile acme down --volumes --remove-orphans`。
5. 干净检出必须包含协议 fixture。仓库继续全局忽略 `*.pem` 生产证书，但对三份固定的 Pebble 官方测试证书/测试私钥使用精确路径白名单，防止本地文件存在而 CI 检出缺失。
6. 外部验收的“未执行”必须与“执行失败”分离。公网 staging 脚本在访问 Docker/CA 前把缺失域名或邮箱记录到独立 `preflight/` 目录，避免覆盖已有公网通过证据；具备前置条件后在 `latest/` 先写 `failed_or_incomplete`，只有所有签发、热加载和恢复断言通过才覆盖为 `passed`，避免对话中的阻塞说明、预检结果或旧成功文件互相冒充。
7. 公共 CA 前置条件不能只检查非空。预检必须拒绝单标签、IP 字面量及保留后缀域名，校验联系邮箱，并要求操作员显式声明公网 80/443 已可达；仅按 DNS 标签正则检查会把 `127.0.0.1` 误判为合法多标签名称。`8.8.8.8` 一类递归解析器不是域名 A/AAAA 指向。声明只负责阻止已知无效执行，真实公网可达性仍由 CA 的 HTTP-01 结果证明。

## 验证基线

- Rust 单元/目标测试：`cargo test --all-targets --all-features`
- Rust 质量门禁：`cargo clippy --all-targets --all-features -- -D warnings`
- 格式：`cargo fmt --all -- --check`
- 生产 Compose 渲染：`docker compose --env-file <test-env> -f docker-compose.prod.yml config`
- 生产镜像：`docker build -f apps/gateway/Dockerfile .`
- 发布闭环：`scripts/run-gateway-e2e.sh`
- 本地真实协议闭环：`scripts/run-gateway-acme-e2e.sh`，使用 Pebble 验证首次签发、HTTP-01、无重启热加载、重启恢复和 CA 故障保留旧证书；证据目录为 `.context/compound-engineering/acme-e2e/latest/`
- 公网 CA 演练：`scripts/run-gateway-acme-staging.sh`，在真实 DNS 与公网 80/443 环境验证 Let's Encrypt staging 首次签发与重启恢复；`preflight/` 记录前置条件缺失，`latest/` 记录执行未完成或通过

CI 不向公共 CA 申请证书；真实 Let's Encrypt HTTP-01 必须在域名已解析且公网 80/443 可达的部署环境完成。

## 参考

- [RFC 8555 — Automatic Certificate Management Environment](https://www.rfc-editor.org/rfc/rfc8555)
- [RFC 9773 — ACME Renewal Information](https://www.rfc-editor.org/rfc/rfc9773)
- [Let's Encrypt Challenge Types](https://letsencrypt.org/docs/challenge-types/)
- [Keep Port 80 Open](https://letsencrypt.org/docs/allow-port-80/)
- [instant-acme 0.8.5](https://docs.rs/instant-acme/0.8.5/instant_acme/)
- [Pingora TLS callbacks](https://docs.rs/pingora-core/latest/pingora_core/listeners/tls/)

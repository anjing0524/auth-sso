# Gateway-first 交付入口收敛

## 问题

架构、ADR 和发布验收一直都明确 Browser 的第一跳必须是 Gateway，但仓库里的日常入口没有把这件事变成默认事实：

- 根 `pnpm dev` 只启动 Node 工作区应用，不包含 Rust Gateway，开发者最容易先在 `http://localhost:4100` 上验证“Portal 能打开”，却没有验证真实入口 `https://localhost:19443`。
- 根 `pnpm build` 只执行 `pnpm -r build`，不会构建 `apps/gateway` 的 release 二进制；发布拓扑所需的一半产物没进入默认构建路径。
- 本地默认 `pnpm test:e2e` 直接拉 `next dev` 跑 Portal 浏览器冒烟，证明的是“Portal 页面还在”，不是“Gateway 后置 Portal 的交付拓扑仍成立”。
- PR/Main CI 直到 2026-07-27 仍只在 tag 发布时运行 Gateway 闭环验收，意味着拓扑回归会在发布阶段才暴露。

## 决策

- 根 `pnpm dev` 改为 `scripts/dev-gateway-stack.sh`：先启动 `postgres`/`redis`，再并发拉起 `portal`、`demo` 和 `gateway`，让默认浏览器入口天然变成 Gateway。
- 新增 `dev:gateway`，允许调试者单独重启 Rust Gateway，而不是绕回“只开 Portal”。
- 根 `pnpm build` 增补 `cargo build --manifest-path apps/gateway/Cargo.toml --release`，同时显式提供 `build:gateway`。
- 根 `pnpm test:e2e` 改为 `scripts/run-gateway-e2e.sh`：自动拉起 `docker-compose.test.yml` 中的 Gateway 发布拓扑，并仅运行经 Gateway 的发布闭环用例。
- 直连 Portal 的 Playwright 用例保留，但显式降级为 `pnpm test:e2e:portal`，只服务于局部 UI/路由调试，不再冒充默认交付验证。
- PR/Main CI 新增 `gateway-e2e` job，直接复用 release validation 的同构流程，确保每次合并前都验证“Portal 在 Gateway 后面”这一拓扑事实。
- GitHub 三条触发链路进一步复用同一个 `validation-suite.yml`：PR、Main 与 tag release 都执行同一套 Gateway 发布旅程与质量门禁，避免再出现“发布才跑到更严格流程”的职责分叉。

## 原则

当 Gateway 是系统安全与登录流程的第一层边界时，任何“默认入口”只要绕开 Gateway，都会持续制造错误的反馈循环。开发者会以为系统可用，但实际上只验证了一个不交付的旁路。

因此，开发、构建、浏览器测试和主干 CI 的默认路径都必须落在同一条交付链路上：Browser → Gateway → Portal。局部直连调试可以保留，但必须变成显式、次级、带名字的例外路径。

## 验证

- `package.json` 中根 `dev` 现在通过 `scripts/dev-gateway-stack.sh` 启动 Gateway-first 联调栈。
- `package.json` 中根 `build` 现在会额外构建 `apps/gateway` 的 release 二进制。
- `package.json` 中根 `test:e2e` 现在通过 `scripts/run-gateway-e2e.sh` 自动拉起 `docker-compose.test.yml` 并执行 `tests/e2e/docker-release.spec.ts`。
- `.github/workflows/main.yml` 与 `.github/workflows/pr.yml` 现在都新增 `gateway-e2e` job，在主干与 PR 阶段提前运行 Gateway 发布旅程。
- `.github/workflows/release-validation.yml` 现在不再是单独维护的一套缩水校验，而是与 PR/Main 复用 `.github/workflows/validation-suite.yml`，共享同一套 Gateway 发布旅程与基础质量门禁。
- `README.md` 与 `docs/INTEGRATION_GUIDE.md` 已将 `https://localhost:19443` 明确为默认浏览器入口，并把直连 Portal 标记为仅供调试的旁路。

## 本次实证修复

在把默认闭环真正跑起来之后，额外暴露了三个此前被“Portal 直连可用”掩盖的运行时问题：

- Gateway Docker 镜像以非 root 用户运行，但未为 `log_dir = "logs"` 预创建可写目录，导致发布栈内 `gateway` 容器启动即 panic。现已在 `apps/gateway/Dockerfile` 中显式创建 `/app/logs` 并授权。
- Gateway 闭环与 CI 已进一步收敛到统一的 `docker-compose.test.yml`；该文件保留独立 `name:`，不再复用本地开发中的 `postgres`/`redis` 容器。
- Gateway 对 HTML 导航的识别原先直接读取 `Accept`/`RSC` 大写头名，真实 HTTP/2 浏览器请求使用小写头时会误判为 API，导致 `/dashboard` 首跳返回 `401`。修复后同时兼容大小写，并新增回归测试。
- Gateway 在 OAuth 跳转与 callback `redirect_uri` 上曾用 loopback 主机名推断 `http`，结果把浏览器导向 `http://127.0.0.1:19443/...` 这种“明文协议 + TLS 端口”的非法地址，Playwright 表现为 `ERR_EMPTY_RESPONSE`。现已在 Gateway 主代理链路中把浏览器协议事实固定为 HTTPS，并补齐回归测试。
- Gateway 发布栈的 `cert-init` 曾从被 `.gitignore` 排除的 `apps/gateway/ssl` 复制 PEM；本地因恰好存在证书而通过，干净 CI 则以 `cp: can't stat` 失败。测试拓扑现改为通过 `apps/gateway/Dockerfile` 的专用 `cert-init` target 固化 OpenSSL，并在一次性 `gateway_certs` named volume 中生成含 `127.0.0.1`/`localhost` SAN 的短期自签证书。启动期不再安装软件或读取宿主机私钥，volume 在旅程结束后随 compose 栈销毁。

最终以本地实测 `scripts/run-gateway-e2e.sh` 通过为证据：浏览器从 `https://127.0.0.1:19443/dashboard` 首跳进入 Gateway，触发 PKCE → 登录 → OAuth callback → Secure Cookie 下发 → 登出闭环全部成功；专用 `cert-init` 镜像在 `--no-build` 启动路径下也完成同一场景，证明验收运行期不依赖宿主机证书或包仓库。

# ADR-030: 部署目标收敛为两个生产目标

| 属性 | 值 |
|---|---|
| **状态** | accepted (2026-10-29) |
| **日期** | 2026-10-29 |
| **决策者** | Auth-SSO 运维/部署收敛 |
| **影响范围** | `README.md`、`docker/README.md`、`docs/INTEGRATION_GUIDE.md`、`docs/README.md`、`vercel.json`、`docker/compose/*` |

## 背景

仓库同时存在 `prod.yml`、`test.yml`、`local.yml`、`acme-staging.yml`、`vercel.json` 与已移除的 host 进程入口。
文档曾把它们并列成“部署形态”，读者会误以为有 5–6 条生产部署方向；实际只有两类生产目标，
其余分别是验收、开发依赖和一次性验证。

## 决策

1. **生产目标 P1：自托管 Docker Compose（唯一日常运维主路径）**
   - 入口：`docker/compose/prod.yml` + `scripts/docker/deploy.sh`；
   - Gateway 内建 ACME、TLS 热加载、生产数据卷与镜像回滚；
   - 备份、升级、回滚、证书和健康检查均以此路径为准。
2. **生产目标 P2：Vercel 平台托管变体（受 NFR-SEC-01 约束的辅助目标）**
   - 入口：`vercel.json` + `docker/images/vercel.Dockerfile`；
   - 由平台终结 TLS，单镜像内 Gateway + Portal；
   - 不是日常运维主路径，也不替代 P1 的备份/回滚/ACME 流程。
3. **以下不是部署方向**：
   - `docker/compose/test.yml`：发布验收 / CI 栈；
   - `docker/compose/local.yml`：本地 PostgreSQL/Redis 依赖；
   - `docker/compose/acme-staging.yml` + `scripts/e2e/acme-staging.sh`：首次公网 ACME 演练/验证；
   - host 进程入口：已移除。
4. **文档单一入口**：`docker/README.md` 顶部维护部署目标矩阵；根 `README.md` 只保留主路径命令与平台变体链接；
   `docs/INTEGRATION_GUIDE.md` 只列验收栈、自托管生产、Vercel 平台三行拓扑。
5. **保留 Vercel 的条件**：`docs/spec/REQUIREMENTS_MATRIX.md` 的 NFR-SEC-01 仍要求平台部署与
   `--no-default-features` 双构建门禁；只有该需求被正式取消时，才删除 Vercel 目标及其 CI 构建。

## 不在本 ADR 范围

- Kubernetes / 多区域 / 水平扩展 Gateway（当前单域名单实例，扩展需 ACME leader election 或集中证书控制）。
- 监控平台选型；本 ADR 只定义部署目标与运维主路径，不引入新监控组件。

## 后果

- **正面**：读者只需理解“自托管主路径 + Vercel 平台变体”；test/local/staging 不再被误认为生产部署选择。
- **代价**：Vercel 变体仍需维护 CI 构建与 `gateway.vercel.toml`，直到 NFR-SEC-01 变更；这是一条有明确需求来源的受控成本。
- **复审条件**：NFR-SEC-01 取消、或出现第二个需要长期维护的平台目标时，重新评估本 ADR。

## 验证

- 文档守卫（`docs-claims` / `docs-references`）通过；
- 根 README / docker README / INTEGRATION_GUIDE 不再把 host/test/local/staging 称为生产部署方向；
- ADR 计数同步为 30 篇。

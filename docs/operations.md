# 生产运维手册（自托管 P1）

> 适用对象：交付/运维工程师。部署目标只有自托管生产与 Vercel 平台两个，本手册只覆盖**自托管生产**；
> 命令与 Compose 文件矩阵以 [`docs/docker.md`](docker.md) 为准，本手册不重复 Docker 细节。

## 1. 上线前检查清单

- [ ] `.env.prod` 已按 `docs/docker.md` §3 填全；文件权限 `chmod 600 .env.prod`；
- [ ] `LETSENCRYPT_DOMAIN` 的 A/AAAA 已指向本机，入站 80/443 可达；
- [ ] 服务器时间同步（ACME 与 JWT 都依赖时钟）；
- [ ] 备份目录可写，磁盘剩余空间 ≥ 数据库大小的 3 倍；
- [ ] `pnpm deploy -- --check` 通过；
- [ ] 已明确回滚版本与备份位置；
- [ ] 已确认单实例限制（见 §9），没有把它当 HA 集群使用。

## 2. 首次部署

```bash
cp .env.example .env.prod
chmod 600 .env.prod
pnpm deploy -- --check     # 只校验，不启动
pnpm deploy                # 构建 → 迁移/seed → 启动 → 健康检查
```

部署脚本会在升级前自动执行数据库备份；首次部署数据库未运行时会跳过备份。
需要显式跳过备份时设置 `SKIP_BACKUP=1`，但这会放弃升级前的恢复点，不建议。

## 3. 日常升级与回滚

```bash
pnpm deploy                # 升级；会先备份数据库、再打 :previous 镜像标签
pnpm deploy -- --status    # 容器状态
pnpm deploy -- --rollback  # 只切回上次镜像，不回滚数据库
```

回滚后如 schema 已前滚，必须用 §4 的备份恢复数据；**镜像回滚不等于数据回滚**。

## 4. 备份与恢复

### 4.1 手动备份

```bash
./scripts/docker/backup.sh
# 产物：backups/auth-sso-YYYYmmdd-HHMMSS.dump + .sha256
```

脚本会：

- 用 `pg_dump -Fc` 导出 `auth_sso`；
- 用 `pg_restore --list` 校验 dump 可读；
- 生成 SHA-256 校验文件；
- 目录权限 `700`、文件 `600`。

建议每日至少一次，并把备份复制到**另一台主机/对象存储**；本仓库不提供异地备份。示例 cron：

```cron
0 2 * * * cd /opt/auth-sso && ./scripts/docker/backup.sh >> /var/log/auth-sso-backup.log 2>&1
```

备份保留期按客户合规要求设置；至少保留一份**跨主机/跨区域**副本。

### 4.2 恢复（危险操作）

```bash
./scripts/docker/restore.sh backups/auth-sso-YYYYmmdd-HHMMSS.dump --yes
```

恢复流程是安全的“新库恢复 + 原子换名”：

1. 校验 dump；
2. 先给当前库再备份一次；
3. 停 Portal/Gateway；
4. 恢复到隔离库 `auth_sso_restore`；
5. 校验 `users` 可读后，`DROP auth_sso` + `RENAME auth_sso_restore → auth_sso`；
6. 启动服务并等待 Portal 健康。

失败在换名前会中止，原库仍在；恢复完成后必须做一次登录冒烟。

### 4.3 恢复演练

交付前至少在验收环境演练一次：

```bash
# 验收栈也可用同一脚本（仅覆盖 compose/env 参数）
COMPOSE_FILE=docker/compose/test.yml ENV_FILE=/dev/null \
  BACKUP_DIR=/tmp/authsso-backups ./scripts/docker/backup.sh
COMPOSE_FILE=docker/compose/test.yml ENV_FILE=/dev/null \
  BACKUP_DIR=/tmp/authsso-backups ./scripts/docker/restore.sh <dump> --yes
```

演练通过标准：脚本 exit 0、Portal `/api/health` 返回 200、管理员可登录、关键表行数符合预期。

## 5. 健康检查与可观测性

| 探针 | 地址 | 含义 |
|---|---|---|
| Portal 健康 | `GET /api/health` | DB + Redis 都可用返回 200；任一失败 503 |
| Gateway 存活 | `GET /healthz` | 进程存活；只接受 GET/HEAD |
| 业务就绪 | `GET /login` → 200 | TLS/证书/上游链路可用 |

当前仓库**不绑定外部监控平台**，也没有内置 Prometheus 指标。商用部署至少应在网关/宿主机补充：

- 容器健康状态与重启次数告警；
- `/api/health` 5xx 告警；
- 磁盘、inode、备份任务失败告警；
- ACME 证书到期告警（剩余 < 14 天）。

### 5.1 Prometheus 抓取

Gateway 已提供受保护的 Prometheus 文本端点：

```bash
curl -fsS -H "X-Gateway-Metrics-Key: $GATEWAY_METRICS_TOKEN" \
  https://<domain>/__gateway/metrics
```

`GATEWAY_METRICS_TOKEN` 未配置时会回退 `GATEWAY_SHARED_SECRET`；建议单独配置 ≥16 字符随机值。
不要把 metrics 端点直接暴露给无鉴权的公网抓取器。

### 5.2 建议告警

- `/api/health` 连续 3 次 503；
- Gateway 容器重启次数 > 0；
- 磁盘使用率 > 80%、inode > 80%；
- 备份任务失败或 24h 无新备份；
- 证书剩余有效期 < 14 天；
- 登录失败率 / 429 突增。

日志：容器 `json-file` 已限制 10MB × 3；业务日志走结构化日志/审计表。不要只依赖 `docker logs` 做长期留存。

## 6. 证书与 ACME

- 首次部署由 Gateway 内建 ACME 签发；首次 HTTPS 握手前短暂不可用是预期；
- `ACME_CHECK_INTERVAL_SECS` 默认 6h；证书续期自动热加载；
- 公网 staging 演练：`./scripts/e2e/acme-staging.sh`（需要真实 DNS 与公网 80/443）；
- 证书状态目录 `gateway_acme` 卷必须持久化；回滚/重启不能删除该卷。

## 7. 数据保留与容量

- `access_logs` 按月分区；分区维护不是自动任务，需宿主 cron/调度器定期执行项目内维护脚本；
- 审计/登录日志保留期由业务与合规要求决定，当前仓库没有自动归档/删除策略；
- 备份保留建议：日备 7 天、周备 4 周、月备 12 个月（按客户合规要求调整），并定期做恢复抽样。

## 8. 故障处置

| 现象 | 先做什么 |
|---|---|
| `/api/health` 503 | 看 `portal` 日志；分别验证 PostgreSQL/Redis；必要时恢复备份 |
| Gateway 502 | 查 Portal 健康；再查 Gateway upstream/路由配置 |
| HTTPS 失败/证书过期 | `docs/docker.md` ACME 故障排查；确认 80/443/DNS/`gateway_acme` 卷 |
| 磁盘满 | 停非必要服务；清理旧日志/旧备份；不要删 `data/postgres` |
| 发布后异常 | `pnpm deploy -- --rollback` 切镜像；数据问题走备份恢复 |
| Redis 故障 | 会话/权限缓存降级路径需验证；不要把它当唯一数据源 |

## 9. 已知边界（交付时必须向客户说明）

- **单实例**：当前 Gateway/Portal 都是单实例，不是高可用集群；没有多副本 leader election；
- **无内置外部监控/告警**：需要客户或交付团队接入；
- **无自动异地备份/自动恢复演练**：备份脚本已提供，调度与异地存储需运维配置；
- **Vercel 平台目标**受 NFR-SEC-01 约束，不是自托管运维主路径；
- 真实域名 ACME、备份恢复、回滚、容量压测必须在客户环境完成验收，仓库测试不能替代。

## 10. 交付验收证据

```bash
pnpm test
pnpm test:e2e
pnpm deploy -- --check
./scripts/docker/backup.sh
# 在验收环境执行 restore.sh 并完成登录冒烟
curl -fsS https://<domain>/api/health
curl -fsS https://<domain>/healthz
```

验收记录至少包含：版本/提交 SHA、部署命令、备份文件校验值、恢复演练结果、健康检查响应、回滚验证、证书到期日。

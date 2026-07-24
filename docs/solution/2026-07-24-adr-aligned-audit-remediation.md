# ADR 对齐的审计整治

## 背景

2026-07-23 全量审计发现 OAuth 授权码重放、scope 过度授予、权限码迁移残留、Gateway Discovery issuer 降级、空库迁移不可用和运行韧性缺口。整改必须以 ADR-006~009 为边界：AT/RT 是用户级全局会话，`iss`/`aud` 固定为 `auth-sso`，Gateway 不校验 `aud`，并且 Gateway 不承载业务权限分发。

## 决策与实现

- 授权码采用带 `used = false` 与未过期条件的 `UPDATE … RETURNING` 一次领取；scope 按空白分词、去重，并限定为 Client 已注册 allow-list 的子集。
- Access Token 保存已授权 scope；UserInfo 仅始终返回 `sub`，`profile` 与 `email` 分别解锁对应 claims。
- Refresh Token 继续不绑定 Client；这不是遗漏，而是 ADR-006 的用户级会话模型。revoke 的跨 Client 影响同样是该模型的预期语义。
- 全部 Portal Controller/Action 改为直接导入 `@auth-sso/contracts` 权限常量，删除运行时旧前缀归一化。
- Discovery 缺少 issuer 时拒绝刷新，保持最近完整 JWKS 快照；生产环境缺少 `GATEWAY_SHARED_SECRET` 启动失败。Gateway 仍显式保留 `validate_aud = false`。
- 迁移历史收敛为 `0000_initial.sql`：真实复合主键、完整索引、`access_logs` 月分区；初始化动态创建当月和下月分区。GitHub Actions 每月执行维护脚本，CI 使用 `db:migrate`。
- Redis 离线队列关闭并设置有限重试；批量权限缓存/会话撤销按 50 个用户分批。Gateway 提供由共享密钥保护的 `/__gateway/metrics` Prometheus 文本端点。
- 用户、角色、部门、权限和 Client 领域对象以 `Temporal.Instant` 表达时间；Drizzle `Date` 仅在持久化适配函数中转换。Redis 懒连接以单一等待路径协调，避免鉴权与暴力破解检查并发触发时误判 Redis 不可用。

## 验证与运维要点

- 空库验证必须同时清除 `public` 与 `drizzle` schema；只删 `public` 会保留 Drizzle 迁移记录，产生“表不存在但 migration 已完成”的假象。
- 已在本地空库执行 `db:migrate`、`db:seed`，确认表、复合主键和两个 access-log 分区存在。
- 分区任务使用部署环境的 `DATABASE_URL` GitHub Secret；任务失败会使 workflow 失败，作为可观测告警入口。
- 后续改动的最小回归集：OAuth scope/domain 测试、API 测试、Portal lint/typecheck、Gateway fmt/clippy/test，以及 `git diff --check`。
- Playwright 覆盖登录至授权码签发的浏览器旅程；回调 Token 兑换由 Gateway 生成的 PKCE/CSRF Cookie 负责，作为独立边界验证，避免测试绕过该安全前置条件。
- Gateway Docker build 与 runner 均固定 Docker Official Image 的 multi-platform manifest digest；升级基础镜像必须显式更新 digest，并重新执行 Rust 与容器构建验证。
- Portal 集成测试共享 `TRUNCATE` 隔离的数据库，Vitest 项目显式限制为单 worker，避免固定 fixture ID 在项目模式下并发写入造成非确定性失败。

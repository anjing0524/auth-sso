# 本地测试库必须可自举

## 问题

Portal 的 Vitest 与 API 测试默认连接 `auth_sso_test`，但本地 `docker-compose.yml` 只初始化了 `auth_sso`。结果是开发环境容器虽然健康，测试却会在全局 setup 阶段卡住或失败，迫使人临时改用业务库跑测试，破坏了测试隔离。

## 决策

- `vitest.globalSetup.ts` 在连接测试库前，先连接 PostgreSQL 管理库 `postgres`，检查目标数据库是否存在；缺失时自动创建。
- `docker/init-db.sql` 在开发环境首次初始化时同时创建 `auth_sso_test`，让新卷第一次启动就具备测试前置条件。
- 全局 setup 的错误信息必须直接说明：Portal 测试依赖宿主机 `5432` 暴露的 PostgreSQL，以及开发环境应使用 `docker compose up -d postgres redis`。

## 原则

测试环境前置条件不能靠口头约定或手动补库。凡是仓库默认命令依赖的数据库、缓存、队列等资源，都应满足“新环境拉起后可自举”，否则测试失败会被误判成业务代码问题。

## 验证

- 在仅启动 `docker-compose.yml` 的 PostgreSQL/Redis 后，直接运行 Portal Vitest 用例，无需手工 `CREATE DATABASE auth_sso_test`。
- 全局 setup 日志会明确显示测试库检查/创建过程。
- 健康检查用例已在 `auth_sso_test` 约定下跑通，证明本地测试前置与 CI 约定重新一致。

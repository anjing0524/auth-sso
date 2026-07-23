# packages / apps 审计问题修复设计

> 日期：2026-07-23  
> 状态：已确认设计，待实施计划审阅  
> 范围：`docs/audit/2026-07-23-packages-apps-code-audit.md` 中 P0-1、P1-1～P1-5、P2-1～P2-2

## 目标与边界

修复本轮审计确认的问题，不改变 OIDC 协议、对外成功响应结构、RBAC 数据模型或 Gateway 的 Pingora 集成方式。

安全敏感写操作采用同步审计：业务写入与审计记录必须在同一数据库事务中成功，否则业务回滚。访问日志仍为可丢失的异步观测数据。

## 设计

### 1. 角色分配的原子性与输入边界

`POST /api/users/[id]/roles` 与 `DELETE /api/users/[id]/roles` 使用 Zod 解析 body：所有 ID 必须为 UUID，数组必须非空、数量受限且无重复。

`POST` 的一个 `db.transaction()` 完成：

1. 重读目标用户与操作者的数据范围；
2. 用当前 `tx` 查询全部角色，验证数量、部门归属和 ACTIVE 状态；
3. 替换 `user_roles`；
4. 插入安全审计记录；
5. 提交后刷新权限缓存、撤销访问令牌并失效页面缓存。

校验函数显式接收 transaction，不得在 transaction 回调内调用全局 `db`。这样角色状态或部门的并发变更不会使“校验通过”和“写入绑定”分属不同连接。

`DELETE` 同样在事务内重读用户、校验数据范围、删除精确绑定并记录审计；未绑定角色保持幂等成功。

### 2. 同步安全审计与异步访问日志分级

审计模块提供一个接受 Drizzle transaction 的安全审计写入函数。角色、权限、客户端密钥、强制登出及其他授权决策写操作在自身事务内调用它。

访问日志继续使用异步写入和尽力重试；它服务于观测，不承诺审计级交付。守卫不再在业务成功后自行发起未等待的安全审计，避免重复记录与丢失窗口。

登录/登出/刷新日志作为安全事件改为等待写入；不在本次引入 outbox、队列或新表。低频写操作接受审计数据库短暂故障会导致请求失败这一明确语义。

### 3. 分层与 REST 错误响应

`mapDomainError()` 仅执行异常到 `{ status, error, message }` 的确定性映射，不记录日志。`withAuth`/`withPermission` 保留原始异常并在映射到 5xx 时使用 logger 记录。

`withPermission()` 的所有失败响应统一为 REST `{ error, message }`；`success` 继续只属于 Server Action 的 `ApiResponse`。OAuth 端点保持 RFC 6749 专用错误格式。

### 4. 权限读模型分页

新增分页读模型，以 `{ type, page, pageSize }` 执行 `count + limit + offset`，返回 `{ data, pagination }`。`GET /api/permissions` 调用该读模型，移除内存切片。

管理 UI 若需要完整权限集合，使用独立、命名明确的全量树读模型；两者复用字段投影、排序和 `permissions-list` 缓存标签，写操作仍通过既有 `updateTag()` 失效。

### 5. 共享契约与 Rust 框架边界

删除仓内无消费者的 OIDC TypeScript 接口；保留被 Portal/Gateway 实际使用的 OIDC 常量与类型。该 package 为 private，仍通过全仓搜索和 contracts 测试确认无内部破坏。

`async_trait` 保留在 Pingora 外部 Trait 的实现处。新增架构约束说明：项目自定义、需要 Send 的 Rust async Trait 必须返回 `impl Future + Send`；仅第三方 Trait 要求时允许宏适配。

## 失败策略

| 场景 | 结果 |
|---|---|
| 无效或重复角色 ID | 400，稳定业务错误，不触发 DB 约束异常 |
| 角色不存在、已禁用或跨部门 | 400，事务不写入 |
| 操作者无数据范围 | 403，事务不写入 |
| 安全审计写入失败 | 事务回滚，请求失败 |
| 访问日志写入失败 | 记录服务端错误，不影响业务 |
| Redis 缓存刷新/令牌撤销失败 | 保持现有安全策略，测试覆盖其显式失败行为 |

## 测试与验收

- 用户角色 API：非法 UUID、重复 ID、空数组、不存在角色、禁用角色、跨部门角色、精确移除、审计失败回滚。
- 审计：安全写操作写入与业务写入同事务；访问日志仍不阻断。
- REST 守卫：401/403/500 均只返回 `{ error, message }`。
- 权限 API：验证 SQL 级分页的 data、total 与边界页；管理页面保持完整树行为。
- contracts：已删导出无内部引用，OIDC 常量测试通过。
- 全量验证：`pnpm lint`、`pnpm typecheck`、`pnpm test`；若改动 Rust 文档外的 Rust 代码，再运行 fmt、clippy、test。

## 非目标

- 不引入 audit outbox、消息队列或新数据库表。
- 不重构所有 REST Controller，仅触及本轮问题相关路径。
- 不删除 Pingora 所需的 `async_trait` 依赖。
- 不修改 OAuth/OIDC 成功与 RFC 错误响应。

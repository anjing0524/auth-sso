# 修复 Docker 配置白名单 + 零信任行为变更文档

## 背景

Code Review 发现两个问题：
1. `gateway.docker.toml` 的 Portal upstream 条目缺少 `public_paths`，导致 Docker 环境 `/_next/` 和 `/favicon.ico` 不在合并后的 `all_public_paths` 中，Next.js 静态资源请求被 JWT 验签拦截。
2. 零信任头剥离行为从精确匹配 4 个头变为黑名单兜底（无条件剥离所有 `X-*` 头），需记录在 CHANGELOG 和 spec 文档中。

## 任务 1：修复 `apps/gateway/gateway.docker.toml`

对齐 `gateway.toml` 语义结构：

- `[portal].public_paths`：移除 `"/"`，保留 `/login`、`/register`、`/error`、`/api/auth/`、`/oauth2/`、`/.well-known/`
- `[[upstreams]]` portal 条目下新增：`public_paths = ["/", "/_next/", "/favicon.ico"]`

**验证**：合并后 `all_public_paths = [portal].public_paths + Σ [[upstreams]].public_paths` 包含全部必要路径。

## 任务 2：更新 `CHANGELOG.md`

在顶部新增 `## [Unreleased]` 条目，记录：

- **Added**: 多 upstream 路由表（`[[upstreams]]`）、启动期 `validate_routing_consistency` 路由一致性校验
- **Changed**: `[portal].public_paths` 语义收窄为全局白名单，应用级公开路径移至 `[[upstreams]].public_paths`
- **Security**: 零信任身份头剥离策略从精确匹配强化为黑名单兜底——无条件剥离所有 `X-*` 头（仅显式放行 `X-Forwarded-*` / `X-Request-Id` / `X-Correlation-Id` / `X-Real-IP`）。下游收到的身份信息 100% 来自 Gateway 权威注入，杜绝客户端伪造透传。

## 任务 3：更新 `docs/spec/DETAILED_DESIGN.md`

第 641-649 行 `upstream_request_filter()` 描述更新为：

```
├─ 2. upstream_request_filter()
│      ├─ 注入 X-Forwarded-Proto/Host
│      ├─ 零信任清洗：无条件剥离所有 X-* 身份头
│      │     （黑名单兜底，仅放行 X-Forwarded-*/X-Request-Id/X-Correlation-Id/X-Real-IP）
│      ├─ 按验签结果权威注入身份头（Authorization/X-User-Id/X-User-Jti/X-Client-IP/X-Client-UA）
│      └─ 按路径分类重写上行 Cookie（微服务剥除全部 / 受保护路径剥除 RT）
```

## 影响范围

| 文件 | 操作 | 风险 |
|------|------|------|
| `apps/gateway/gateway.docker.toml` | 修改 | 低，对齐已有 `gateway.toml` 结构 |
| `CHANGELOG.md` | 新增条目 | 无 |
| `docs/spec/DETAILED_DESIGN.md` | 更新过时描述 | 无 |

## 验证确认

- `cargo check` — 通过（51 tests, clippy clean）
- 手动检查 `gateway.toml` 与 `gateway.docker.toml` 的 `[portal].public_paths` + `[[upstreams]].public_paths` 并集一致性

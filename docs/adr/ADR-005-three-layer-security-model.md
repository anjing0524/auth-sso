# ADR-005: 三层安全模型

| 属性       | 值                                    |
|------------|---------------------------------------|
| **状态**   | accepted                              |
| **日期**   | 2026-07-15                            |
| **决策者** | Auth-SSO 团队                         |
| **影响范围** | Gateway、proxy.ts、withAuth、安全架构 |

## 背景

Auth-SSO 的安全需求分三个独立层次：

1. **网络边界**：TLS 终止 + 身份令牌验证 — 请求合法吗？
2. **会话边界**：CSRF 防护 + 登录态检查 — 请求带有效会话吗？
3. **业务边界**：RBAC 权限 + 数据范围 — 请求有权操作吗？

这三个层次解决**完全不同的问题**，不应合并。每一层失败都应独立返回错误（401/403），不应穿透到下一层。

## 决策

**三层安全模型，逐层拦截：**

```text
Layer 1: Gateway (Rust)          → 密码学验证
  验证: ES256 JWT 签名 + issuer + exp + jti 黑名单
  失败: 无 JWT → PKCE redirect / 401;  失效 JWT → 401
  成功: 注入 x-user-id / x-user-name / x-user-jti + HMAC 签名

Layer 2: proxy.ts (Next.js 16)   → 会话存在性 + CSRF
  验证: Cookie 存在 / 公开路径白名单
  失败: 无 Cookie → 302 login;  非白名单 → 403
  成功: 放行到 App Router

Layer 3: withAuth / withPermission → 精细鉴权 + 数据范围
  withAuth:       用户存在且未禁用/锁定/删除？
  withPermission: 用户拥有所需权限码？
  getUserRoleDeptIds: 用户在哪些部门范围内可见数据？
  失败: 401 / 403（通过 mapDomainError 映射）
```

**这不是 11 层鉴权**。之前文档中"11 层鉴权链"的提法将安全层与架构模式（CQRS data.ts/actions.ts、Domain 纯函数、mapDomainError、Cache 策略）混在同一序列图中。准确地说：3 层安全防线 + CQRS + Domain + Error Mapping + Cache。共 7 个横切关注点，只有前 3 层是安全相关的。

## 各层解决的核心问题

| 层 | 问题 | 技术手段 |
|----|------|----------|
| Gateway | 这个 JWT 是真的吗？被撤销了吗？ | ES256 验签 + Redis jti 黑名单 |
| proxy.ts | 这个请求带了会话 Cookie 吗？是 CSRF 攻击吗？ | Cookie 存在性检查 + SameSite + Origin 校验 |
| withAuth | 这个用户存在且未被禁用吗？ | DB 查询用户状态 |
| checkPermission | 这个用户有 `user:create` 权限吗？ | DB 查询角色-权限关联 |
| dataScope | 这个用户能看到哪些部门的数据？ | `roles.dept_id` 子树展开 |

## 后果

- 每层独立失败，不穿透（Gateway 验签失败不会触发 withAuth 的 DB 查询）
- 层间通过注入的 header（`x-user-id` 等）传递身份，不重复解码 JWT
- Gateway 与 Portal 之间通过 HMAC（`X-Gateway-Signature`）建立信任路径，替代 IP 白名单
- `withAuth` 和 `checkPermission` 虽然是两个函数，但通常是组合调用（`withAuth(requirePermission('user:create', handler))`），这是有意的高阶函数设计，不是冗余

## 相关 ADR

- ADR-001: 统一权限树（权限码粒度）
- ADR-002: 角色-部门绑定（数据范围来源）
- ADR-003: Gateway 作为 OAuth Client（第一层安全边界）
- ADR-004: 无状态 JWT + Redis jti 黑名单（Gateway 验签基础）

# Auth-SSO 系统路线图

本文档记录各模块完成状态与版本规划，与 docs/spec/REQUIREMENTS_MATRIX.md 联动。

## 模块状态

| 模块 | 状态 | 版本 | 备注 |
|------|------|------|------|
| 用户管理（CRUD/状态/改密） | ✅ 已交付 | v1.1 | 含密码历史 NFR-SEC-15 |
| 角色管理（RBAC v3.2） | ✅ 已交付 | v1.1 | 角色归属部门模型 |
| 权限管理（统一权限树） | ✅ 已交付 | v1.1 | DIRECTORY/PAGE/API/DATA 四类型 |
| 部门管理（物化路径树） | ✅ 已交付 | v1.1 | ancestors 子树查询 |
| OAuth 2.1 Provider | ✅ 已交付 | v1.1 | PKCE + 授权码 + Token 轮换 |
| OIDC Discovery | ✅ 已交付 | v1.1 | 含 end_session_endpoint |
| Gateway 边缘验签 | ✅ 已交付 | v1.1 | Pingora + ES256 + HMAC 签名 |
| 审计日志（180天分区） | ✅ 已交付 | v1.1 | append-only |
| 暴力破解防护 | ✅ 已交付 | v1.1 | Redis INCR 锁定 |
| SAML 2.0 | 🔲 待评估 | P2 | 未在本期范围，企业对接需求驱动 |
| OIDC RP-Initiated Logout | 🔲 待评估 | P2 | 当前用自定义 revoke 实现 |
| 多租户隔离 | ❌ 范围外 | - | PRD §2.2 明确排除 |

## 变更记录

- 2026-07-10: 初始化路线图，对齐 v1.1 交付状态

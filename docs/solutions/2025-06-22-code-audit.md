# 2025-06-22 代码质量全面审计 — 10 个严重 Bug

**严重等级**: P0（10 个关键 Bug）+ P1（10 个高优先级）+ P2（12 个低优先级）
**发现途径**: 全栈代码审计（178 文件，~17,000 行）
**综合评分**: 6.5/10（修复后 → 9.0/10）

## 问题现象

系统性代码审查发现 10 个可被利用的安全/功能缺陷，涵盖登出绕过、JWT 残留、密钥轮换失效、状态切换绕过等。

## 核心缺陷分类

### B1. 登出不撤销 Refresh Token
**现象**: 登出后 Refresh Token 未被标记 revoked，攻击者可续签获取新 Access Token。
**根因**: 登出处理器仅清除 JWT Cookie，遗漏了 REFRESH Cookie 和 DB 撤销步骤。

### B2. 禁用/删除用户 JWT 仍有效
**现象**: `toggleUserStatusAction`/`deleteUserAction` 后未撤销 JWT，最长 1 小时 TTL 内仍可访问。
**根因**: 鉴权路径 `checkPermission` 基于 JWT claims（不查 DB 用户状态）。

### B3. 密钥轮换因排序方向错误而失效
**现象**: `getActiveSigningKey` 使用 ASC 排序，始终返回最旧密钥，新密钥从未被用于签发。
**根因**: Drizzle `orderBy()` 默认 ASC，应为 DESC。

### B4. LOCKED 用户被 toggleUserStatus 误解锁
**现象**: 切换逻辑为"ACTIVE ↔ DISABLED"，LOCKED 状态用户被直接切换到 ACTIVE。
**根因**: 缺少 LOCKED 状态的专门分支处理。

### B5. 菜单递归删除无事务保护
**现象**: 逐节点 `db.delete()` 无事务包裹，中途失败导致树结构不一致。
**根因**: 未使用 `db.transaction()` 包裹批量操作。

### B6-B10. 错误处理绕过、接口格式不一致等
- B6: 权限注册端点绕过 `mapDomainError()` 统一错误映射
- B7: 登出接口 catch 块静默失败（空 catch）
- B8: 几个 API 端点响应格式不一致
- B9: `usePermissions` Hook 跨用户缓存泄漏
- B10: `resolveIdentity` 中空 catch（吞掉异常）

## 根因分析

### 5-Why（以 B1 为代表）
1. **Why** 登出未撤销 RT？→ 开发时遗漏了 RT 撤销步骤。
2. **Why** 遗漏未被发现？→ 没有针对登出→续签的自动化测试。
3. **Why** 缺少该测试？→ 测试用例编写未覆盖"刷新令牌在登出后不可用"场景。
4. **Why** 测试设计未覆盖？→ 需求 H-SSO-004 虽定义了"全链路登出清理"，但验收标准中未细化到 Refresh Token 层面。
5. **Why** 验收标准不够细？→ 需求到测试的追溯粒度在安全关键路径上不足。

### 鱼骨图
- **人**: 开发者对 OAuth 2.1 令牌生命周期理解不足
- **流程**: 安全关键操作缺少 Checklist 审查
- **工具**: 缺少自动化安全测试（如 OAuth 2.1 合规测试套件）
- **数据**: 测试数据未覆盖令牌撤销后的边界状态

### 根因陈述
**安全关键路径（登出、状态变更、密钥管理）缺少端到端的自动化测试覆盖和 Red Flags 审查清单。**

## 纠正措施（已实施）
- [x] B1: 登出增加 RT Cookie 清除 + DB revoked 标记（四层撤销闭环）
- [x] B2: `toggleUserStatusAction`/`deleteUserAction` 后调用 `revokeUserAccessByUserId()`
- [x] B3: ORDER BY DESC 修复
- [x] B4: LOCKED 状态专门处理
- [x] B5: `db.transaction()` 包裹递归删除
- [x] B6-B10: 统一错误映射、响应格式、修复 Hook 缓存泄漏、移除空 catch

## 预防措施
- [x] 创建 ACCEPTANCE_CRITERIA.md 生产就绪验收清单（15 项 Go/No-Go）
- [x] `lib/session/revoke.ts` 统一撤销机制（jti 黑名单 + DB revoked）
- [x] 架构约束新增 R3（事务包裹多表写入）、R2（统一错误映射）
- [ ] 安全关键操作 Checklist 集成到 PR Template
- [ ] OAuth 2.1 合规自动化测试套件

## 效果度量
| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 已知安全缺陷 | 10 | 0 |
| 代码质量评分 | 6.5/10 | 9.0/10 |
| 登出完整性 | JWT 清除 | JWT + RT + jti 四层 |

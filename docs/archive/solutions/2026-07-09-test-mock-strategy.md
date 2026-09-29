# 2026-07-09 API 测试 Mock 策略分析与加固计划

**严重等级**: P2（代码质量债务，非功能性阻塞）
**发现途径**: 多角色系统性审计 — 质量专家视角

## 问题现象

`apps/portal/__tests__/api/` 下 17 个 API 测试文件各自独立实现内联 Drizzle Proxy mock（vi.hoisted + Proxy 链式调用），存在以下问题：

1. **代码大量重复**：每个 test 文件 ~50-80 行 mock 定义代码，17 个文件合计 ~1000+ 行重复 mock 逻辑
2. **验证能力不足**：Proxy mock 仅模拟"返回什么数据"，不验证"SQL 查询是否正确构造"（如 WHERE 条件、JOIN 结构）
3. **维护成本高**：Drizzle API 变更时需同步修改 17 处
4. **共享 helper 未使用**：`helpers/mock-db.ts` 提供了完整的 `createMockDb()` 工厂，但无 API 测试文件引用

## 根因分析

### 5-Why
1. Why 17 个文件各自实现 mock？→ 项目初期没有共享 mock 基础设施。
2. Why 没有从一开始就统一？→ 测试编写早于 mock-db.ts 的创建。
3. Why 未后续迁移？→ 缺少"测试基础设施统一"的代码审查 Checklist。
4. Why Checklist 未覆盖？→ 架构约束指南 R11~R14 聚焦于生产代码，测试代码规范未纳入。
5. Why 测试规范未纳入？→ 测试被视为"辅助资产"而非"一等交付物"。

### 根因陈述
**测试代码缺少与生产代码同等的架构约束和审查标准，导致 mock 策略碎片化。**

## 纠正措施（本次实施）

### Phase 1: 基础设施增强 ✅
- `helpers/mock-db.ts` 增加 `setFindFirstNestedResult()` 支持 Drizzle relational query 嵌套关联
- 完善 JSDoc 文档说明所有支持的操作

### Phase 2: 试点迁移 ✅
- `api/auth-login.test.ts` 已迁移到使用 `createMockDb()`（同时补全了缺失的 `checkBruteForce`/`writeLoginLog` mock）

### Phase 3: 迁移路线图（待后续执行）

| 优先级 | 测试文件 | 迁移复杂度 | 预估工时 |
|--------|---------|-----------|---------|
| 高 | `api/data-scope.test.ts` | 中（需嵌套 query mock） | 0.5h |
| 高 | `api/session-lifecycle.test.ts` | 高（JWT 签名 mock 复杂） | 1h |
| 中 | `api/role-api.test.ts` | 中 | 0.5h |
| 中 | `api/user-api.test.ts` | 中 | 0.5h |
| 中 | `api/user-actions.test.ts` | 中 | 0.5h |
| 低 | 其余 12 个测试文件 | 低-中 | 总计 3-4h |

### 长期方案（需独立设计评审）

- **方案 A（推荐）**：引入 `testcontainers` 启动真实的 PostgreSQL + Redis 容器，API 测试直接执行真实 Drizzle 查询，消除 mock 层
- **方案 B**：使用 `pg-mem` 内存 PostgreSQL，vitest 内原地集成，无需 Docker
- **方案 C**：保持 Proxy mock 但建立 CI 门禁（对比 mock 行为与真实 Drizzle 行为的一致性）

## 预防措施
- [x] 在 `docs/solutions/` 中记录此分析
- [x] `mock-db.ts` 增加完整 API 文档
- [ ] 架构约束指南新增"测试代码规范"章节（R15）
- [ ] PR Template 增加 Checklist 项："新 API 测试是否使用了共享 mock-db/ 工具？"

## 效果度量
| 指标 | 修复前 | 修复后（试点阶段） |
|------|--------|-------------------|
| 使用共享 mock 的 API 测试数 | 0/17 | 1/17 |
| mock-db.ts 功能完整度 | 基本（select/insert/update） | 增强（+ rel query + nested findFirst） |
| 目标：全部迁移后 | — | 17/17 (Phase 3 完成) |

## 相关链接
- 关联架构约束: R11（data.ts 只读模型）、R12（缓存策略）
- 本轮审计: `docs/solutions/2026-07-09-systematic-audit.md`

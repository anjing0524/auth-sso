# 2025-06-17 Portal 代码审查与修复

**严重等级**: P1/P2（代码质量债务）
**发现途径**: 系统性代码审查

## 问题现象

Portal 代码库存在大量死代码（未使用的类型、接口、函数）、硬编码字面量、重复逻辑和 React 性能反模式，累计 41 项修复点。

## 根因分析

### 5-Why
1. **Why** 存在死代码？→ v2 重构时新增了统一实现，但旧代码未被清理。
2. **Why** 旧代码未被清理？→ 缺少自动化死代码检测工具（如 `ts-prune`）集成进 CI。
3. **Why** CI 缺少死代码检测？→ CI Pipeline 仅运行测试，未配置静态分析门禁。
4. **Why** 硬编码字面量（'SUPER_ADMIN'/'ADMIN'）散落各处？→ 枚举单一真相源（R4）约束未在 Code Review 中强制执行。
5. **Why** Code Review 未覆盖？→ 缺少 lint rule（如 `no-restricted-syntax`）自动拦截。

### 根因陈述
**v2 重构的增量开发模式下，缺少自动化静态分析门禁导致技术债务累积。**

## 纠正措施（已实施）

### 第一轮：死代码 + 规范修复（28 项）
- 删除 14 个未使用文件/类型/函数（`db/types.ts`、14 个 contracts 接口等）
- 4 处硬编码 `'SUPER_ADMIN'/'ADMIN'` → `ADMIN_ROLE_CODES` 常量
- 20 处 `revalidateTag()` 无效参数移除
- 提取 `lib/menu-tree.ts` 消除 3 处重复的菜单树构建逻辑
- React 优化：`import * as Icons` → `ICON_MAP` 白名单、`Math.random()` → CSS 变量

### 第二轮：遗留问题修复（13 项）
- JWK `kid` 修复：`generateAndPersistKeyPair` 正确写入 kid 到 DB
- `parseRedirectUris` 跨域依赖移至 `domain/shared/`
- `/api/me` 新增 `tokenInfo.issuedAt` 字段
- Dashboard 硬编码统计移除
- `paginatedSelect()` 提取消除 ~50 行重复模板
- `/api/me/permissions` 使用 `resolveIdentity` (React.cache) 替代手动 JWT 解析

## 预防措施
- [x] R4 枚举单一真相源约束强化（`@auth-sso/contracts` 为唯一来源）
- [x] 架构约束指南新增 R1~R14 规则
- [ ] CI 集成静态分析（死代码检测 + 限制语法 ESLint rules）

## 效果度量
| 指标 | 修复前 | 修复后 |
|------|--------|--------|
| 死代码文件数 | 14+ | 0 |
| 硬编码角色字符串 | 6+ 处 | 0 |
| 重复代码块 | ~50 行 | 0（提取为共享函数） |

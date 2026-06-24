# Spec-Docs: 产品交付文档编写与维护指南

## Overview

`docs/spec/` 是 Auth-SSO 项目的**产品交付文档体系**，遵循 CMMI V3.0 Level 5 标准。8 份文档覆盖软件工程全生命周期：需求 → 架构 → 设计 → 实现约束 → 数据库 → API → 用户故事 → 追溯矩阵。

**核心原则：每份文档有严格边界，禁止跨边界污染。**

---

## 文档清单与职责边界

| # | 文档 | 职责 | 禁止 |
|---|------|------|------|
| 1 | **PRD.md** | 产品需求规格说明（WHAT）— 执行摘要、产品范围、用户角色、功能需求 FR 表、用户旅程、可量化 NFR、版本路线图、CMMI Level 5 合规声明 | 禁止写技术实现细节（API 路径、算法名称、框架名称） |
| 2 | **REQUIREMENTS_MATRIX.md** | CMMI RTM 需求追溯矩阵（WHAT × 验证）— 7 维属性（ID/描述/优先级/验证方法/风险/来源/验收标准）、模块汇总、追溯关系 | 禁止含技术实现细节（bcrypt/proxy.ts/Drizzle/Redis/领域层 等术语）；禁止含 D-* 领域模型条目（归 ARCHITECTURE_CONSTRAINTS.md） |
| 3 | **ARCHITECTURE.md** | 系统架构设计（HOW — 结构层）— 技术栈、分层架构、管理链路（§4）、认证授权全链路（§6）、OIDC 端点、安全原则、包依赖 | 禁止写具体函数签名（归 DETAILED_DESIGN.md）；禁止写编码规则细节（归 CONSTRAINTS） |
| 4 | **ARCHITECTURE_CONSTRAINTS.md** | 架构约束指南（HOW — 规则层）— 14 条一票否决规则 R1~R14 + Red Flags 红线清单 + Controller 骨架 + 领域模型约束 DC-* | 禁止写产品需求（归 PRD/Matrix）；禁止写设计说明（归 DETAILED_DESIGN） |
| 5 | **DETAILED_DESIGN.md** | 详细设计（HOW — 实现层）— 认证流程时序、鉴权体系、数据范围算法、缓存策略、Gateway 流水线、函数签名参考、环境变量表 | 禁止重复 ARCHITECTURE.md 的宏观描述；禁止写产品需求 |
| 6 | **DATABASE.md** | 数据库设计 — 18 张表定义（列/类型/约束/说明）、PostgreSQL 枚举、外键汇总、Redis 键结构 | 禁止写 ORM 实现细节（Drizzle 查询示例归 CONSTRAINTS） |
| 7 | **API.md** | API 接口规范 — 全局约定、认证 API、管理 API、OIDC Provider API、curl 示例、SDK 集成指南、错误码附录 | 禁止写内部实现（Route Handler 逻辑归 ARCHITECTURE） |
| 8 | **USER_STORIES.md** | 用户故事 — 测试角色矩阵、19 模块 80+ 故事（含验收标准）、权限分配明细、追溯映射 | 模块 A-F 的验收标准禁止含技术实现细节（API 路径、Cookie 名）；模块 H 认证流故事可适度保留协议术语 |

---

## 需求 ID 命名体系

| 前缀 | 归属文档 | 示例 | 语义 |
|------|---------|------|------|
| `FR-{DOMAIN}-{NN}` | PRD.md | `FR-AUTH-01` | 功能需求编号（按模块分组） |
| `{MODULE}-{SUB}-{NN}` | REQUIREMENTS_MATRIX.md | `H-AUTH-001`、`B-USR-L` | 产品需求 ID（可追溯的最小单元） |
| `NFR-{DOMAIN}-{NN}` | PRD.md §6 | `NFR-PERF-01` | 非功能需求（含量化阈值） |
| `DC-{DOMAIN}-{X}` | ARCHITECTURE_CONSTRAINTS.md §六 | `DC-USR-C` | 领域模型实现约束（C=Create/U=Update/D=Delete） |
| `R{n}` | ARCHITECTURE_CONSTRAINTS.md §一 | `R1` | 一票否决规则编号 |
| `US-{MODULE}-{NN}` | USER_STORIES.md | `US-B-01` | 用户故事编号 |

**关键规则：**
- REQUIREMENTS_MATRIX.md **只能**含模块前缀 ID（A~I），**不得**含 DC-* 技术约束 ID
- ARCHITECTURE_CONSTRAINTS.md §六 含 DC-* 约束 ID，每条必须标注「关联产品需求」列
- PRD.md FR 表的「关联矩阵」列必须引用当前有效的 Matrix ID（禁止使用旧 ID）

---

## 验收标准定义规范 (CMMI SP 2.1)

```
好的验收标准（Acceptance Criteria）：
  ✓ 可观察：描述用户/系统可观察的行为
  ✓ 可测量：含具体的判定条件（数值/状态/行为/时间）
  ✓ 单一职责：每条只验证一个行为
  ✓ 业务语言：产品文档用用户视角；架构文档可用技术语言
  ✓ 独立可测：不依赖其他验收标准的执行顺序

坏的验收标准：
  ✗ 模糊：「正常」「合理」「快速」「流畅」等无量化形容词
  ✗ 实现细节（产品文档中）：API 路径、Cookie 名称、算法名称、文件名
  ✗ 复合条件：「同时满足 A 且 B 且 C 且 D」→ 拆为多条
  ✗ 否定句式：「不应该报错」→ 改为「系统正常返回预期数据」
```

**分层验收标准：**

| 层级 | 文档 | 验收标准风格 |
|------|------|-------------|
| L1 产品需求 | REQUIREMENTS_MATRIX.md | 纯业务语言：「管理员可查看…」「系统自动记录…」 |
| L2 用户故事 | USER_STORIES.md | 用户视角步骤：「1. 对话框包含必填字段 2. 唯一性校验 3. 列表自动刷新」 |
| L3 非功能需求 | PRD.md §6 | 量化阈值 + 测量方法：「P95 < 200ms，k6 压力测试」 |
| L4 实现约束 | ARCHITECTURE_CONSTRAINTS.md | 技术规则 + 异常行为：「领域层须校验…，不满足则拒绝操作」 |

---

## 内容边界（防污染规则）

### 禁止跨层污染

```
产品需求（PRD.md / REQUIREMENTS_MATRIX.md）
  ↓ 描述 WHAT，不含 HOW
架构设计（ARCHITECTURE.md）
  ↓ 描述结构、组件职责、链路，不含具体函数签名
详细设计（DETAILED_DESIGN.md）
  ↓ 描述函数签名、算法、时序，不含编码规则
架构约束（ARCHITECTURE_CONSTRAINTS.md）
  ↓ 描述编码规则、红线、领域校验，不含产品需求
```

### 产品矩阵技术污染黑名单

以下术语**严禁**出现在 `REQUIREMENTS_MATRIX.md` 的需求描述或验收标准中：

- 框架/库名：`bcrypt`、`Drizzle`、`jose`、`Next.js`、`Pingora`
- 文件名：`proxy.ts`、`data.ts`、`actions.ts`、`route.ts`
- 协议细节：`ES256`、`S256`（应写为「加密签名」「安全哈希」）
- 基础设施：`Redis 黑名单`（应写为「会话即时失效」）、`PostgreSQL`（应写为「数据库」）
- 内部路径：`/api/auth/`、`portal_jwt_token`（应写为「登录令牌 Cookie」）

> 例外：ARCHITECTURE.md、DETAILED_DESIGN.md、ARCHITECTURE_CONSTRAINTS.md 可自由使用技术术语。

---

## 安全域归属规则

所有安全/认证/授权/数据范围相关需求**必须**统一归属到模块 H（安全与认证），不得分散在其他模块中。

模块 H 的 6 个子域：
- **H-AUTH**：用户认证（登录、凭证验证、OAuth 流程、防攻击）
- **H-SESS**：会话管理（令牌生命周期、过期、刷新）
- **H-SSO**：单点登录与登出
- **H-ACL**：访问控制（权限拦截、管理员特权、应用授权）
- **H-DSCOPE**：数据范围控制（ALL/DEPT/DEPT_AND_SUB/SELF/CUSTOM + 优先级）
- **H-FLOW**：端到端流程验证（E2E 测试用例）

---

## PRD 与 REQUIREMENTS_MATRIX 的互补关系

```
PRD.md（需求规格说明）
  FR-AUTH-01 用户登录  →  关联矩阵: H-AUTH-001~002, DC-AUTH-001
  （1 个 FR 映射 1~N 个 Matrix 条目）

REQUIREMENTS_MATRIX.md（需求追溯矩阵）
  H-AUTH-001  未登录拦截与重定向  P0  E2E测试  高  安全审计  验收标准: ...
  H-AUTH-002  用户登录认证        P0  自动化   高  安全审计  验收标准: ...
  DC-AUTH-001 登录凭证领域校验    —   自动化   高  架构设计  约束: ...

  PRD FR 表 → 索引 + 分组（便于产品阅读）
  Matrix    → 完整属性 + 追溯（便于质量管理和测试）
  两者互补，不重复。PRD 的 FR 描述短短（10-20 字），Matrix 的验收标准长（100+ 字）。
```

---

## CMMI Level 5 合规检查清单

| # | 要求 | 文档位置 |
|---|------|---------|
| 1 | 需求基线（含 CCB 变更控制） | PRD.md 头部声明块 |
| 2 | 7 维需求属性（ID/描述/优先级/验证方法/风险/来源/验收标准） | REQUIREMENTS_MATRIX.md 每条需求 |
| 3 | 量化非功能需求（含测量方法） | PRD.md §6 |
| 4 | 双向追溯（需求 → 设计 → 实现 → 测试） | REQUIREMENTS_MATRIX.md「追溯关系」+ `@req` 注解 |
| 5 | 过程性能基线（UCL/LCL 统计控制） | PRD.md §8.4 |
| 6 | CAR 缺陷因果分析程序（5-Why + 鱼骨图 + 闭环） | PRD.md §8.5 |
| 7 | 过程改进选择与部署流程（Pilot → 度量 → 推广/回滚） | PRD.md §8.6 |
| 8 | 经验教训管理（`docs/solutions/`） | PRD.md §8.7 |
| 9 | 组织级过程资产（架构约束、编码规范、Red Flags） | ARCHITECTURE_CONSTRAINTS.md |

---

## 文档评审清单

每次修改 `docs/spec/` 后，必须验证：

### 内容正确性
- [ ] 架构描述与实际源码一致（对照 `apps/portal/src/`、`apps/gateway/src/`、`packages/`）
- [ ] 所有 ID 引用指向存在的条目（无悬空引用）
- [ ] API 路径与 Route Handler 实际路径一致
- [ ] 数据库表定义与 Drizzle Schema 一致

### 边界清晰性
- [ ] REQUIREMENTS_MATRIX.md 零技术术语污染（grep `bcrypt\|Drizzle\|proxy.ts\|Redis 黑名单`）
- [ ] 安全需求全部在模块 H（不在 C/G 中残留）
- [ ] PRD.md FR 表的「关联矩阵」列引用当前有效的 Matrix ID
- [ ] 领域模型约束（DC-*）在 ARCHITECTURE_CONSTRAINTS.md §六，不在 Matrix 中

### CMMI 合规性
- [ ] PRD.md 含需求基线声明 + CMMI Level 5 合规声明
- [ ] 所有需求有唯一 ID + 优先级 + 验证方法 + 验收标准
- [ ] NFR 全部可量化（含阈值和测量方法）
- [ ] CAR/OPM/SPC 程序保持最新

### 可读性
- [ ] 全中文描述（代码块、JSON、curl、URL 除外）
- [ ] 表格优先于纯文本段落
- [ ] 验收标准使用可观察/可测量语言
- [ ] 交叉引用完整（PRD→Matrix、Matrix↔Stories、Architecture↔Constraints）

### 测试对齐
- [ ] `pnpm test:api` 全部通过
- [ ] `node tests/traceability/generate-report.mjs` 零未识别 ID
- [ ] 测试文件 `@req` 注解 ID 全部存在于 Matrix 或 CONSTRAINTS 中

---

## 常见反模式

| 反模式 | 表现 | 正确做法 |
|--------|------|---------|
| **需求-设计混淆** | 在 Matrix 中写「领域层校验」「bcrypt compare」 | Matrix 只写「系统验证凭证」；实现细节归 CONSTRAINTS |
| **安全域碎片化** | 认证需求分散在 G/H/C 三个模块 | 统一归属模块 H |
| **验收标准虚化** | 「功能正常」「数据正确」 | 改为「管理员可查看用户列表，数据范围受权限约束」 |
| **ID 腐化** | PRD FR 表引用已废弃的旧 ID | 每次修改 Matrix ID 时同步更新 PRD FR 表 |
| **章节漂移** | CMMI 章节编号重复或跳跃 | 保持 8.1→8.8 连续编号 |
| **文档膨胀** | 在 PRD 中写架构细节、在架构中写产品需求 | 严格遵循上文的「内容边界」 |
| **翻译遗留** | 新增内容用英文、旧内容用中文 | 全文统一中文 |

---

## 关联资源

- **架构编码指南**: `.claude/skills/architecting-portal/SKILL.md`（Portal 分层架构、Controller 规范）
- **项目总览**: `CLAUDE.md`（技术栈、测试体系、开发命令）
- **经验教训库**: `docs/solutions/`（代码审查、Bug 修复记录）
- **测试体系**: `apps/portal/__tests__/` + `tests/e2e/` + `tests/traceability/`
- **追溯性工具**: `tests/traceability/generate-report.mjs`

# 文档地图（从这里开始）

> **项目文档正文全部集中在 `docs/`**。留在 `docs/` 之外的只有固定入口与随配置分发的局部说明：
> 根 `README.md`（GitHub 首页）、`AGENTS.md`（agent 常驻规则，由工具自动加载），
> 以及 `deploy/systemd/README.md`、`deploy/observability/README.md`（各自贴着部署配置，不算文档正文）。
> 每份文档只该有一个职责。这张表回答两个问题：**我要做什么 → 该读哪份**；**这份文档是不是权威**。

## 一、动手改代码之前必读

| 文档 | 管什么 | 何时读 |
|---|---|---|
| `AGENTS.md` | 工程约定、项目结构、测试体系、环境与门禁规则（**唯一出处**） | **每次动手前** |
| `docs/coding-standards.md` | 编码标准（含"单一真相源""数字必须被断言"等） | 写/评审代码前 |
| `docs/glossary.md` | 领域词汇唯一真相源（有界上下文、实体、生命周期） | 涉及领域概念时 |
| `docs/adr/`（33 篇） | 架构决策记录（**每条都有结论与理由**）；多数已补「验证」段。编号 ADR-001～033 连续；最新五篇：ADR-029 权限授予反提权、ADR-030 部署目标收敛为两个生产目标、ADR-031 退役 Agent 治理技能套件、ADR-032 SUPER_ADMIN 唯一 break-glass / PLATFORM_ADMIN 显式 RBAC、ADR-033 入口 Host 规范化（非规范 Host 302 回规范入口） | 想知道"为什么长这样"时 |

## 二、按交付职责找文档

> 六类交付物，按「定义 → 决策 → 实现 → 运行 → 验收 → 工程配置」排列。
> 第一节是「动手前必读」的横切视角，与本节分类允许交叉；同一文档在本节内只归**主职责**一组。
> **本节只写职责与指路，不抄目录清单与计数**（清单由对应文档维护，计数见第四节）；命令只给入口提示——
> 地图抄一份清单，就会多一个要人记得同步的地方。

### A. 需求与规格 — 定义系统「是什么」

| 文档 | 职责 |
|---|---|
| [`docs/spec/PRD.md`](spec/PRD.md) | 产品范围、用户角色、功能与非功能需求 |
| [`docs/spec/ARCHITECTURE.md`](spec/ARCHITECTURE.md) | 系统组成、技术栈、认证与 SSO 全链路 |
| [`docs/spec/API.md`](spec/API.md) | 接口清单与字段级契约 |
| [`docs/spec/DATABASE.md`](spec/DATABASE.md) | 表结构、枚举、外键与 Redis 键结构 |
| [`docs/spec/REQUIREMENTS_MATRIX.md`](spec/REQUIREMENTS_MATRIX.md) | 需求 → 验收标准追踪矩阵（与 `tests/traceability/` 联动） |
| [`docs/spec/ARCHITECTURE_CONSTRAINTS.md`](spec/ARCHITECTURE_CONSTRAINTS.md) | 分层红线、Controller 骨架、Code Review 一票否决项 |
| [`docs/spec/UX-GUIDELINES.md`](spec/UX-GUIDELINES.md) | UI/UX 原则、任务步骤预算、逐页要求矩阵 |
| [`docs/spec/UX-METRICS.md`](spec/UX-METRICS.md) | UX 量化基线（每轮改动的对比基准） |
| [`docs/spec/third-party-integration.md`](spec/third-party-integration.md) | 子系统与第三方应用接入规约（边缘鉴权 + 全局缓存） |

### B. 架构决策与演进 — 回答「为什么长这样」

| 文档 | 职责 |
|---|---|
| [`docs/adr/`](adr/) | 决策权威：每条记录都有结论与理由；与代码冲突时先信代码，再查这里的理由 |
| [`docs/roadmap.md`](roadmap.md) | 模块完成状态与里程碑；变更记录按时间倒序 |
| [`docs/research/`](research/) | 技术调研一手笔记（OIDC/OAuth 2.1、Pingora 网关、全仓假绿普查） |

### C. 实现与设计规范 — 规定代码「怎么写」

| 文档 | 职责 |
|---|---|
| [`docs/portal-architecture-guidelines.md`](portal-architecture-guidelines.md) | Portal 分层、目录、错误体系、三层安全（**结构权威**） |
| [`docs/design-system.md`](design-system.md) | 颜色 / 字体 / 间距 / 动效 / 组件规范与页面布局 |

### D. 构建、部署与运行 — 把系统「跑起来」

| 文档 | 职责 |
|---|---|
| [`docs/local-development.md`](local-development.md) | 本地原生启动：`pnpm dev` → `http://localhost:4100` |
| [`docs/docker.md`](docker.md) | Docker 构建 / 部署 / 验收**唯一出处**：§0–§6 生产、§7 本地验收，命令只在 §7.2 |
| [`docs/ci.md`](ci.md) | GitHub Actions 触发文件 / 类别文件分类与命令对应 |
| [`docs/scripts.md`](scripts.md) | `scripts/` 各子目录的职责、入口与归属规则（目录清单见该文档） |
| [`docs/operations.md`](operations.md) | 生产运维手册：上线、备份恢复、监控、故障处置、验收证据 |
| [`docs/INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) | 登录后的子应用接入验证（Gateway 代理模式、`X-User-Id`、Redis 权限） |

### E. 交付与验收 — 判断「能不能交」

| 文档 | 职责 |
|---|---|
| [`docs/commercial-readiness.md`](commercial-readiness.md) | 商用就绪矩阵、交付阻断项、客户上线验收清单与交付判定 |
| [`docs/releases/v1.1.2.md`](releases/v1.1.2.md) | 版本发布记录：本次交付、验证证据、已知边界、回滚 |
| [`docs/ai-visual-testing.md`](ai-visual-testing.md) | Midscene AI 视觉探索性测试（**非阻断**，不替代 `tests/e2e/` 确定性门禁） |

### F. 工程配置 — agent 消费规则

| 文档 | 职责 |
|---|---|
| [`docs/agents/`](agents/) | issue tracker · triage 标签 · domain docs 三份仓库级配置（供 agent 技能消费） |

> **历史产物已清理**：`docs/archive/`（旧审计/旧计划/旧经验库）与 `docs/solution/`（按会话记录的决策与教训）
> 已于 2026-10-22 移出仓库。ADR / roadmap / research 里出现的这两类路径是历史记录：需要原件时用
> `git log -- docs/archive docs/solution`（或初始提交 `64d3a9f`）取回，不要把这类引用当作现行导航。

> **已退役资产**：`.dsh/skills/`（5 个 `governance-*` 技能）与 `docs/agent-governance.md` 已于 2026-11-03
> 按用户指令删除（ADR-031）。ADR / roadmap 里对它们的提及是历史记录：需要原件时用
> `git log -- .dsh docs/agent-governance.md` 取回，不作为现行导航。
> `docs/agents/` 是另一套配置（issue tracker / triage / domain docs），仍在用，不受此次退役影响。

## 三、权威性与优先级

1. **代码与测试 > 文档**：文档与代码冲突时，先信代码，再修文档（本仓有专门守卫断言"声明↔发射"一致：
   `apps/portal/__tests__/api/delivery-config-guard.test.ts` 锁交付配置、`apps/portal/__tests__/api/docs-claims.test.ts` 锁文档里的可重算数字）。
2. **`AGENTS.md` / `docs/coding-standards.md` 是过程权威**；`docs/adr/` 是**决策权威**；`docs/portal-architecture-guidelines.md` 是**结构权威**。
3. **历史材料已清理**（旧审计/旧计划/旧会话记录不再随仓库分发）：现行判断只依据代码、测试、`docs/adr/` 与 `docs/roadmap.md`。
4. 同名事实只保留一个家：凡"两个地方各写一份、靠人记得同步"的，都在本仓的治理范围内。
   命令类事实按此处理：Docker 日常/验收命令只在 `docs/docker.md` §7.2 维护，生产部署命令只在 §4。
   目录清单同理：脚本目录只在 `docs/scripts.md` 维护，目录计数只在下面第四节维护。

## 四、目录速览

> **计数以目录为准**：本节 `(N)` 是 `ls docs/<dir>/*.md | wc -l` 的实测值。
> 新增或删除文档后请同步本节；数字与目录不一致时，以目录内容为准。

```
根目录（仅固定入口）
├── AGENTS.md            agent 常驻规则（自动加载）
└── README.md            GitHub 首页

deploy/
├── systemd/README.md        随 systemd 单元分发的局部说明
└── observability/README.md  随监控模板分发的局部说明

docs/
├── README.md            本文件：文档地图
├── ai-visual-testing.md AI 视觉探索性测试（非阻断）
├── coding-standards.md  编码标准
├── design-system.md     设计系统（UI/UX 规范与品牌定义）
├── docker.md            Docker 构建 / 部署 / 验收（唯一出处）
├── operations.md         生产运维手册（备份/恢复/故障/验收）
├── commercial-readiness.md 商用就绪矩阵与交付阻断项
├── releases/ (1)        版本发布记录
├── scripts.md           脚本索引
├── ci.md                GitHub Actions 索引
├── local-development.md 本地开发
├── INTEGRATION_GUIDE.md 接入验证指南（Gateway 代理模式）
├── portal-architecture-guidelines.md  Portal 结构与分层
├── glossary.md          领域词汇唯一真相源
├── roadmap.md           里程碑与取舍（时间倒序）
├── agents/ (3)          agent 技能套件的仓库级配置（issue tracker / triage 标签 / domain docs）
├── adr/ (33)            决策记录
├── research/ (3)        调研笔记
└── spec/ (9)            需求规格
```

## 五、ima 知识库副本与两边并行维护

技术文档在 ima 个人知识库「硕的知识库」另有一份按**项目管理治理职责**分类的副本：以《00 文档分类总览》为入口，
其余按 01–07 七类汇编；每篇原文以「收录 N｜原路径」分节收录，原路径始终指向本仓库。
分类框架、效力状态与逐篇归属表以该总览为准，本地不另抄一份清单。

- **本地仍是事实源**：代码路径、命令、版本、端口、端点、计数等可重算事实以本仓库为准，
  改动需跑 `apps/portal/__tests__/api/docs-claims.test.ts` 等文档守卫。
- **ima 用于评审与协作**：批注与草稿性改写直接在 ima 条目里做；改完按《00 文档分类总览》§四 归属表
  定位本地原文件回写，暂不能回写时在该篇末标注「待回写本地」。
- **同步规则以《00 文档分类总览》§六 为准**：本地随代码变更后按类重新导出并重传、同名重传的重名策略、
  每个迭代的逐类对齐，以及 ima 连接器不支持条目重命名 / 移动 / 删除的能力边界。
- 本节与第二节视角不同：第二节按「交付职责」回答「我要做什么 → 该读哪份」；
  ima 分类按「治理职责 + 效力状态」回答「这份文档管什么、能不能改」。两者并行，不互相替代。

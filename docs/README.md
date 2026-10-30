# 文档地图（从这里开始）

> **项目文档全部集中在 `docs/`**。只有三个文件留在原处，因为它们是固定入口而不是文档正文：
> 根 `README.md`（GitHub 首页）、`AGENTS.md`（agent 常驻规则，由工具自动加载）、`.dsh/README.md`（DSH 运行时资产说明）。
> 每份文档只该有一个职责。这张表回答两个问题：**我要做什么 → 该读哪份**；**这份文档是不是权威**。

## 一、动手改代码之前必读

| 文档 | 管什么 | 何时读 |
|---|---|---|
| `AGENTS.md` | 工程约定、项目结构、测试体系、环境与门禁规则（**唯一出处**） | **每次动手前** |
| `docs/coding-standards.md` | 编码标准（含"单一真相源""数字必须被断言"等） | 写/评审代码前 |
| `docs/glossary.md` | 领域词汇唯一真相源（有界上下文、实体、生命周期） | 涉及领域概念时 |
| `docs/adr/`（30 篇） | 架构决策记录（**每条都有结论与理由**）；多数已补「验证」段。编号 ADR-001～030 连续；最新五篇：ADR-026 邮箱规范化、ADR-027 AI 治理工作流与技能标准化、ADR-028 写路径非空 targets 与全局写入口、ADR-029 权限授予反提权、ADR-030 部署目标收敛为两个生产目标 | 想知道"为什么长这样"时 |

## 二、按任务找文档

| 你要做的事 | 读这份 |
|---|---|
| 起服务、跑测试（本地开发 `pnpm dev`；验收/生产走 Docker） | [`docs/local-development.md`](local-development.md)（`pnpm dev -- --reset` → `pnpm dev` → `http://localhost:4100`）；验收 [`docs/INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md)（`docker compose -f docker/compose/test.yml up -d --wait --wait-timeout 600` → `https://127.0.0.1:19443/login`） |
| 登录后的子应用接入验证（Gateway 代理模式、`X-User-Id`、Redis 权限） | [`docs/INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) |
| Docker 构建 / 部署 / 验收（部署目标矩阵：自托管 P1 / Vercel P2 / 验收栈；`deploy` / `test:e2e` / 标准 compose / 故障排查） | [`docs/docker.md`](docker.md)（**唯一出处**：§0–§6 生产、§7 本地验收；命令只在 §7.2） |
| 上线、备份恢复、故障处置、交付验收证据 | [`docs/operations.md`](operations.md)（生产运维手册） |
| 商用交付判定 / 客户验收清单 / 已知边界 | [`docs/commercial-readiness.md`](commercial-readiness.md) |
| CI 工作流分类、触发矩阵与命令对应 | [`docs/ci.md`](ci.md)（`.github/workflows/` 的索引） |
| 脚本索引（`local/`、`docker/`、`e2e/`、`ci/`、`bench/`、`ux/`） | [`docs/scripts.md`](scripts.md) |
| 改 Portal 的代码结构（分层、目录、错误体系、三层安全） | [`docs/portal-architecture-guidelines.md`](portal-architecture-guidelines.md) |
| 改 UI（颜色/字体/间距/组件规范） | [`docs/design-system.md`](design-system.md)（设计系统） |
| 查历史取舍与里程碑 | [`docs/roadmap.md`](roadmap.md)（变更记录按时间倒序） |
| 查需求与追溯 | [`docs/spec/`](spec/) + `tests/traceability/` |
| 技术调研笔记 | [`docs/research/`](research/) |
| 优化 AI Agent 的工作方式（治理工作流、技能标准、守卫台账） | [`docs/agent-governance.md`](agent-governance.md)（标准与路由）+ `.dsh/skills/`（`governance-*` 技能，按需加载） |
| 用 Matt Pocock 技能套件（issue tracker / triage 标签 / domain docs 消费规则） | [`docs/agents/`](agents/)（`issue-tracker.md` · `triage-labels.md` · `domain.md`；本仓治理标准仍是 [`docs/agent-governance.md`](agent-governance.md)，两者分工不同） |

> **历史产物已清理**：`docs/archive/`（旧审计/旧计划/旧经验库）与 `docs/solution/`（按会话记录的决策与教训）
> 已于 2026-10-22 移出仓库。ADR / roadmap / research 里出现的这两类路径是历史记录：需要原件时用
> `git log -- docs/archive docs/solution`（或初始提交 `64d3a9f`）取回，不要把这类引用当作现行导航。

## 三、权威性与优先级

1. **代码与测试 > 文档**：文档与代码冲突时，先信代码，再修文档（本仓有专门守卫断言"声明↔发射"一致：
   `apps/portal/__tests__/api/delivery-config-guard.test.ts` 锁交付配置、`apps/portal/__tests__/api/docs-claims.test.ts` 锁文档里的可重算数字）。
2. **`AGENTS.md` / `docs/coding-standards.md` 是过程权威**；`docs/adr/` 是**决策权威**；`docs/portal-architecture-guidelines.md` 是**结构权威**；`docs/agent-governance.md` 是**技能与治理流程标准权威**（技能正文在 `.dsh/skills/`，两者不重复）。
3. **历史材料已清理**（旧审计/旧计划/旧会话记录不再随仓库分发）：现行判断只依据代码、测试、`docs/adr/` 与 `docs/roadmap.md`。
4. 同名事实只保留一个家：凡"两个地方各写一份、靠人记得同步"的，都在本仓的治理范围内。
   命令类事实按此处理：Docker 日常/验收命令只在 `docs/docker.md` §7.2 维护，生产部署命令只在 §4。

## 四、目录速览

> **计数以目录为准**：本节 `(N)` 是 `ls docs/<dir>/*.md | wc -l` 的实测值。
> 新增或删除文档后请同步本节；数字与目录不一致时，以目录内容为准。

```
根目录（仅固定入口）
├── AGENTS.md            agent 常驻规则（自动加载）
├── README.md            GitHub 首页
└── .dsh/
    ├── README.md        DSH 运行时资产说明
    └── .dsh/skills/ (5) 任务级治理技能（DSH 原生发现，标准见 docs/agent-governance.md）

docs/
├── README.md            本文件：文档地图
├── coding-standards.md  编码标准
├── design-system.md     设计系统（UI/UX 规范与品牌定义）
├── docker.md            Docker 构建 / 部署 / 验收（唯一出处）
├── operations.md         生产运维手册（备份/恢复/故障/验收）
├── commercial-readiness.md 商用就绪矩阵与交付阻断项
├── scripts.md           脚本索引
├── ci.md                GitHub Actions 索引
├── local-development.md 本地开发
├── INTEGRATION_GUIDE.md 接入验证指南（Gateway 代理模式）
├── portal-architecture-guidelines.md  Portal 结构与分层
├── glossary.md          领域词汇唯一真相源
├── roadmap.md           里程碑与取舍（时间倒序）
├── agent-governance.md  AI 治理技能标准与工作流（任务级流程见 .dsh/skills/）
├── agents/ (3)          Matt Pocock 技能套件的仓库级配置（issue tracker / triage 标签 / domain docs）
├── adr/ (30)            决策记录
├── research/ (3)        调研笔记
└── spec/ (9)            需求规格
```

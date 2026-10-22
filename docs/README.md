# 文档地图（从这里开始）

> 本仓文档很多，但**每份只该有一个职责**。这张表回答两个问题：**我要做什么 → 该读哪份**；
> **这份文档是不是权威**。读之前先看这里，比逐个 grep 快得多。

## 一、动手改代码之前必读

| 文档 | 管什么 | 何时读 |
|---|---|---|
| `AGENTS.md` | 工程约定、项目结构、测试体系、环境与门禁规则（**唯一出处**） | **每次动手前** |
| `CODING_STANDARDS.md` | 编码标准（含"单一真相源""数字必须被断言"等） | 写/评审代码前 |
| `CONTEXT.md` | 领域词汇与 ADR 索引（**单上下文领域文档**） | 涉及领域概念时 |
| `docs/adr/`（22 篇） | 架构决策记录（**每条都有结论与理由**）；多数已补「验证」段 | 想知道"为什么长这样"时 |

## 二、按任务找文档

| 你要做的事 | 读这份 |
|---|---|
| 本地起服务、跑测试、接入验证 | [`docs/INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) + 根 `README.md` 快速开始 |
| Docker 构建 / 部署 / 验收（生产 ACME + 本地 test 栈 / `stack.sh` / e2e / 故障排查） | 根 `DOCKER.md`（**唯一出处**） |
| 改 Portal 的代码结构（分层、目录、错误体系、三层安全） | [`docs/portal-architecture-guidelines.md`](portal-architecture-guidelines.md) |
| 改 UI（颜色/字体/间距/组件规范） | 根 `DESIGN.md`（设计系统） |
| 查过去踩过的坑与当时的判断 | [`docs/solution/README.md`](solution/README.md)（**按主题索引 90 篇**） |
| 查需求与追溯 | [`docs/spec/`](spec/) + `tests/traceability/` |
| agent 侧约定（issue 流程、标签、领域文档） | [`docs/agents/`](agents/) |
| 技术调研笔记 | [`docs/research/`](research/) |
| 历史产物（旧审计/旧计划/旧规范） | [`docs/archive/README.md`](archive/README.md) —— **不作为现行规范引用** |

## 三、权威性与优先级

1. **代码与测试 > 文档**：文档与代码冲突时，先信代码，再修文档（本仓有专门守卫断言"声明↔发射"一致）。
2. **`AGENTS.md` / `CODING_STANDARDS.md` 是过程权威**；`docs/adr/` 是**决策权威**；`docs/portal-architecture-guidelines.md` 是**结构权威**。
3. **`docs/archive/` 只用于追溯**，不作为规范引用。
4. 同名事实只保留一个家：凡"两个地方各写一份、靠人记得同步"的，都在本仓的治理范围内（见 `docs/solution/` 的相关记录）。

## 四、目录速览

```
AGENTS.md  CLAUDE.md  CODING_STANDARDS.md  CONTEXT.md  DESIGN.md  DOCKER.md  README.md
docs/
├── adr/ (22)           决策记录
├── agents/ (3)         agent 侧约定
├── research/ (3)       调研笔记
├── solution/ (80)      经验与决策索引 ← 查"以前怎么处理的"
├── spec/ (11)          需求规格
└── archive/ (32)       历史产物（**不作现行引用**）
```

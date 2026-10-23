# 文档地图（从这里开始）

> 本仓文档很多，但**每份只该有一个职责**。这张表回答两个问题：**我要做什么 → 该读哪份**；
> **这份文档是不是权威**。读之前先看这里，比逐个 grep 快得多。

## 一、动手改代码之前必读

| 文档 | 管什么 | 何时读 |
|---|---|---|
| `AGENTS.md` | 工程约定、项目结构、测试体系、环境与门禁规则（**唯一出处**） | **每次动手前** |
| `CODING_STANDARDS.md` | 编码标准（含"单一真相源""数字必须被断言"等） | 写/评审代码前 |
| `docs/glossary.md` | 领域词汇唯一真相源（有界上下文、实体、生命周期） | 涉及领域概念时 |
| `docs/adr/`（22 篇） | 架构决策记录（**每条都有结论与理由**）；多数已补「验证」段 | 想知道"为什么长这样"时 |

## 二、按任务找文档

| 你要做的事 | 读这份 |
|---|---|
| 本地起服务、跑测试、接入验证 | [`docs/INTEGRATION_GUIDE.md`](INTEGRATION_GUIDE.md) + 根 `README.md` 快速开始 |
| Docker 构建 / 部署 / 验收（生产 ACME + 本地 test 栈 / `stack.sh` / e2e / 故障排查） | `docker/README.md`（**唯一出处**） |
| 改 Portal 的代码结构（分层、目录、错误体系、三层安全） | [`docs/portal-architecture-guidelines.md`](portal-architecture-guidelines.md) |
| 改 UI（颜色/字体/间距/组件规范） | 根 `DESIGN.md`（设计系统） |
| 查历史取舍与里程碑 | 根 `docs/roadmap.md`（变更记录按时间倒序） |
| 查需求与追溯 | [`docs/spec/`](spec/) + `tests/traceability/` |
| 技术调研笔记 | [`docs/research/`](research/) |

> **历史产物已清理**：`docs/archive/`（旧审计/旧计划/旧经验库）与 `docs/solution/`（按会话记录的决策与教训）
> 已于 2026-10-22 移出仓库。ADR / roadmap / research 里出现的这两类路径是当时的记录：需要原件时用
> `git log -- docs/archive docs/solution`（或初始提交 `64d3a9f`）取回，不要把这类引用当作现行导航。

## 三、权威性与优先级

1. **代码与测试 > 文档**：文档与代码冲突时，先信代码，再修文档（本仓有专门守卫断言"声明↔发射"一致）。
2. **`AGENTS.md` / `CODING_STANDARDS.md` 是过程权威**；`docs/adr/` 是**决策权威**；`docs/portal-architecture-guidelines.md` 是**结构权威**。
3. **历史材料已清理**（旧审计/旧计划/旧会话记录不再随仓库分发）：现行判断只依据代码、测试、`docs/adr/` 与 `docs/roadmap.md`。
4. 同名事实只保留一个家：凡"两个地方各写一份、靠人记得同步"的，都在本仓的治理范围内。

## 四、目录速览

```
AGENTS.md  CODING_STANDARDS.md  DESIGN.md  README.md
docs/
├── adr/ (22)           决策记录
├── research/ (3)       调研笔记
└── spec/ (7)           需求规格
docker/                 Docker 配置入口（compose / Dockerfile / README）
scripts/                工具脚本（docker / e2e / ci / bench，见 scripts/README.md）
```

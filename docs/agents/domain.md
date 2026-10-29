# Domain Docs

工程技能探索本仓时如何消费领域文档（本文件由 `/setup-matt-pocock-skills` 生成；本仓治理标准见 `docs/agent-governance.md`）。

## Before exploring, read these

- **`docs/glossary.md`**：本仓**领域词汇唯一真相源**。**不要新建根 `GLOSSARY.md`** —— 本仓 glossary 只有这一份（`AGENTS.md` 声明）。
- **`docs/adr/`**：架构决策记录（`ADR-NNN-*.md`，编号连续，当前 ADR-001～030）。只读与即将改动区域相关的条目。
- **`docs/roadmap.md`**：里程碑与取舍（时间倒序），需要「以前做到哪一步」时读。

文件不存在时**静默继续**：不提示缺失、不建议先创建；术语或决策真正落定时才更新。

## File structure

单上下文仓库（本仓）：

```
/
├── docs/
│   ├── glossary.md      领域词汇唯一真相源
│   ├── adr/             架构决策记录（ADR-NNN-*.md）
│   └── roadmap.md       里程碑与取舍
├── apps/                gateway / portal / demo-app
└── packages/            contracts / config
```

## Use the glossary's vocabulary

产出里命名领域概念（issue 标题、重构提案、假设、测试名）时，用 `docs/glossary.md` 的定义，不要漂移到 glossary 明确避免的同义词。概念不在 glossary 时：要么你在发明本仓不用的语言（重新考虑），要么确有缺口（记下，交给 `/domain-modeling`）。

## Flag ADR conflicts

输出与既有 ADR 冲突时明确指出来，不要静默覆盖：

> _与 ADR-NNN（决策名）冲突，但值得重开，因为……_

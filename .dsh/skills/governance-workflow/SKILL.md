---
name: governance-workflow
description: "六阶段治理工作流：审计→问题清单→方案→实施→验证→治理总结，含只读审计编排脚本与渐进落地路径。"
whenToUse: "用户要求系统审计、Agent 架构治理、跨模块大规模优化，或需要可复用治理流程时。"
metadata:
  suite: governance
---

# 六阶段治理工作流

## 定位

把治理原则变成可执行、可验收的流程。**默认只读产出审计与方案；任何代码修改都必须经过人工批准后再做**，不得让编排脚本直接修改生产代码。阶段与门禁的唯一定义在 `docs/agent-governance.md` §五；本技能只补充编排细节。

## 判据

1. 先理解系统再重构：阶段一未完成不得进入修改。
2. 阶段门禁逐级通过；证据不足 → 该项暂缓，不跳步。
3. 从**一个高价值问题**开始，不做大规模无关重构。
4. 实施前先有回归测试；清理旧守卫前先有等价性证据。
5. 每次迭代都复查历史机制是否仍然必要，防止复杂度回涨。
6. 阶段五的验证结论取退出码；未执行的检查如实标注。
7. 只读是**行为约束**：脚本体不能写文件，但审计子 agent 是完整 agent；无人值守场景须在只读沙箱 / 独立 worktree 运行。
8. 主会话优先：能在主会话完成的工作不派子 agent；fan-out 仅用于可独立并行、隔离有明确收益的审计线，并先说明理由。
9. 使用门槛与复审条件：以 `docs/agent-governance.md` §五为准——仅跨模块（≥ 2 个模块）、审计线可独立并行、主会话上下文不足时用编排；连续 2–3 次仅单模块使用且主会话可得同等产出时复审降级/删除。

## 流程

1. 阶段一至三可用只读编排脚本批量执行：读取 `scripts/governance-audit.workflow.mjs` 全文，作为 `workflow` 工具的 `script`；`args` 传 `{ scope, focus?, maxFindings? }`。
2. 脚本返回 `ok`、`failedLines`、`partial`、`audits`、`issues`、`proposals`；`ok: false` 表示子 agent 运行时失败，**不是**「没有问题」。契约见 `references/phases.md` §五。
3. 阶段四到六由主 Agent 执行：实施前加载 `governance-change-guard`，完成后加载 `governance-review`；新增或删除守卫按 `governance-ledger` 登记。
4. 产物写到 `.context/governance/<日期>/`（不提交）；长期结论沉淀到 ADR 或 `docs/roadmap.md`。
5. 场景范围、问题模板与渐进落地步骤见 `references/phases.md`；不要在技能正文里另建一份阶段表。

## 输出与验收

- 审计与方案报告写到 `.context/governance/<日期>/`（本地产物，不提交）。
- 每条问题按 `references/phases.md` §二 的模板书写；方案必须比较根因修复与架构修复。
- 阶段五执行真实命令并取退出码；阶段六输出治理总结（模板见 `references/phases.md` §三）。
- 涉及新增或删除守卫时，按 `governance-ledger` 登记并给出复审条件。

## 禁止

- 未理解现有结构就直接重构；顺手执行无关重构。
- 无测试、无证据删除安全机制；为了「优化成果」制造修改数量。
- 让编排脚本自动修改代码、配置或权限；跳过人工批准门。
- 把脚本 `readOnly: true` 当作已验证的权限隔离。
- 把审计发现直接当作已确认缺陷；把假设写成根因。

## 参考

- `references/phases.md`：问题模板、治理总结模板、渐进落地步骤、脚本输出契约。
- `scripts/governance-audit.workflow.mjs`：阶段一到三的只读编排脚本。
- `governance-architecture`、`governance-change-guard`、`governance-review`、`governance-ledger`。

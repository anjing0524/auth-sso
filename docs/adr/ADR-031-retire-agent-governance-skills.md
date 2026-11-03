# ADR-031: 退役 Agent 治理技能套件（删除 `.dsh/skills`）

| 属性 | 值 |
|---|---|
| **状态** | accepted / implemented (2026-11-03) |
| **日期** | 2026-11-03 |
| **决策者** | 用户（判定技能质量不合格，明确要求直接删除） |
| **影响范围** | `.dsh/`（删除）、`docs/agent-governance.md`（删除）、`apps/portal/__tests__/api/agent-governance-skills.test.ts`（删除）、`AGENTS.md`、`docs/README.md`、根 `README.md`、`docs/agents/domain.md`、ADR-027（标记 superseded）、`docs/roadmap.md` |

## 背景

1. ADR-027（2026-10-23）建立了 5 个 `governance-*` 技能、`docs/agent-governance.md` 标准文档与确定性守卫 `agent-governance-skills.test.ts`。
2. 2026-11-03 用户评审判定：这批技能**质量不合格**，要求直接从仓库删除，不要求先修复或替换。删除是用户的直接指令，本 ADR 只记录删除范围、保留项与遗留影响，不把用户的主观质量判断写成可复算的证据。
3. 删除本身会打破既有一致性：守卫要求 ≥5 个技能目录、`docs/README.md` 声明技能计数、导航文档与 `AGENTS.md` 指向标准文档；因此删除必须连同其专属守卫与导航一起收口，否则留下变红的守卫与死引用。
4. ADR-027 中仍然成立的部分是「单一入口」约束：本仓不维护 `.claude/`、`.agents/`、`CLAUDE.md`、`skills-lock.json` 等第二套 Agent 配置。该约束与技能套件无关，必须保留。

## 决策

1. **删除技能资产**：移除整个 `.dsh/` 目录（5 个 `governance-*` 技能、其 `references/`、`scripts/governance-audit.workflow.mjs`，以及 `.dsh/README.md`）。仓库不再包含任何 `.dsh/skills/` 技能。
2. **删除配套标准文档**：移除 `docs/agent-governance.md`。它的职责是技能格式/路由/生命周期与六阶段工作流标准；技能删除后该文档只剩对已不存在资产的描述，保留即死引用。六阶段工作流与台账标准随文档一并删除，需要时用 `git log -- docs/agent-governance.md` 取回（ADR-027 只记录该机制的决策概要，不含正文）。
3. **删除专属守卫**：移除 `apps/portal/__tests__/api/agent-governance-skills.test.ts`。该守卫的唯一保护目标是技能套件（frontmatter/章节/资源/清单同步/脚本失败路径），随被保护对象一起退役。
4. **保留单入口约束**：在 `AGENTS.md` 的「文档与流程」中保留一句话，明确 Agent 配置唯一入口与旧配置不回归；该约束此后**没有确定性守卫**，属于残余风险（见「后果」）。
5. **历史不改写**：ADR-027 标记为 `superseded` 并指向本文；`docs/roadmap.md` 中 2026-10-23/10-26 的历史条目按原样保留；不引入替代技能套件——用户未要求替代品，新增技能须另行立标准。

## 后果

- 正面：删除 666 行技能资产、107 行标准文档与 323 行专属守卫；仓库不再维护一套未被实际加载的规则系统（技能是运行时输入，格式错误还会被 DSH 静默跳过）。上下文与维护成本同时下降。
- 负面：六阶段治理工作流与守卫台账标准不再有现行文档，只能从 git 历史取回（ADR-027 仅记录决策概要）；若日后重启治理流程，需要重新建立标准与验证。
- 残余风险：①「单入口」不再有确定性守卫，只是 `AGENTS.md` 的叙述规则；②技能删除后，`docs/roadmap.md` 历史条目仍提及 `.dsh/skills`、`docs/agent-governance.md`，这是历史记录（与 ADR 同等待遇），不作为现行导航；③本仓不再有 Agent 治理技能可供会话加载，按 ADR-027 建立的按任务加载路由此后失效。
- 复审条件：若再次引入任务级技能，先按需重建标准与守卫，不复活本次删除的目录结构而不带验证。

## 验证

- 文档守卫（真实执行）：`npx vitest run apps/portal/__tests__/api/docs-claims.test.ts apps/portal/__tests__/api/docs-references.test.ts apps/portal/__tests__/api/docs-api-error-codes.test.ts` → 3 文件 / 13 用例通过，退出码 0（ADR 计数 31、`docs/README.md` 目录计数、`AGENTS.md` 的 `@/` 指针一致）。
- 全量门禁（真实执行）：`pnpm test` → **148 文件 / 1225 用例通过，EXIT 0**；被删守卫原含 12 条用例，删除后无新增失败。
- 静态检查：`pnpm -r typecheck` EXIT 0；`pnpm -r lint` EXIT 0（0 errors / 133 warnings，均为既有基线，本次无新增）。
- 引用复核：在 `docs/adr/` 与 `docs/roadmap.md` 历史记录之外，全仓只有 `docs/README.md` 的「已退役资产」说明与 `AGENTS.md` 的退役句提及 `.dsh/` / `docs/agent-governance.md`；本次改动过的导航文档相对链接扫描 **0 死链**。
- 运行时复核：删除后 DSH 会话技能目录不再列出 `governance-*` 技能（catalog 已更新），确认 `.dsh/skills/` 是唯一来源。
- 未执行：e2e / cargo / clippy（本变更不涉及运行态与 Rust）；未验证「未来不会重新引入第二套 Agent 配置」——该约束已无确定性守卫，如「后果」所列。

## 相关 ADR

- ADR-027：本机制的原决策，现已 superseded。
- ADR-019：行数不是复杂度的好代理——本次删除不以行数为质量判据，行数只用于说明删除规模。
- ADR-022：测试真实性策略——退役守卫时如实标注失去的覆盖，不用更弱的检查冒充等价。

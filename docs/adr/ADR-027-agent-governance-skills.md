# ADR-027: AI 治理工作流与技能标准化（`.dsh/skills` 单入口）

| 属性 | 值 |
|---|---|
| **状态** | implemented (2026-10-23) |
| **日期** | 2026-10-23 |
| **决策者** | Auth-SSO 团队（用户指派：创造治理工作流 + 标准化 skills） |
| **影响范围** | `.dsh/skills/`、`docs/agent-governance.md`、`AGENTS.md`、`docs/README.md`、根 `README.md`、`docs/roadmap.md`、新增守卫测试 |

## 背景

1. 用户提供了一套 AI Agent 系统架构治理方法论（架构优先于守卫、不变量优先于重复检查、每条守卫必须可验证、删除与新增同等验证、系统进化必须降低长期复杂度），要求落成**可执行的工作流与标准化技能**，而不是又一段长提示词。
2. 2026-10-22 已决定清理散布的 AI 配置（`CLAUDE.md`、`.claude/`、`.agents/`、`skills-lock.json`），将唯一入口收敛到根 `AGENTS.md`；原因是内容过期、与现行 ADR 冲突、与 `AGENTS.md` 重复。因此不能退回「多份配置各写一套」的形态。
3. 当前运行环境（DSH）具备原生技能发现：项目根 `.dsh/skills/<name>/SKILL.md`，会话目录只展示名称与描述，正文按需加载。技能是**运行时输入**：frontmatter 非法会被静默跳过，因此必须有确定性守卫。
4. 方法论包含四种生命周期不同的内容：常驻原则、每次修改前的决策、修改后的审查、守卫台账与跨模块工作流。全部塞进 `AGENTS.md` 会让每次调用都携带长文，与「提示词本身也不能无限膨胀」相悖。

## 决策

1. **单入口、按任务分层**：任务级流程放 `.dsh/skills/`，不再新增 `.claude/`、`.agents/` 或平铺配置；`AGENTS.md` 只保留一句指针，不复制技能内容。
2. **治理技能套件（5 个）**：`governance-architecture`、`governance-change-guard`、`governance-review`、`governance-ledger`、`governance-workflow`；统一 frontmatter、固定章节、单文件 ≤ 160 行，细节进 `references/`。
3. **工作流只读起步**：`governance-workflow` 提供六阶段流程；`scripts/governance-audit.workflow.mjs` 只编排阶段一到三（审计 → 问题清单 → 方案比较），脚本体没有文件、网络或定时器能力。**注意**：审计由 `agent()` 子 agent 执行，它们是完整 agent，「只读」是行为约束而非权限隔离；`readOnly: true` 不是安全保证，无人值守场景必须在只读沙箱或独立 worktree 中运行。输出契约（`ok` / `failedLines` / `partial`）见该技能 `references/phases.md` §五；任何写操作需人工批准后由主 Agent 执行。
4. **标准唯一**：技能格式、路由、生命周期、台账与工作流标准写在 `docs/agent-governance.md`；技能正文只写「怎么做」；六阶段表、台账字段、审查清单各自只有一个权威出处。
5. **确定性守卫**：新增 `apps/portal/__tests__/api/agent-governance-skills.test.ts`，机械校验 frontmatter（严格 YAML 子集）、行级固定章节、资源存在、正文预算、标准清单与 `docs/README.md` 计数同步、唯一入口（旧 AI 配置不回归）、编排脚本可解析且失败路径**真实执行**后返回 `ok:false`，跑在既有 `pnpm test` 内（零新增 CI 步骤）。
6. **导航同步**：`docs/README.md`、根 `README.md`、`AGENTS.md`、`docs/roadmap.md` 更新；ADR 计数变为 27。

## 后果

- 正面：治理方法论从「一次性长提示词」变为按需加载的可执行流程；技能格式与清单由守卫防止漂移；`AGENTS.md` 不再膨胀；工作流可复用于其他模块。
- 代价：新增 5 个技能与 1 份标准文档的维护责任；技能会随项目演进而过期，因此设生命周期与复审条件（删除前必须有证据）。
- 风险与缓解：技能与其他规则重复 → 标准强制「一条约束只写一处」并由守卫检查清单同步；技能被误删或格式变坏 → 守卫在 `pnpm test` 内变红；frontmatter 非法被 DSH 静默跳过 → 守卫解析 frontmatter 并断言可加载字段；子 agent 失败被误读为「无发现」→ 脚本显式返回 `ok:false`，部分失败记 `failedLines` + `partial`。

## 验证

- 治理守卫：`pnpm vitest run --project @auth-sso/portal-api apps/portal/__tests__/api/agent-governance-skills.test.ts` → **12/12 通过**。变异验证：删掉标准文档 §三 表里 `governance-review` 一行 → 守卫变红（1 failed / 11 passed），随后还原。
- 文档守卫：`docs-claims` / `docs-references` / `docs-api-error-codes` → **13/13 通过**（ADR 计数 27、导航链接一致）。
- 静态检查：被改测试文件 `npx eslint` exit 0；`pnpm --filter @auth-sso/portal typecheck` exit 0。
- 全量门禁：`pnpm test` **EXIT 0，135 文件 / 1161 用例通过**（最终复跑，未用管道污染退出码）。
- 会话加载：DSH `skill` 工具按名称加载 `governance-workflow`、`governance-review` 成功（返回正文与 base directory），5 个技能全部出现在会话技能目录。
- 工作流试运行（`apps/portal/src/lib/authz`）：
  - 第一次：子 agent 全部返回 null（本会话子代理运行时失败），首版脚本把「基础设施失败」静默读成「无发现」——已修为 `ok:false` + `error` + `failedLines`，并补 `partial` 契约；该失败路径现由守卫真实执行覆盖。
  - 重试：`ok:true, partial:false`，产出 2 份审计、合并问题清单与方案比较，识别出 Q1(P1，空 `targets` 使写门面可空转) 与 Q2–Q5 等真实问题；方案产物在 `.context/governance/2026-10-23/solution-comparison.md`（gitignore，不随仓库分发）。**本批不修复这些缺陷**：它们是试运行产出，按工作流阶段四需人工批准后另立批次，待办见 `docs/roadmap.md` 续一百。
- 未执行：e2e / cargo / clippy（本变更不涉及 Rust 与运行态）；未把 `.dsh/skills` 的 DSH 运行时行为当作已验证安全边界。
- 约束边界：本 ADR 的技能行数预算只用于控制上下文成本，不作为质量判据（与 ADR-019「行数不是复杂度的好代理」不冲突）。

## 相关 ADR

- ADR-019：不设行数上限，行数不是复杂度的好代理。
- ADR-022：测试真实性策略（守卫真实驱动、类型化 mock）。

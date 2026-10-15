@AGENTS.md

# CLAUDE.md

工程约定、项目结构、技术栈、测试环境的**唯一出处**是 `AGENTS.md`（本文件不复制）。
技能路由见 `ask-matt` —— 那张地图就是全部入口，本文件不再抄一份。
命令清单以根 `package.json` 的 `scripts` 为准；各命令的**语义**见 `AGENTS.md` 的「测试体系」。
下面只留 Claude Code 侧另需的两件事。

## 测试分层（分层职责；环境与 project 配置在 `AGENTS.md`）

| 层 | 位置 | 环境 / 框架 | 范围 | 命令 |
|---|---|---|---|---|
| 单元 / 组件 | `apps/*/__tests__/{components,domain,helpers}` | jsdom + Vitest | 渲染、交互、纯函数；外部 UI 原语与数据源可 mock | `pnpm test:components` |
| API | `apps/*/__tests__/api/*.test.ts` | node + **真实 PostgreSQL / Redis** | route 与 action 的校验、鉴权、CRUD、数据范围过滤 | `pnpm test:api` |
| E2E | `tests/e2e/*.spec.ts` | Playwright（仅 Chromium） | 登录冒烟与 Docker 发布栈闭环 | `pnpm test:e2e` |

API 层里生产业务模块的模块级 mock 必须是**类型化工厂**（`vi.mock(import('…'), (): Partial<typeof xModule> => …)`）
并带 `// @allow-module-mock <target> <kind>: <理由>`；签发/验签/撤销/登录/权限/审计等安全语义**真实驱动**。
规则出处 `docs/adr/ADR-022-test-authenticity-strategy.md`，由 `__tests__/api/module-mock-guard.test.ts` 在 `pnpm test` 内强制。
**没有**"关键测试文件清单"：目录就是清单（清单会过期，见 `AGENTS.md` 的门禁结论一条）。

## 追溯（`@req`）

`tests/traceability/generate-report.mjs` 扫测试文件里的 `@req` 注解（文件级 JSDoc 与行级注释都算），
与 `docs/spec/REQUIREMENTS_MATRIX.md` 对齐，生成 `tests/traceability/.generated/coverage-report.md`（本地生成，不提交）。
写法：单 ID · 逗号并列 · 区间 `AUTH-001~005` · 斜杠 `F-DEP-L/C/U/D` · 混写。
**报告是需求映射清单，不是门禁**；阻断门禁是 Vitest / lint / typecheck / Docker 发布验收。

## Agent skills

- 议题在 GitHub Issues（`anjing0524/auth-sso`，走 `gh` CLI）：`docs/agents/issue-tracker.md`
- 五个 triage 标签保持默认：`docs/agents/triage-labels.md`
- 单上下文领域文档：根 `CONTEXT.md` + `docs/adr/`（ADR-001~022）：`docs/agents/domain.md`

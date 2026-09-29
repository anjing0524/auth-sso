# AGENTS.md 过时声明清理（与仓库实况对齐）

日期：2026-09-28

## 问题

AGENTS.md 中多处事实性声明与仓库实际状态脱节，会误导后续开发（例如按 `src/app/[bc]/` 找目录、按 4100 调 E2E、以为 API 测试靠行级注解切环境）。逐条核对后修订如下：

| 过时声明 | 仓库实况（证据） | 修订 |
| --- | --- | --- |
| 分层目录 `src/app/[bc]/` | 实际为 `src/app/(dashboard)/` 路由组（`docs/portal-architecture-guidelines.md` 中也无 `[bc]` 写法） | 已改 |
| E2E baseURL `http://localhost:4100` | `playwright.config.ts` 默认 `http://127.0.0.1:4102`，可被 `E2E_BASE_URL` 覆盖 | 已改 |
| "jsdom 默认环境 + API 行级 `@vitest-environment node` 覆盖" | project 级环境：`vitest.api.config.ts` 全局 `node`，`vitest.ui.config.ts` 全局 `jsdom` | 已改 |
| `vitest.base.ts` 含 coverage/timeout | 仅导出 `testTimeout`，coverage 在根 `vitest.config.ts` | 已改 |
| projects 仅列 portal 两个 | 根 `vitest.config.ts` 聚合三个，还有 `packages/contracts/vitest.config.ts` | 已补 |
| "禁止 `#[async_trait]`" | Pingora 框架 trait（`ProxyHttp` 等）签名由框架固定，实现必须 `#[async_trait]`（`redirect.rs`、`acme.rs`、`tls.rs`、`jwks.rs`、`redis.rs`、`gateway.rs` 均在用） | 已改为"自定义 Trait 走零开销、Pingora 回调属例外" |

## 最佳实践

1. 文档中的事实性声明（路径、端口、配置项、版本）必须可与仓库交叉验证；修订前先用 `ls`/`grep` 取证，再动笔。
2. 约定与代码冲突时先定性：是"代码欠账"还是"约定过时"。框架强制的模式（如 Pingora 的 `#[async_trait]`）写成例外条款，不写一刀切禁令。
3. 目录重命名/迁移后（如 `docs/solutions` → `docs/solution`），全局 grep 旧路径并同步引用；本次仍发现旧目录 `docs/solutions/` 与根目录 `.orig/` 遗留待归档。

# 跨语言契约要有双端断言面 —— 「注释同步」不是契约（架构评审 R2 候选 R8）

> 日期：2026-10-13
> 来源：improve-codebase-architecture 架构评审第二轮（Strong 候选 R8，报告 `.arch-review/architecture-review-20261013-100205.html`）
> 关联 ADR：ADR-013（跨语言 claims 契约，本次沿用其 `jwt-claims-fixture.json` 机制）、ADR-009（Gateway OAuth 流程）、ADR-022（契约交给编译器 / 真实驱动）
> 词汇：module / interface / seam / leverage / locality（codebase-design）

## 一、问题总结

Portal（TypeScript）与 Gateway（Rust）共享一批**字面量**，而它们在 Rust 侧是**手写常量**，
靠注释同步（`// 与 @auth-sso/contracts \`XXX\` 同步`）：

| 值 | TS 侧（contracts） | Rust 侧 |
|---|---|---|
| Cookie 名 ×6 | `COOKIE_NAMES.*` | `cookie::{ACCESS,REFRESH}_COOKIE`、`oauth::*_COOKIE`（**private**） |
| 注入头 ×2 | `GATEWAY_HEADERS.USER_ID/USER_JTI` | `gateway.rs` 内联 `"X-User-Id"` / `"X-User-Jti"` |
| AT 的 typ | `JWT_TYP.ACCESS_TOKEN` | `verify::JWT_TYP_ACCESS`（private） |
| jti 黑名单前缀 | `REDIS_KEY_PREFIX.JTI_BLOCKLIST` | `verify.rs` **内联在 format! 里** |
| scope 集合 | `SCOPES_SUPPORTED` | `oauth_flow.rs` **内联在 URL 格式串里** |
| Discovery 字段名 ×2 | Portal 路由里**内联** | `jwks::CUSTOM_FIELD_*` |

唯一的跨语言契约机制（`jwt-claims-fixture.json`）只覆盖 **claims 字段**；上面这些值全在它之外。

### 为什么两端测试都没抓到

**每一侧都只断言自己那一份。** `constants.test.ts:169-193` 只断言 `COOKIE_NAMES` 非空、
前缀匹配 `/^portal:/`，不断言值；Rust 侧此前**根本没有**对这批常量的断言。于是四种改动
全都"两端都绿"：

| 单侧改动 | 后果 |
|---|---|
| Portal 改 cookie 名 | Gateway 静默读不到 cookie |
| Gateway 改 jti 前缀 | **撤销静默失效**（Gateway 写 A、Portal 读 B） |
| Discovery 字段改名 | Gateway 靠**旧名回退**继续工作 → 看不出坏了 |
| 收窄 Portal client 的 scopes | `/authorize` 跳转拿到 `invalid_scope` |

注意第三行：那两个字段名数组**故意**含旧名（部署错序容忍），所以单侧改名**不会**失败——
它只会静默降级。这正是"必须由测试断言，而不能靠运行时发现"的典型。

## 二、修复方案

沿用 `jwt-claims-fixture.json` 的**同一机制**，新增契约工件
`packages/contracts/src/cross-language-fixture.json`，两端各有测试断言**本端常量 == 工件值**：

| 侧 | 测试 | 消费方式 |
|---|---|---|
| TS | `packages/contracts/src/__tests__/cross-language-fixture.test.ts` | `import fixture from '../cross-language-fixture.json'` |
| Rust | `apps/gateway/src/contract_tests.rs`（新模块） | `include_str!` + `serde_json::Value` |

**为让契约值"可被断言"，几处内联字面量必须先提取成具名常量**（这本身也是修复的一部分——
没有名字的值无法被断言，也无法被引用）：

- `verify.rs`：`check_jti` 里的 `format!("portal:jti_blocklist:{}")` → `JTI_BLOCKLIST_PREFIX`
- `oauth_flow.rs`：URL 格式串里的 `scope=openid+profile+email+offline_access` → `AUTHORIZE_SCOPE_QUERY`
- `gateway.rs`：两处注入头的字面量 → `HEADER_USER_ID` / `HEADER_USER_JTI`
- `oauth.rs` / `verify.rs`：4 个 cookie 常量与 typ 由 private 改 `pub(crate)`（供契约测试断言）
- `oidc.ts`：新增 `DISCOVERY_CUSTOM_FIELDS`，Portal 的 discovery 路由改为引用它（此前是内联）

### 大小写：头名是有意的放宽

HTTP 头名大小写不敏感：contracts 用小写 `x-user-id`，Gateway 写 `X-User-Id`。工件里存
**规范小写形态**，Rust 侧用 `eq_ignore_ascii_case` 比较，并**先断言工件值本身是小写**
——这样"忽略大小写"是有意的放宽，而不是拿来掩盖真实漂移。

## 三、纳入与不纳入（不纳入的必须写明理由）

| 值 | 纳入 | 理由 |
|---|---|---|
| Cookie ×6（jwt/refresh/pkce_verifier/oauth_state/oauth_nonce/return_to） | ✅ | 一侧写、另一侧读 |
| 注入头 ×2（user_id/user_jti） | ✅ | Gateway 注入、Portal 读取 |
| `JWT_TYP.ACCESS_TOKEN` | ✅ | Portal 签发、Gateway 校验 |
| `REDIS_KEY_PREFIX.JTI_BLOCKLIST` | ✅ | Portal 写、Gateway 读 |
| `SCOPES_SUPPORTED` | ✅ | Gateway 在 `/authorize` 请求、Portal 校验 |
| Discovery 自定义字段名 ×2 | ✅ | Portal 发布、Gateway 探测 |
| `COOKIE_NAMES.LOGIN_SESSION` | ❌ | Gateway 源码 grep 不到该标识——仅 Portal 内部读写 |
| `JWT_TYP.LOGIN_SESSION` / `ID_TOKEN` | ❌ | Portal 自己签发与校验；Gateway 只验 AT |
| `REDIS_KEY_PREFIX.USER_JTI/USER_PERMS/AUTH_REQUEST/LOGIN_FAIL` | ❌ | 无 Gateway 消费方 |
| `GATEWAY_HEADERS.USER_NAME` | ❌ | **既不被 Gateway 注入，也不被 Portal 读取**（Portal 只读 USER_ID/USER_JTI）。保留定义属历史——把它写进工件会谎称"有一侧在读它" |

排除项在 TS 测试里有对应的"明确不纳入"用例，把理由写在断言旁。

## 四、验证

### 变异验证：单侧漂移必须变红（两侧各验一次）

| 变异 | 结果 |
|---|---|
| Rust 侧 `JTI_BLOCKLIST_PREFIX` 去掉尾部冒号 | `contract_tests::jti_blocklist_prefix_matches_fixture` **唯一变红**（1 红 / 133 绿） |
| TS 侧 `COOKIE_NAMES.JWT` 加后缀 | `跨语言字面量契约 — TS 侧 > Access / Refresh Token 名一致` **唯一变红**（1 红 / 55 绿） |

两边都还原后哈希逐字一致（Rust `023c4ed46e92dad0…16f1e58`、TS `d2e4e6b69d30815d…9930f7`）。
两点值得注意：①第一处变异此前是**完全静默**的（撤销失效）；②两侧测试**互不依赖**，
各自独立锚定同一工件。

### 门禁

| 门禁 | 结果 |
|---|---|
| `cargo clippy --all-targets --all-features -- -D warnings` | 0 警告 |
| `cargo fmt --all -- --check` | 通过 |
| `cargo test --all-features` | **134 通过**（新增 6 条契约测试）+ 7 doctest |
| `pnpm test` | **86 文件 / 725 用例全绿**（修复前 85 / 713；contracts 新增 12 例） |
| `tsc --noEmit`（portal / contracts） | 0 错误 |

## 五、最佳实践（可复用）

1. **"注释同步"不是契约，是愿望。** 契约需要三样东西：**唯一真相源**（工件）、**两端的断言**、
   以及**任一侧漂移必然变红**。缺任何一样，它就是一条会随人走神的注释。
2. **单侧改名的后果越"安静"，越需要测试来断言。** Discovery 字段名有旧名回退、
   `isJtiRevoked` 漂移只表现为"撤销没生效"、头名大小写天然不敏感——这些都不是 runtime 能发现的。
   **可观测性差的契约优先纳入断言面。**
3. **契约值必须先有名字。** 内联在格式串里的 `scope=...`、拼在 `format!` 里的键前缀，
   技术上无法被断言。**提取具名常量是纳入契约面的前置步骤**，而不是顺手的重构。
4. **"纳入"与"不纳入"都要写理由。** 本次逐条核对 6 组纳入值，并把 `LOGIN_SESSION`、
   `USER_NAME`、三个 Portal 私有前缀写成"不纳入 + 理由"——否则下一位读者会把排除项当成漏修。
   `USER_NAME` 尤其值得记：它**两端都没人用**，写进工件会凭空发明一个消费方。
5. **同一机制要复用到极致。** 本仓已有 `jwt-claims-fixture.json` 的双端消费范式
   （TS `import` + Rust `include_str!`），新增契约面时**直接沿用**比另发明一套便宜得多，
   也让"这个仓库怎么管跨语言契约"只有一个答案。

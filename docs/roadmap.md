# Auth-SSO 系统路线图

本文档记录各模块完成状态与版本规划，与 docs/spec/REQUIREMENTS_MATRIX.md 联动。

## 模块状态

| 模块 | 状态 | 版本 | 备注 |
|------|------|------|------|
| 用户管理（CRUD/状态/改密） | ✅ 已交付 | v1.1 | 含密码历史 NFR-SEC-15 |
| 角色管理（RBAC v3.2） | ✅ 已交付 | v1.1 | 角色归属部门模型 |
| 权限管理（统一权限树） | ✅ 已交付 | v1.1 | DIRECTORY/PAGE/API 三类型 |
| 部门管理（物化路径树） | ✅ 已交付 | v1.1 | ancestors 子树查询 |
| OAuth 2.1 Provider | ✅ 已交付 | v1.1 | PKCE + 授权码 + Token 轮换 |
| OIDC Discovery | ✅ 已交付 | v1.1 | 含 end_session_endpoint |
| Gateway 边缘入口 | ✅ 已交付 | v1.3 | Pingora + ES256 + HMAC；默认自托管 ACME/ARI，平台 TLS 构建编译期裁剪 ACME |
| 审计日志（180天分区） | ✅ 已交付 | v1.1 | append-only |
| 暴力破解防护 | ✅ 已交付 | v1.1 | Redis INCR 锁定 |
| SAML 2.0 | 🔲 待评估 | P2 | 未在本期范围，企业对接需求驱动 |
| OIDC RP-Initiated Logout | 🔲 待评估 | P2 | 当前用自定义 revoke 实现 |
| 多租户隔离 | ❌ 范围外 | - | PRD §2.2 明确排除 |

## 变更记录

- 2026-10-13（续七）: 架构评审 R2 候选 **R8 落地——跨语言契约要有双端断言面**。Portal（TS）与 Gateway（Rust）共享一批**字面量**，而 Rust 侧全是手写常量、靠注释同步（`// 与 @auth-sso/contracts \`XXX\` 同步`）：Cookie 名 ×6、注入头 ×2、AT 的 typ、jti 黑名单前缀、scope 集合、Discovery 字段名 ×2。既有唯一的跨语言机制（`jwt-claims-fixture.json`）**只覆盖 claims 字段**，这些值全在它之外；而**每一侧只断言自己那一份**（`constants.test.ts` 对 COOKIE_NAMES 只断言非空与前缀、不断言值；Rust 侧根本没有断言）⇒ 四种单侧改动全都"两端都绿"：改 cookie 名则 Gateway 静默读不到；**改 jti 前缀则撤销静默失效**（Gateway 写 A、Portal 读 B）；**改 Discovery 字段名因旧名回退而静默降级**；收窄 client scopes 则 `/authorize` 跳转拿到 `invalid_scope`。修复：沿用 `jwt-claims-fixture.json` 的**同一机制**新增 `packages/contracts/src/cross-language-fixture.json`，TS 侧 `cross-language-fixture.test.ts`（12 例）+ Rust 侧新模块 `src/contract_tests.rs`（6 例）各断言「本端常量 == 工件值」；**为让契约值可被断言，几处内联字面量先提取为具名常量**（`verify.rs` 的 `format!("portal:jti_blocklist:{}")` → `JTI_BLOCKLIST_PREFIX`；`oauth_flow.rs` URL 格式串里的 `scope=…` → `AUTHORIZE_SCOPE_QUERY`；`gateway.rs` 两处注入头 → `HEADER_USER_ID/JTI`；cookie/typ 常量由 private 改 `pub(crate)`；`oidc.ts` 新增 `DISCOVERY_CUSTOM_FIELDS` 并让 discovery 路由引用它——此前是内联）。头名大小写刻意放宽（工件存规范小写、Rust 用 `eq_ignore_ascii_case`，并**先断言工件值本身是小写**，使放宽是有意的而非掩盖漂移）。**纳入与不纳入都写理由**：纳入 6 组；不纳入 `COOKIE_NAMES.LOGIN_SESSION`（Gateway grep 不到）、`JWT_TYP.LOGIN_SESSION/ID_TOKEN`、三个 Portal 私有 Redis 前缀、`GATEWAY_HEADERS.USER_NAME`（**两端都没人用**，写进工件会凭空发明一个消费方）——排除项在 TS 测试里有对应"明确不纳入"用例。验证：**两侧各一次变异**——Rust `JTI_BLOCKLIST_PREFIX` 去掉尾冒号 → `contract_tests::jti_blocklist_prefix_matches_fixture` **唯一变红**（1 红/133 绿）；TS `COOKIE_NAMES.JWT` 加后缀 → cookie 名断言**唯一变红**（1 红/55 绿）；两边哈希逐字还原。门禁 `cargo clippy -D warnings` 0 警告 / `cargo fmt --check` 通过 / `cargo test` **134 通过**（+6）/ `pnpm test` **86 文件 725 用例全绿**（+12）/ `tsc`（portal+contracts）0 错误。沉淀 `docs/solution/2026-10-13-cross-language-contract-fixture.md`。

- 2026-10-13（续六）: 架构评审 R2 候选 **R7 落地——续签结果必须有名字**（Rust/Gateway 侧第一条）。`TokenRefresher::try_refresh` 的 `-> Option<RefreshedTokens>` 把**四种语义完全不同**的情况压成同一个 `None`（Portal 已轮换 / Portal 判定无需续签 / 30s 去重命中 / 全部端点失败），调用侧 `try_refresh_session -> bool` 又坍缩第二次。**真实缺陷**：`decode_jwt_payload(&new_tokens.access)` 失败时直接 `return false`，于是 `ctx.refreshed_tokens` 保持 `None` → `response_filter` 不下发 Set-Cookie → 浏览器继续持有**已被 Portal 撤销的旧 RT**（Portal 在同一已提交事务里撤销旧 RT 并写入新 RT）→ 下次续签命中**复用检测** → **家族级联撤销，连该用户其他正常会话一起失效**。一次"新 AT 解不开"的边缘情况，代价是用户被登出并波及其他会话。测试没抓到的原因：当时唯一的纯函数测试（`refresh_failure_blocks` 6 条真值表）测的正是**坍缩之后的那一位**，而 `try_refresh_session` 整条路径（含 Cookie 是否记入 `ctx`）因需要 Pingora `Session` 而零覆盖。修复：①`RefreshOutcome` 具名四态（`Rotated`/`Skipped`/`Deduped`/`Failed`）；②纯转移函数 `refresh_effect(expiry, outcome) -> RefreshEffect`，**不变量写进类型**：`Rotated ⇒ tokens 恒为 Some`（与 payload 是否可解码、是否阻断无关）；`outcome: None` 表示**未尝试**（缺 RT/缺身份），与 `Failed` 影响相同但事实不同故不压成一个值；解不出新身份时 NearlyExpired 用旧 AT 继续、Expired 必须阻断——**两种情况新 Cookie 都要下发**；③**三条终局路径都要能送达**（这是本候选唯一需要在三处下发的原因：Pingora 的 `response_filter` 只对被代理的请求运行，本地生成的 401/302 不经过它）：放行经 `response_filter`（原有）、阻断 401 经新增 `SessionExt::respond_401_with_cookies`、HTML 重登 302 经新增 `oauth_authorize_redirect(..., extra_cookies)`。**同类普查**（全部 `-> bool` / `-> Option<…>`）：认证路径上唯一的多义坍缩就是 `try_refresh`，其余均为**单义**谓词（`is_html_page_navigation`/`is_identity_header`/…）或查找（`extract_from_header`/`query_param`/…）；ADR-009 当年已把 `Result<bool>` 改为 `AuthDecision` 三态，本轮是同一纪律在**下一层**的补齐。验证：**变异**（把修复前行为注回：Rotated 且 payload 解不出时 `tokens = None`）→ **恰好 1 条变红**（`rotated_always_delivers_tokens`，即那条不变量测试）/ 127 绿；哈希 `e838aa65ffc71ff7…6de643` 逐字还原。门禁 `cargo clippy --all-targets --all-features -- -D warnings` 0 警告 / `cargo fmt --check` 通过（首次一处差异已 fmt）/ `cargo test --all-features` **128 通过**（新增 5 条纯函数测试）+ 7 doctest。**覆盖缺口如实记录**：`respond_401_with_cookies` 与 302 的 `extra_cookies` 是响应写出、需要 Pingora `Session`，而本仓 Gateway 无 `tests/` 集成测试台、Docker 发布旅程只覆盖正常路径 ⇒「阻断时新 Cookie 是否真出现在响应头」目前无自动化断言（已记为下一轮候选）。文档：沉淀 `docs/solution/2026-10-13-refresh-outcome-named.md`；**修订 ADR-009 决策 5** 的示例（加修订注，说明布尔坍缩的后果与新的表示，实质决策不变）；修正 `docs/solution/redis-set-nx-ex-atomic-acquire.md` 里过期的 `try_refresh` 签名。

- 2026-10-13（续五）: 架构评审 R2 候选 **R6 落地——签发路径的权限分级收成一个 seam**。`getUserPermissionContext` 改成判别式联合（ADR-018）后，「签发场景如何消费它」被**写了两遍**（`oauth-grant.ts` 授权码兑换 与 `token.ts` RT 轮换，两段注释几乎逐字相同）：代价一是这条安全语义（"DB 抖动不得登出用户"）在两处独立维护、任何一处被"顺手简化"成 `if (!permResult)` 就会让 `unavailable` 重新变成拒绝；代价二是它**只能靠三个测试文件各自的替身开关**才被测到（"这条分级对不对"没有一处直接打靶）。而两条路径真正的差异不是判定而是**失败如何投递**（兑换返回判别式结果、轮换抛错以触发孤儿 RT 补偿回收）。修复：在 `lib/permissions.ts` 新增 `resolveIssuancePermission(userId)`，**紧邻 `toPermissionContextOrNull`**——同一个联合的两个 adapter 并列，语义差别一眼可读（判定场景两者都拒绝；签发场景 `unavailable` **照常签发**）；返回类型带 `prefilled: boolean`，把"因基础设施故障跳过预填充"变成**可在 seam 上直接断言的值**（压成 `{ok:true}` 就与"已预填充"同形——R3 的教训）。两个调用方各自保留投递方式。**本轮最大工作量在测试面**：改完后 **5 个测试文件变红**，根因是一个结构性事实——`resolveIssuancePermission` 调 `getUserPermissionContext` 是**模块内局部调用**，而 `vi.mock` 只替换导入方看到的导出，于是"mock 掉读上下文那一半"的老路在 seam 搬家后**彻底失效**（mock 还在却拦不住；裸部分替换还会让新导出变 `undefined`、被补偿回收兜住而表现为"轮换返回 null"）。处置不是搬 mock 而是**改用真实状态注入**：`oauth-grant`（denied 用真实 `DISABLED` 用户行、unavailable 用真实 `:unavailable` 标记）、`oauth2-token`（死替身直接删）、`rt-permission-failure`（`markUnavailable()` 写真身会读的那个键）、`rt-reuse-detection`、`authorization-code-storage` ⇒ **5 个文件的权限替身全部消失，签发路径不再依赖任何上下文替身**。验证：两次变异各自精确——`unavailable` 谎报为 `prefilled:true` → **1 红 / 3 绿**（只有 ADR-018 那条）；`denied` 改放行 → **2 红 / 2 绿**（只有 not_found/inactive）；正向对照（ACTIVE→ok 且真实回填）两种变异下都绿；哈希 `fc374e2d6f28a7ed…acbf7c` 逐字还原。**一次"变异没生效"的实测**：第二次变异我插在原有 `denied` 检查**之后**（死代码）→ 测试全绿；因"预期该红"而回头才发现**变异只改了文本没改行为**——ADR-021 记录的"变异验证本身需要被验证"再现，这次是靠"绿得不对"发现的。门禁 `tsc` 0 / `lint` 0 error（1 warning 既有，已用 `eslint --stdin` 对 HEAD 证明）/ `pnpm test` **85 文件 713 用例全绿**。文档：沉淀 `docs/solution/2026-10-13-issuance-permission-seam.md`；**修订 ADR-018 §4** 的分级表（调用方改为共用的 `resolveIssuancePermission` 并加修订注）。

- 2026-10-13（续四）: 架构评审 R2 候选 **R5 落地——批量部分失败的聚合收成一个原语**。「按 50 一批并发执行、单项失败不影响其他项、报告成败计数」这段逻辑在全仓被**抄了两遍**（`lib/permissions.ts` 的 `settleUserBatches` 与 `lib/session/revoke.ts` 的内联循环），且两份成败**极性相反**（`{ok}` vs `{revoked, failed}`）、结果类型各起一名（`BatchRefreshResult` / `BatchRevokeResult`）；两处注释甚至互相点名"这曾是同一形态"。代价不是重复而是**同一个 bug 被独立修了三次**（`a7fa3cb` → `ad530d6`（自述"与前一处的修法一致"）→ `7d38152`）：三处都用 `allSettled` 的 `rejected` 计数，而被调方**永不 reject**，故 `failed` 恒为 0；**第三次才发现根因更深——被调方自报的 `ok` 是假话**（对分级联合做真值判断），聚合侧再正确也无用。⇒ 真正的缺陷在 interface：它允许"自报成败"，而那个值可以是错的。修复：新建 `lib/batch.ts` 的 `settleInBatches`，interface **刻意不接受任何成败标记**——`operation` 返回 `Promise<void>`，**抛出即失败**（抛出是语言机制，不能被算错）；两个消费方各写**一层薄 adapter** 把"判别式结果"翻译为抛出（翻译只此一处），聚合侧只认异常；批大小 50 作为**实现细节**收进模块（原先两个文件各持一个同名常量）。**同类普查**刻意搜三类模式（`allSettled` 其他用法 / 其他分批循环 / 其他批大小常量）确认**全仓恰好 2 处、无第三处**——否则"收口"只是合并已知两处，第三处仍会以不同写法存在。验证：**变异**（把「failed 恒为 0」重新注入共享原语）→ **10 条来自 3 个文件的断言同时变红**，其中 6 条正是**当年为那两次独立修复写的**回归测试（`revoke-batch-result` / `permission-cache-refresh-result`）⇒ 收口后旧的回归测试自动升级为**共享原语**的守卫，同一个 bug 再也不能只在一份拷贝里复活；绿的 6 例是成功路径与分批并发断言；哈希 `f6e4716bc8a88d19…5405cb` 逐字还原。门禁 `tsc` 0 / `lint` 0 error、改动文件零新增告警 / `pnpm test` **84 文件 709 用例全绿**。沉淀 `docs/solution/2026-10-13-batch-settlement-primitive.md`；同步修正 `permission-cache-refresh-result.test.ts` 里对旧函数名的叙述。

- 2026-10-13（续三）: 架构评审 R2 候选 **R4 落地——收敛动作收成一个 module**。「权限决策变了 → 受影响用户重新拿到权限」这件事由两个**必须成对**的动作组成（撤销 AT 强制重登 + 刷新权限上下文缓存），但这一对**没有 module**：6~8 个写点各自手写配对，**四种形态并存**（`refresh→revoke`、`revoke→refresh` 反序、"条件撤"、"只刷不撤"），顺序成为隐式知识，漏掉一半没有任何信号，两个批量原语的返回值在**全部**调用点被丢弃——正是 ADR-019 诊断的「缺失的领域操作层」，那一层始终没有落点。新建 `lib/auth/authorization-effects.ts`（按架构指南的「领域操作（编排）」命名），只暴露两个具名动词：`revokeAndRefreshAuthorization`（决策变了）/ `refreshAuthorizationCache`（只改名/描述）——**不用布尔参数**（沿用「维度用函数名编码」纪律，`skipRevoke` 读不出语义且默认值会变成隐式第五种形态）。顺序固定**先撤销、后刷新**并写明理由：撤销是安全相关（决定旧凭据还能否用），刷新是缓存性（ADR-011 fail-open）；两者都失败时先撤后刷至少让强制重登生效，而重登时签发路径会预填充缓存 ⇒ **部分失败下自愈**。失败信号取 R3 的纪律：两个动词返回**不同类型**的结果（"撤销未尝试"与"撤销失败 0 个"必须分开），模块自身不记日志（两个批量原语各自记录，谁拥有知识谁记录）。**更正评审报告一处结论**：`getRoleBoundUserIds`（按角色求）与 `getAffectedUserIds`（按权限求，`userRoles ⋈ rolePermissions`）**不是**同一概念、**不可合并**，本候选只收口"施加效果"——报告也是二手材料，逐行核对后不成立。**同类普查**：8 处迁入 module；另 4 类"看起来像"的站点逐条写明不改的理由（`toggleUserStatusAction` 是账号生命周期；`reset-password` 是密码重置的会话终止；`force-logout` 是下线+清缓存；`logout`/`change-password` 是会话终止）——塞进来会让 module 的名字撒谎。验证：**两次变异**——A 顺序颠倒 → 恰好 2 条**顺序敏感**的断言变红、「成对发生」保持绿（证明测试组能分辨顺序与配对两件事）；B「只撤不刷」（历史四形态之一，**此前完全无声**）→ 4 条变红，含 module 级与端到端级**两条独立**配对断言；两次哈希均逐字还原（`02fa5470ffc577fa…9563d4`）。门禁 `tsc` 0 / `lint` 0 error 0 warning / `pnpm test` **83 文件 703 用例全绿**。**又一次 partial mock 教训**（与 R2 同源、本轮第二次）：`user-role-api` 与 `user-api` 的部分 mock 只列了单用户原语，而路由改经 module 走批量原语 ⇒ 未列出的导出变 `undefined`；修法一律 `importOriginal()` + spread + 显式补被调用的导出，并把原因写进注解理由（另记：注解下多写一行说明会被 `module-mock-guard` 判为孤儿注解——说明必须折进注解本身）。沉淀 `docs/solution/2026-10-13-authorization-effects-module.md`；glossary 补「收敛动作」术语；`ARCHITECTURE.md` 的撤销触发场景改记为"五类全部经该 module 收敛"。

- 2026-10-13（续二）: 架构评审 R2 候选 **R3 落地——撤销成败必须可判别**。`revokeUserAccessByUserId`（jti 撤销的唯一 seam）有两条性质组合出静默的安全缺口：①**永不抛出**（整个函数体包在 try/catch 里，所有失败路径都 return）；②返回值是 `number`，而 **`0` 同时表示「该用户没有活着的 AT」与「Redis 挂了、一个都没撤成」**。于是调用方只有两个坏选择：按"失败会 throw"写 catch（**8 处全部不可达**）或把故障读成正常。后果：Redis 全挂时「紧急撤销失败」**连一行日志都没有**，而 `users/actions.ts:161` 的注释还承诺了相反的保证（"Redis 不可达时撤销失败会留下有效旧 Token"）。能长期存活的原因与 ADR-014 记录的子树谓词同源：`force-logout-revocation.test.ts` 把错误语义**钉成了契约**（`resolves.toBe(0)`，注释写"返回 0 表示没有可计数的撤销（而非失败）"）——意图对、形状错，把 `0` 的多义性写成了规范。修复：把早已存在但**未导出**的 `UserRevokeOutcome`（`{revoked, failed}`）升为**公开 seam**，删掉那个丢弃 `failed` 的数字访问器；`revokeAllRefreshTokens` 的返回值改为 jti 层结果（RT 层走 DB、失败即抛，故"正常返回"即说明 RT 已完成——返回值只描述**会部分失败的那一层**）；调用点分两类且**都写下理由**——`force-logout` 响应新增 `jtiRevocationFailed` 并把 message 分两支（管理员可区分「无 AT 可撤」与「一个都没撤成」），登出/改密/重置/状态变更按 ADR-011 有意忽略并写明"失败由 module 在发生处记日志"，删除全部死 catch。失败日志补上 `userId` 且**只记一次**（记在拥有该知识的 module 里，而非复制到 8 个调用点）。**同类普查**全部撤销原语：`revokeUserRefreshTokens` 族 fail-close 会抛（不动）、`revokeJti` 同为「永不抛」→ 发现其唯一调用方的 catch **同属不可达**（`logout/route.ts:51-55`，已删）但不改其 void 返回值（全仓无消费者，加无人用的信号是投机）、`isJtiRevoked` 故障返回 true 属 ADR-011 既定决策（不动）、批量版已是判别式（不动）。验证：**变异验证**——把 catch 里的 `failed: true` 改回 `false`（恢复旧的谎言）→ **恰好 5 例变红、11 例保持绿**，绿的 11 例全是成功路径（真实计数 3/5、幂等再消费得 0 但 `failed:false`、RT 跨 client 撤销、批量全成功、空数组）⇒ 该测试组**能分辨「没撤成」与「没有可撤」**；哈希 `fb93aba00170a9b2…fb03bdd` 逐字还原，并确认变异落在含 `userId` 那处 catch（ADR-021 教训：变异本身也要被验证）。**编译器驱动的连带修正**：改签名后 `tsc` 立刻点名 **3 处类型化 mock 工厂**（token-claims-binding / user-api / user-role-api）——ADR-022「契约交给编译器」的正面证据；其中 user-role-api 的注解理由原文写"计数为 N"，形状变了理由也同步改（CODING_STANDARDS §2）。门禁：`tsc` 0 / API project **55 文件 503 用例全绿** / `pnpm test` 82 文件 695 用例全绿。沉淀 `docs/solution/2026-10-13-revocation-outcome-discriminable.md`；更新 `API.md`（force-logout 响应含 `jtiRevocationFailed`，明写"必须与计数一起消费"）与 `DETAILED_DESIGN.md`（过期签名声明）。

- 2026-10-13（续）: 架构评审 R2 候选 **R2 落地——写后失效的「写入位置」维度**。`lib/cache-invalidation.ts` 是写后失效的唯一真相源，但 interface 只有一种形状（`invalidateResource` → 内部固定 `updateTag`），而 Next.js 硬性规定 `updateTag` **只能**在 Server Action 里调用、在 Route Handler 必抛 `E872`（守卫在 `next/dist/.../revalidate.js:55-64`）。于是 **3 处 Route Handler 调用点**（`users/[id]/roles` POST 与 DELETE、`users/[id]/force-logout` POST）的形态是：`revalidatePath` 成功 → `updateTag` 抛错 → 被 `withPermission` 兜成 **5xx**，而写事务**早已提交不可回退**，客户端重试还会造成重复动作。测试看不见它：`vitest.setup.ts:17-23` 把整个 `next/cache` 换成 `vi.fn()`（`updateTag` 永不抛），唯一会碰到它的 `force-logout-route.test.ts` 又把该 module 整体 mock 掉——**测试面比调用面窄**。修复：按写入位置给**两个具名入口**（沿用本仓「维度用函数名编码」纪律，不加 `site` 参数）——Server Action 用 `invalidateResource`（`updateTag`，立即过期），Route Handler 用 `invalidateResourceFromRoute`（`revalidateTag(tag, { expire: 0 })`；**不是**官方默认的 `'max'`，因为 `'max'` 是 stale-while-revalidate 会继续服务陈旧内容，而这三处是权限/会话类写入；单参形式已废弃会打警告）。**同类普查**全部失效调用点：Server Action **21 处**（clients 5/users 6/departments 3/permissions 3/roles 3/profile 1）+ Route Handler **4 处**；**21 正是 ADR-019 记的「1 个原语 + 21 处调用」——那次收口的计数只覆盖 Server Action 一侧，route 那 3 处是漏掉的增补**（数字对得上、覆盖面没对上）。另修三条绕过路径：`permissions/register` 原本**完全没引入失效模块**（`permissions-list` 档位 `hours`，最长陈旧数小时）→ 补失效且**仅在有变更时**（该端点每次部署都跑，无变更失效会白白打掉缓存）；`profile` 资源 `tags` 由 `[]` 改为 `['users-list']`（改资料会显示在用户列表）；`login` 写 `lastLoginAt` **有意不改**（每次登录失效会抖动列表缓存，而档位是 `minutes`）并写明理由。新增**机械守卫** `cache-invalidation-site-guard.test.ts`（纯 fs 扫描全部 `route.ts`，带正向对照防空转）+ 原语契约测试。验证：红灯控制证据（只 stash 生产代码 → **9 红 / 7 绿**，红的是预期那些、绿的含扫描器夹具与正向对照；4 文件哈希逐字一致）；门禁 `tsc` 0 / `lint` 0 error（改动文件零新增告警）/ `pnpm test` **82 文件 695 用例全绿**。**如实记录一次自伤**：改完后 `force-logout-route.test.ts` 红 3 例——其部分 mock 未列出 `invalidateResourceFromRoute` 使该导出变 `undefined`（`CODING_STANDARDS.md` §2 记录过的坑），修法是改用 `importOriginal()` + spread 而非补键。沉淀 `docs/solution/2026-10-13-cache-invalidation-write-site.md`；补记 ADR-019 的「写入位置」维度；修正规范文档三处会**主动制造**该缺陷的表述（`ARCHITECTURE_CONSTRAINTS.md` R12 与反模式表、`ARCHITECTURE.md` 写路径原则与层次图、`portal-architecture-guidelines.md` 控制器选型）——它们原文都写「写操作必须同时调 `revalidatePath()` 和 `updateTag()`」，未区分位置。

- 2026-10-13: 架构评审第二轮（R2）候选 **R1 落地——用户详情读口的真实越权**。`getUser`/`getUserRoles` 的 SQL 里没有任何范围条件（JSDoc 却声称「已内置底层越权校验（IDOR 防护）」），页面详情路径改 URL 里的 id 即可跨部门读取任意用户详情**含其角色列表**，违反 H-ACL-002（🔴关键 P0）；REST 路径没暴露只因调用点自己补了 `resolveScope + isWithinScope`——同一读口两种正确性。修复：读口按「谁在问」分裂为**范围读口**（`getUser(id, scope)` / `getUserRoles(id, scope)` / `getDepartmentOptions(scope)`，范围经 `scopeFilter` 进 SQL，范围外与不存在同形 `null` → 404）与**身份读口**（`getOwnUser(userId)`，供 `/api/me`、`/profile`、dashboard layout 读自己——操作者的范围来自其**角色**的部门子树，本人的 `dept_id` 可能在其外，走范围读口会读不到自己；测试直接构造该情形并断言两个读口给出不同答案）。**同类普查** 11 个 `data.ts` 的全部导出：修 3 处（第三处 `getDepartmentOptions` 把范围外部门的名称与 ID 泄漏给 users/roles 两个页面的下拉），逐条记录 8 类不改的理由（审计读口按 `J-LOG-001` 定义为按操作人/类型/时间的跨部门查询，有意不收窄）。`getUserRoles` 借此把「不可见」（`null`）与「可见但无角色」（`[]`）分开。验证：新增 `user-detail-scope.test.ts` **13 例**（真实 PostgreSQL）+ **变异验证**（移除 `getUser` 的 `scopeFilter` → **恰好 5 例变红、6 例保持绿**，含正向对照「范围内返回详情」与兄弟读口 `getUserRoles` 三例，变异前后哈希一致确认逐字还原）；门禁 `tsc` 0 错误 / `lint` 0 error（改动文件**零新增**告警）/ API **53 文件 484 用例全绿**。沉淀 `docs/solution/2026-10-13-user-detail-scope-read-port.md`，并**修订 ADR-014 的不实记载**（其第 3 步曾把这两处「从未迁移」写成 ✅，直接替缺陷背书）+ glossary 补「范围读口 / 身份读口」两术语 + `API.md` 明写 404 同形语义。评审报告 `.arch-review/architecture-review-20261013-100205.html`（12 条候选 + 7 条次级），**R2–R12 及次级候选待办**。

- 2026-10-12（续）: **测试真实性治理 #39–#56 全部落地**（spec [#38](https://github.com/anjing0524/auth-sso/issues/38)，18 张票逐票提交、逐票在票上留验收证据）。①**真实基础设施基线**（#39）——API project 接入真实 Redis（`globalSetup` 硬探针 + 专用逻辑库 `/1` + 每用例 `FLUSHDB` + 4 条金丝雀），固定锚点行 `[globalSetup] Redis 就绪 <url>`；UI/contracts 不受影响，**CI 零新增步骤**。②**安全语义真实化**（#40–#50）——真实 ES256 密钥夹具 `seedSigningKeys`、授权码兑换/token 轮换/登出四层撤销/登录安全/身份信任/权限分级全部改由真实 DB + 真实 Redis + 真实签发驱动；残余 5 处「只断言调用」改真实状态断言；累计约 30 处**变异验证**（每处临时改坏生产代码、确认恰好对应变红、逐字还原）。③**契约交给编译器**（#51–#53）——59 处生产模块 mock（API 53 处/18 文件 + 非 API 6 处/4 文件）迁移为类型化工厂；编译器**暴露并修正 25 处幽灵键**（真身早已不存在的导出，被 mock 声明了多年）与 **26 处陈旧形状/签名漂移**；反向证据：改生产导出名 ⇒ `TS2561` 点名到键，而**裸写工厂 ⇒ 零诊断**（据此纠正 ADR-022 原文"退化为不点名 TS2769"的记载）。④**机械规则上线**（#54）——守卫进入 CI（API project，纯 fs 扫描）：形态（类型化工厂）+ 理由注解（封闭枚举 + target 逐字一致 + `auth-bypass` 点名测试文件）+ 只减不增的债务快照；7 个违例夹具在 CI 真跑。⑤**拆替身与清账**（#55–#56）——删除 5 组零采用者 adapter 与失效守卫（**净 −890 行**）；48 条债务逐条结清（补合法注解 / 去掉恒等哈希替身改走真实 sha256），随后**删除快照文件与守卫里的快照分支**——规则里**不留永久白名单**。最终门禁：`tsc` 0 错误、`pnpm test` **77 文件 / 655 例全绿**、lint 0 error（既有 warning 未增加）。实测教训沉淀：**变异本身也会撒谎**（`&&` 右侧仍求值 ⇒ 等于没变异，15 例全绿）、**TDZ 两次咬人**（`vi.mock` 工厂提升 vs `const` 助手）、**文档里的"实测结论"会漂移**（错误码与裸写后果均已按复测修正）。沉淀 **ADR-022**（含 §4(a) 两处更正）与 `docs/solution/2026-10-12-test-authenticity-remediation.md`（§9 夹具加载期依赖、§10 夹具自检须覆盖生产配置、§11 用正向变异证明 mock 与真身有类型联系）。

- 2026-10-12: 完成 wayfinder 地图「测试真实性：治理整体 mock 生产模块与假绿断言」的全部 9 张决策票据（产出可执行 spec 的输入；后续 18 张实现票 **#39–#56 已全部落地**，见下一条）。普查实测 183 处 `vi.mock`（78 处生产业务模块点位 = 42 确定假绿 + 36 疑似）与 M1–M5 变异实验：删 `issueRefreshToken` 的 DB 写入 → 4 文件 44 例全绿；删 logout 第 3 层撤销 → 6 例全绿；删 jti 黑名单校验 → `oauth-revoke` 11 例 + `token-claims-binding` 18 例全绿；无真实 Redis 时 434 绿 / 3 红且 2 条「撤销有效」天然为真。决议：①真实 Redis 进 API project（`globalSetup` 硬探针 + 专用逻辑库 + 每用例 `FLUSHDB` + 金丝雀；UI/domain 不受影响；编排三处零改动）；②四个 token 安全语义点位改真实驱动（真实 ES256 + 真实 DB + 真实 Redis，**零生产 seam**）；③8 个 mock token 的文件逐个判定（6 换真实 / 2 保留带注解）；④机械规则 = 类型化 mock 工厂（编译器管键集与判别式形状）+ 理由注解枚举 + 只减不增的债务快照，**CI 零新增步骤**；⑤不可变异的两类改走「编译器可变异 / 真实状态可变异」；⑥删除 5 组零采用 adapter（计划净约 676 行；**实绩见下一条：净 −890 行，且债务快照机制在清账后一并撤除**）。沉淀 **ADR-022** 与 `docs/solution/2026-10-12-test-authenticity-remediation.md`。普查一手来源：`docs/research/2026-10-12-fake-green-census.md`（基线 `ad530d6`）。另：修正 roadmap 三处与 HEAD 不符的记载（提交 `0d95c3f`），并修正地图 Notes 中「`keyCache` 重置挂 `vitest.setup.ts`」的旧前提（出口早已存在，应按需调用而非全局）。

- 2026-10-08（续）: 执行 `/code-review`（基点 `8905aa9`，22 commits / 113 文件）并逐项修复其发现。两轴并行评审：**Standards 轴** 3 项硬性违反 + 3 条坏味道；**Spec 轴** 判定 11 个候选中 7 个完成、⑦ 方向改变、⑨⑩ 部分完成、⑪ 基本未做——**推翻了我此前"11 个候选全部处理完毕"的说法**。修复：①**sender 绑定**（RFC 9700）——`/api/auth/refresh` 调 `rotateRefreshToken(refreshToken)` 不传 `expectedClientId`，跳过归属强制，任何 client 的 RT 落到 Portal Cookie 都会被轮换；改为传 `PORTAL_CLIENT_ID`，新增 2 例测试（跨 client 必须 401 且家族被撤销 + 同 client 正常轮换对照），变异验证通过。②**discovery 自定义字段加命名空间**（RFC 8414 §2）——`refresh_endpoint`/`oauth_callback_path` 无前缀会与注册字段名冲突并让外部 RP 误以为有标准 refresh_token grant；改为 `com_authsso_*`，Gateway 解析器**容忍新旧两种名字**（`custom_field` 按序探测）以支持部署错序，新增 5 例测试含"常量顺序即优先级"。③**ADR 数字与引用错位**——ADR-019 告警数 73→81（实测，与 roadmap 对齐）、ADR-020 `guard.ts:69`→`53`、ADR-021 与 roadmap 的性能声明矛盾（roadmap 写"仅有推理支撑"而 ADR-021 已实测，因更新 ADR 时忘记回改 roadmap）；`docs/spec/ARCHITECTURE_CONSTRAINTS.md` 三处「Controller ≤20 行」改为现行的「零业务逻辑 + complexity 15 / max-depth 4」；5 处把 `withScopedRow`/TOCTOU 误引为 ADR-019（应为 ADR-014）、`oauth-code.ts` 误引 ADR-021（应为 ADR-017）；修正后代码里 ADR-019 引用归零。历史审计文档保留原文，仅加「不应作为现行标准」指针。④**⑦ 的实测收口**——11 个超标 Controller **各自只调用一个**领域函数，再抽一层即 Middle Man；逐字比对 `withScopedRow` 配置块，重复**只在 `users/actions.ts`**（3 处逐字相同；roles/departments 各 3 块、重复 0 组）；新增 `loadUserScoped` 把这份**安全配置**收为一处（理由是正确性：配置散落则漏改一处即越权），`toggleUserStatus` 34→26、`unlockUser` 33→25、`deleteUser` 30→22、`updateUser` 38→32；剩余 7 个不再抽取。⑤**⑪ 的 mock 签名分叉**——`withPermission` 真实签名 2 参而 `mock-factory.ts` 与 `user-actions.test.ts` 写成 3 参，新增 `mock-contract.test.ts` 用 `Function.length` 作契约守卫（变异验证：退回 3 参即变红）。⑥**死代码清理**——`requireDeptAccess` 生产 0 处调用（ADR-014 刻意保留的过渡导出，其"后续步骤"迁移已完成），却由 12 个测试 mock + 1 个契约测试保护；删除定义、barrel 导出、陈旧注释（"16 处调用"实际 0 处）、11 个文件的 mock，契约断言反转为「不再导出」；保留 `getUserRoleDeptIds`（仍是 `resolveScope` 的依赖）与 `canAccessDept`（纯函数且有覆盖）。门禁全绿：tsc 0 错误 / lint 0 error（81 warning）/ vitest 64 文件 538 测试 / cargo test 122 / clippy `-D warnings` / fmt --check。**仍未做（如实记录）**：⑪ 的 `mock-redis.ts` 等两个测试 adapter 仍零使用、`@/lib/auth/token` 仍被 **8 个测试文件**整体 mock（这 8 个文件合计 **2308 行**，mock 声明本身合计仅 **39 行**；另有 2 个文件仅在注释中提及该字符串，不计入）、`signing-keys` 的 `keyCache` 无重置出口。**2026-10-12 普查实测更正**（判据：`vi.mock('@/lib/auth/token'` 的实际调用点计数与 `wc -l`）：原文记「7 个文件整体 mock（约 1980 行）」，既漏计 1 个文件，又把**文件总行数**误作 mock 代码量——1980 行从来不是 mock 的规模；原文所列「`token/route.ts` 仍内联复刻 `authenticateOAuthClient`」已由 `fe3e17b`(2026-10-09) 收口到 `lib/auth/oauth-helpers.ts:25`（定义处），token / revoke / introspect 三端点共用同一 seam（`token/route.ts:67` 调用）。

- 2026-10-08: 完成 `/improve-codebase-architecture` 架构评审的全部 11 个候选，沉淀 **ADR-014 ~ ADR-021**（8 个，全部 implemented）+ 2 份 solution 最佳实践。逐项：①**ADR-014** 数据范围授权门面——`lib/authz` 收口 `resolveScope`/`isWithinScope`/`assertWithinScope`/`withScopedWrite`/`scopeFilter`，修复读路径子树谓词缺陷（`ancestors` 缺三分支）与 3 条写路径的 TOCTOU；不上 PostgreSQL RLS（`SET LOCAL` 与 RSC/`"use cache"` 的每请求事务需求冲突，PG 官方文档给出 READ COMMITTED TOCTOU 反例）。②**ADR-015** 授权决策收敛到 `packages/contracts/src/authorization.ts`（`ADMIN_ROLE_CODES` 迁至 `admin-roles.ts` 断开 index→authorization→index 环），`apps/portal/src` 内 `ADMIN_ROLE_CODES` 归零。③**ADR-016** 身份边界收窄——`ResolvedIdentity` 只含 userId/expiresAt/issuedAt，删除 `EMPTY_CLAIMS` 哨兵；记录"判定字段可删须由编译器确认，不能靠 grep 计数"（destructuring/aliasing/spread 不匹配 `.prop`，两次误判均由 `tsc` 捕获）。④**ADR-017** 授权码兑换抽为深 module `lib/auth/oauth-grant.ts`，失败按安全语义可判别；`route.ts` 退化为协议适配器。⑤**ADR-018** 权限上下文故障分级——`getUserPermissionContext` 由 `| null`（四义坍缩）改为 `ok | denied(not_found|inactive) | unavailable`，`unavailable` 走独立 `:unavailable` 标记（TTL 5s）而非 `:null`（60s），修复"DB 抖动即登出用户"；`toPermissionContextOrNull` 把降级决策集中在 1 处。⑥**ADR-019** Controller 约束修正——发现该约束**文档化 4 处、声称由 lint 强制、实际门槛是文档值 4 倍且从未触发**；一手调研（TS 编译器 API 实测 22 个 action）证明**长度来自声明式配置与多行参数而非逻辑**（最大圈复杂度仅 8，超 20 逻辑行的 14 个中 12 个 ≤5），据 Google C++ Style Guide / Ousterhout / Fowler / Hatton 1997 的 U 形曲线改为**职责硬约束 + `complexity:15` + `max-depth:4`，移除行数上限**。⑦**ADR-020** 审计持久性三档——按"是否与业务同事务"分档（安全审计同事务必抛出 / 控制面补记永不抛出 / 运维观测重试 3 次），修复"审计补记失败把已提交的写操作报成失败、诱使调用方重试造成重复写入"。⑧**ADR-021** JWKS 宽限期判定收敛为唯一出处——`verify.rs` 与 `JwksCache::key()` 曾各写一份（前者是生产路径、后者只有基准在用，故**性能基线测的是不存在的路径**）；`JwksKeyEntry.key` 改存 `Arc<DecodingKey>` 使 `key()` 命中不产生堆分配，生产路径改经由它。⑨候选 ⑨ 死代码清理：删 `setJwtCookies`/`clearJwtCookies`（属性集与生产实际写入不一致）、`validateAuthCodeRow`（5 个单测全绿而真实判定在 token 端点的原子领取 SQL 里）、Rust `remove_from_header`/`replace_in_header`（已被 `rewrite_protected_cookies` 取代）、`GatewayCtx::is_authenticated`。⑩候选 ⑩ 零测试生产路径补齐：`api/auth/refresh`（含 Gateway 信任边界——**不 mock `verifySignature`**，用 `node:crypto` 独立计算真实 HMAC）、`oauth2/revoke`（跨 client 撤销阻断）、`oauth2/introspect`（已撤销/过期必须 `active:false`）、Gateway↔Portal **HMAC 跨语言契约**（RFC 4231 固定向量钉死两端 payload 与 hex 大小写）、Gateway 限流决策（`rate_limiter.rs` 此前无测试模块）。⑪候选 ⑪ 测试基础设施：修复 `seedJwks()` 产出的私钥**无法被 jose 导入**（`Invalid keyData`，长期被"所有签发测试都整体 mock `@/lib/auth/token`"掩盖——**夹具失效与 mock 互相掩盖**）；覆盖 `fireAndForgetWithRetry` 的重试机制（此前零覆盖）。两轮试点划定"领域操作抽取"的边界：`changeOwnPasswordAction` 32→20 逻辑行（主体是操作序列，可抽取），`resetPasswordAction` 38→35（主体是声明式 options 块，**几乎没有变薄**）——**第一个试点的成功不可推广**，已记入 ADR-019。③第三轮（code review 后）实测剩余重复：11 个超标 Controller **各自只调用一个**领域函数，再抽一层只产出 Middle Man；逐字比对 `withScopedRow` 配置块，**重复只在 `users/actions.ts`**（3 处逐字相同；roles/departments 各 3 块、重复 0 组）。据此新增 `loadUserScoped` 把这份**安全配置**收为一处（理由是正确性：配置散落则漏改一处即越权），`toggleUserStatus` 34→26、`unlockUser` 33→25、`deleteUser` 30→22、`updateUser` 38→32；剩余 7 个因长度为**声明式变体**（实测重复 0）而不再抽取。门禁全绿：tsc 0 错误 / lint 0 error（81 warning）/ vitest 63 文件 525 测试 / cargo test 117 / cargo clippy `-D warnings` / cargo fmt --check / cargo check --benches。性能已实测（见 ADR-021）：默认特性因 ACME 引入 `libz-ng-sys`（cmake 构建）而无法跑 release，**`--no-default-features` 可绕过**——`jwks/key_lookup_hit` ≈ 84–93 ns 对 `miss` ≈ 38–50 ns，差值 ≈ 44 ns 即 `Arc<DecodingKey>` 克隆代价，相对一次 ES256 验签（50–200 µs）小三个数量级；该数字来自开发机，非生产硬件基线。仍未验证：`next-action` 为 Next.js 内部头，跨版本稳定性未验证。

- 2026-09-30: 全仓**死代码/死文档清理轮**（零引用扫描：portal/contracts/config/demo-app 命名导出 + 孤儿文件 + 死脚本 + 未用依赖 + 活文档陈旧引用）。删除真死代码 7 项：5×`Update*Input` 死类型别名（对应 Schema 均被 actions 活消费，仅删别名）、`clearUsersPermissionCache` 死函数、contracts `PortalJwtClaimKey` 死类型；13 个仅同文件使用的执行型符号降级为私有（`computeAncestors`/`checkUserClientAccess`/`writeAuditLog`/`computeHmacHex`/`getCachedKey`/`importKeyFromJwk`/`REFRESH_TOKEN_TTL`/密码与防爆破配置常量等）；误报甄别保留——drizzle relations 经 `db.query.*` 动态消费、`ApiSuccess/ApiError` 为活契约 `ApiResponse` 联合成员、contracts 枚举常量族（有意的唯一真相源设计）；移除未用依赖 `next-themes`（lockfile -14 行）。死文档：DATABASE.md 升 v3.4（access_tokens 转墓碑节、refresh_tokens 补 client_id 列与 client/expires 索引、修正 token_hash"明文存储"错误描述、FK 约定与外键表同步 ADR-012/013 现实）；ACCEPTANCE_CRITERIA §6.1 表删 access_tokens 行并修正 refresh_tokens 索引数；DESIGN.md 升 v2.3 增架构章节历史快照声明（Better Auth/role_clients/DataScopeType/CTE 递归已被 ADR-001/002/006/007/010/012 取代，现行真相源指向 spec/ARCHITECTURE.md + docs/adr/）。门禁：typecheck / lint 0 error（79 warning 基线）/ vitest 47 文件 391 测试全绿；Rust 侧本轮零改动。

- 2026-09-30: /grill-with-docs 定案并当日全量实施 **ADR-013**（OAuth 协议数据回归 AT）：AT `aud` 从体系级 `auth-sso` 改为签发对象 `client_id` + 显式 `client_id` claim（RFC 9068 形态，封堵跨 client AT 重放到 Gateway 的替代路径）；`verifyAccessToken` 受众改必传显式（LoginSession=PORTAL_AUD / AT=PORTAL_CLIENT_ID / userinfo·introspect=null）；introspect 响应齐备化（aud/client_id/scope，RFC 7662）；revoke 顺势收口 RFC 7009 §2.1 归属判定（AT 按 client_id claim 拉黑、RT UPDATE 限定认证 client，消除跨 client 撤销 DoS）；Gateway aud 校验常开并自动推导自 `gateway.oauth.client_id`（删除 F12 冗余 env `GATEWAY_JWT_AUDIENCE`）、typ 收紧为强制存在、`Claims` 增 client_id（serde 显式 snake_case rename 防 camelCase 误配）；`PORTAL_CLIENT_ID` 收敛至 contracts oidc.ts；RFC 7009 §2.1 AT 级联偏差升级为"有意接受"（1h TTL 杠杆 + RT 家族撤销已闭合，重评触发：AT TTL 延长 / FAPI 2.0 / 合规强制）。发布顺序约束 Portal → Gateway 记录于 ADR-013 决策 5。文档：ADR-013 新建（implemented）、ADR-004/006/012 同步修订、实施计划含偏差记录。门禁全绿：typecheck / lint 0 error（79 warning 基线）/ vitest 47 文件 391 测试 / cargo clippy -D warnings / cargo fmt / cargo test 99 + doctests / Gateway E2E 发布旅程。另：glossary 修正 RT 家族作用域与 issuer URL 化两处滞后（对齐 81feae9 已提交代码）。

- 2026-09-29: 完成全库代码坏味道深度修复（审计 P0×5 / P1×7 / P2×15+，依据 `docs/solution/2026-09-29-code-smell-remediation.md` 清单）：①架构收敛残骸——删除死配置 `oauth_enabled`（ADR-010 二期遗留零消费方）、config.rs 陈旧 `[upstreams.oauth]` 测试 fixture、五处文档腐化（Pingora 0.8.1 横幅/失效 `is_secure_host`/`signRefreshToken`/旧 doctest）；②双真相源收敛——contracts 新增 `DEFAULT_SCOPES`（token.ts 与 DB 列默认同源）、check-permission 删除手写第二条权限缓存读取路径（根治合法空权限用户每请求穿透 DB 的 A3 缺陷）、授权码 `used:true` 双写删除、`revokeTokenFamily` 原语消除家族撤销 SQL 重复；③Token 轮换事务后失败补偿回收新 RT（孤儿行防护）；④Gateway 续签 `EndpointOutcome{Tokens,Skipped,Failed}` 三态（skipped 不再误回退重复请求）；⑤authenticate 决策逻辑抽纯函数 + 决策表 6 真值真测试（替换 assert_eq!(X,X) 伪测试）；⑥A2 Controller ≤20 行——`lib/pagination.ts` 新增 `paginationMeta`/`withPagination`/`countRows` 读模型原语，5 个 data.ts 全部收敛（20 个导出函数 0 超标），行映射器具名化；⑦clients 详情页 server 化（B5 读路径与 users/roles 对齐）；⑧nonce 校验双向 fail-close（单侧存在即拒）；⑨GatewayDeps 13 参数对象替代裸位置参数；⑩杂项：env 两层 schema 缓存统一、ESLint 测试区策略化（284→79 警告）、seed 工厂 `NonNullable` 化、状态枚举从 contracts 派生。门禁：clippy×2/format/cargo test/typecheck/lint/vitest 46 文件 384 测试/Docker 构建冒烟全绿。与并行进行中的 JWT typ/aud、JWKS 轮换宽限工作无冲突。

- 2026-09-29: 清账 2026-07-13 审计待办全部 24 项（P0~P5）：17 项经复核确认已被后续重构自然解决（A0-1 fire-and-forget 全部 await、A0-5 parsePagination+MAX_PAGE_SIZE、A1 系列、A2 系列、A5-1/2/5），3 项为语义过时伪待办（A4 系列虚假测试已于 2026-07-24 清除、A1-1 facade 已随 A3-3 删除），4 项当日实施——A3-2 Gateway OAuth 编排拆分至独立 `oauth_flow.rs`（gateway.rs 降至 743 行，clippy 0 告警）；A5-3 JWT Claims 跨语言契约（`packages/contracts/src/jwt-claims-fixture.json` 单一真相源，TS 签发语义测试 + Rust serde 反序列化测试双端钉死）；A5-4 trace-id 全链路传播（Gateway 缺失即 CSPRNG 生成 X-Request-Id 并透传白名单，Portal server-logger 以 request_id 入结构化日志）；A5-6 文档版本头现状确认。全量 43 文件 / 356 测试绿（contracts 新增 5 项契约测试）。

- 2026-09-28: 完成 Next.js 16.2.9 → 16.3.6 升级（portal + demo-app 同步；16.3.6 含关键 RCE 安全修复，所用 API 面在 16.3 无破坏性变更）。升级暴露 `next.config.ts` 跨文件导入解析失败并修复：next build 的配置评估按 ESM 语义解析且不探测扩展名，`../../next.base` 无扩展名导入无法命中 `.ts`（Node 26 三态实测），改为显式 `../../next.base.ts` + 删除 `tsconfig.json` 中无理由的 `allowImportingTsExtensions: false` 覆盖（继承 base 的 `true`）；配置链路同类问题审阅：vitest/eslint/drizzle 链路走 bundler 级解析不受影响，唯一实例已修。验证矩阵：typecheck/lint 0 错误、vitest 43 文件/356 测试全绿、生产等价 Docker 构建（node:26-alpine + Turbopack）通过、容器冒烟 discovery/login 双 200；本机 glibc 2.28 无法加载原生 SWC（Turbopack 拒绝 WASM），裸机 build 与版本无关地不可用，生产等价验证以 Docker 为准。最佳实践见 `docs/solution/2026-09-28-nextjs-16-3-upgrade-config-import-resolution.md`。

- 2026-09-28: React 19.2.7 → 19.3.0（portal + demo-app + @types 同步；typecheck 0 错误、vitest 43/356 全绿、Docker 构建冒烟通过）；本地构建因 glibc 限制统一走 Dockerfile——根级新增 `pnpm build:docker`；`apps/portal/Dockerfile` 构建期环境参数化（`NEXT_PUBLIC_APP_URL`/`NEXT_PUBLIC_APP_NAME`/`PORTAL_ISSUER` 三个带默认值 ARG，`--build-arg` 即可构建任意环境，缺省参数直接可构建）；uos 用户加入 docker 组（`sg docker` 验证免 sudo 可操作）。

- 2026-09-28: 完成 Pingora 0.8.1 → 0.9.0 升级（所用 API 面无破坏性变更，全门禁绿）；H-1 二期落地——OAuth Client 凭据从 `[[upstreams]].oauth` 收敛到 `[gateway.oauth]`（`GatewayConfig.oauth`），`RouteEntry`/`Router` 回归纯前缀路由表，`UpstreamConfig` 仅保留 `oauth_enabled` 布尔，启动校验改为网关级凭据非空（ADR-010 状态升级为 implemented）；issuer 双接受过渡窗当日关闭，`LEGACY_ISSUER` 自 `token.ts`/`jwks.rs` 双端删除（ADR-012）；本地安装 Docker CE 26.1.4 + Compose 2.27.1（buster 官方通道上限，aliyun 源 + registry mirror），正规 compose 栈（postgres:16-alpine/redis:7-alpine）上完成 db:migrate 与全量测试复验。

- 2026-09-28: 完成全链路设计审计修复（业界标准复核：RFC 9700 / Browser-Based Apps BCP / OIDC Discovery / RFC 7662）：①删除 `access_tokens` 幽灵表并修复管理端假撤销（H-2，migration 0001），introspect 无状态化；②`refresh_tokens` 绑定发放 client（RFC 9700 token family），重放级联撤销收窄为 (userId, clientId)；③Gateway 凭据一致性校验止血多 upstream callback 错位（H-1 一期，ADR-010）；④proxy.ts 落实 BCP 要求的同源校验（CSRF 纵深）并修复 `/oauth/error` 白名单缺口与 `/oauth2` 死配置；⑤JWKS 三件套：就绪门控（覆写 `start_with_ready_notifier` + `add_dependency`）、UnknownKid 单飞节流按需刷新、刷新合并 24h 宽限；⑥限流阈值配置化（默认 20/30，E2E 经 `RATE_LIMIT_*` 抬档）+ 配置缺失 fail-fast + `gateway.environment` 生产判定；⑦issuer 迁移为 env 驱动 URL（OIDC Discovery §4.3），过渡期双接受（ADR-012）；⑧departments cacheTag 断链修复。决策沉淀 ADR-010/011/012，ADR-004/006 修订（jti fail-close 与权限缓存 fail-open 的镜像反转对齐），最佳实践见 `docs/solution/2026-09-28-design-audit-remediation.md`。

- 2026-07-30: 完成 Gateway TLS 能力的编译期隔离：新增默认 `self-managed-tls` Cargo Feature，自托管 Docker/Compose 继续包含 ACME、HTTP 重定向和 TLS 热加载；Vercel 改用 `--no-default-features` 构建，仅保留平台 TLS 终结所需的 HTTP 代理能力，并从编译单元及正常依赖图排除 `acme`/`redirect`/`tls` 模块与 `instant-acme` 等专属直接依赖。配置层对“裁剪版 + 未启用外部 TLS”执行 fail-closed，CI 同时验证两套 clippy/test、平台 release build 和 ACME 依赖缺席，最佳实践同步沉淀到两份 TLS/部署 solution。
- 2026-07-30: 完成 Vercel 生产部署拓扑收敛：Vercel 只暴露一个 Docker Service，Next.js Portal standalone 在同一容器内仅监听 `127.0.0.1:4100`，Rust Gateway 作为唯一 `$PORT` 公网入口并使用平台 TLS 模式；Neon PostgreSQL 与 Upstash Redis 由 Marketplace 注入。生产验证否决了会因容器 IPv6 `[100::1]` 无路由而间歇 502 的跨 Service binding，改为确定性的 loopback 上游；同步补齐平台客户端 IP 信任边界、OAuth 正式回调白名单、Docker 构建期公开 URL 和 GitHub/Vercel 自动部署配置，最佳实践沉淀到 `docs/solution/2026-07-30-vercel-gateway-only-production-topology.md`。
- 2026-07-29: 补齐公共 Let's Encrypt staging 的可审计预检：`scripts/run-gateway-acme-staging.sh` 在访问 Docker/公共 CA 前检查公网 DNS 名称、联系邮箱和公网 80/443 操作员声明；缺失或无效时以状态码 2 退出并在独立 `preflight/` 目录写入阻塞证据，不覆盖既有公网通过证据。用户当前提供的 `local` 是无效公共域名，`8.8.8.8` 只是递归解析器且明确没有公网入口，因此当前证据为 `blocked_invalid_prerequisites`；进入真实演练后才在 `latest/` 使用 `failed_or_incomplete`，仅全部外部断言通过才写入 `passed`。
- 2026-07-28: 完成 Gateway ACME 可复现验收闭环：新增固定 Pebble v2.8.0 官方 Release SHA-256 的本地 CA/HTTP-01 测试栈和独立 CI 门禁，真实 Gateway 从无证书状态启动后在同一容器、零进程重启条件下签发并启用 HTTPS；TLS 链/域名验证、`0700/0600` 状态权限、同指纹重启恢复及 CA 停止后保留旧证书均已通过，证据保存在 `.context/compound-engineering/acme-e2e/latest/`。同步修复生产 80/443 映射与端口环境覆盖漂移、数值环境变量静默回退、测试 profile 残留清理及动态 Redis 地址抢占验证 IP；公网 Let's Encrypt staging 脚本已就绪，因当前环境缺少真实域名/DNS/公网端口，保留为首次生产部署前强制外部验收项。
- 2026-07-28: 完成 Gateway ACME/TLS 简化复审：删除不服务生产 ACME、也非本地/E2E 需求的文件证书轮询后台服务及其配置状态，文件证书恢复为启动期单次加载；续期结果改用 `Issue/Wait` 枚举消除无效组合，内联单用途账户路径与 directory 参数，并为直接使用的 `tokio::net::TcpStream` 显式声明 `net` feature，避免依赖传递 feature union 偶然编译。保持 ACME 原子持久化、HTTP-01、ARI 与证书热加载语义不变，规则同步沉淀到 `docs/solution/2026-07-28-gateway-letsencrypt-zero-downtime.md`。
- 2026-07-28: 完成生产 Gateway TLS 生命周期收敛并修订早期 Certbot 方案：移除 `docker-compose.prod.yml` 对 `apps/gateway/ssl`、Certbot 服务和 shell 入口的依赖，由 Gateway Rust 进程使用 `instant-acme` 内建 ACME 账户恢复、HTTP-01、ECDSA P-256 签发、ARI 续期调度、指数退避与自动热加载。ACME 账户和证书/私钥单 bundle 以 `0700/0600` 权限原子持久化到专用 volume；握手与 challenge 热路径均使用 `ArcSwapOption` 内存快照，失败继续使用上一有效证书且无需重启。同步补齐生产配置校验、非 root volume 权限、部署/架构/验收文档和 Rust 单元测试；本地/E2E loopback 自签证书继续作为隔离测试设施。最佳实践沉淀到 `docs/solution/2026-07-28-gateway-letsencrypt-zero-downtime.md`。
- 2026-07-28: 修复 Gateway Release Journey 对开发机证书的隐式依赖：`docker-compose.test.yml` 不再从被 Git 忽略的 `apps/gateway/ssl` 复制 PEM，改由 `apps/gateway/Dockerfile` 的专用 `cert-init` target 在构建期固化 OpenSSL、启动期向一次性 named volume 生成带 loopback SAN 的短期自签证书。CI 与本地现在都从干净输入构造 TLS 验收环境，运行期不安装软件、不读取宿主机私钥，发布浏览器闭环本地复验 `1/1` 通过；最佳实践补充到 `docs/solution/2026-07-27-gateway-first-delivery-entrypoints.md`。
- 2026-07-28: 从根因收敛 Next.js 16 构建期数据库边界：将 `@/infrastructure/db` 改为首次真实访问才解析 `DATABASE_URL` 并创建连接的统一惰性单例，删除审计、鉴权、权限模块中逐调用方堆叠的动态 import 补丁；将公开 URL、数据库、Redis、Cookie 等环境配置改为按关注点独立校验，避免静态 OIDC Discovery 因无关数据库配置失败；共享鉴权及相关 Controller catch 通过官方 `unstable_rethrow()` 保留 headers/cookies/PPR 控制流，不再把动态路由错误预渲染为静态 500；只在无 Request 参数且必须实时探测外部依赖的 health/JWKS GET 入口使用官方 `connection()` 请求边界；同时修复 `.dockerignore` 未排除真实 `.env*` 导致本地 Docker 构建被开发机配置污染的问题。Route Handler 与页面继续遵循 Cache Components 默认动态/部分预渲染语义，不再用 `dynamic` 或 blanket `connection()` 掩盖共享边界问题，最佳实践沉淀到 `docs/solution/2026-07-28-nextjs-rsc-build-time-db-boundary.md`。
- 2026-07-27: 收敛 Docker Compose 入口：删除无消费者、与当前脚本/工作流职责重复的 `docker-compose.local.yml`，并将原 `docker-compose.ci.yml` 与 `docker-compose.e2e.yml` 合并为统一的 `docker-compose.test.yml`。收敛后的职责为三类：`docker-compose.yml` 仅服务本地开发数据库/Redis，`docker-compose.test.yml` 统一承担 CI 的 `node-test` 容器与 Gateway 发布闭环私有栈，`docker-compose.prod.yml` 保留部署用途；相关 `workflow`、`scripts/run-gateway-e2e.sh`、接入文档与最佳实践同步切换，避免再维护“同一件事三份 compose 入口”的漂移。
- 2026-07-27: 收敛 GitHub workflow 职责：新增可复用 `.github/workflows/validation-suite.yml`，让 `pr.yml`、`main.yml` 与 `release-validation.yml` 共享同一套 lint/typecheck/migrate/seed/test、Gateway Rust 质量门禁与 Gateway 发布旅程；release 不再是只跑浏览器闭环的特例，CI 与 release 的职责边界统一为“验证代码并构建/验收发布拓扑”，仅保留 artifact 命名与主干故障注入烟测的参数差异。
- 2026-07-27: 收敛 Gateway-first 交付入口：根 `pnpm dev` 改为自动拉起 `postgres`/`redis` + `portal` + `demo` + `gateway` 的本地联调入口，补充 `dev:gateway` 与 `build:gateway`，并将根 `build` 纳入 Gateway release 构建；默认 `pnpm test:e2e` 改为自动启动 `docker-compose.e2e.yml` 不可变验收栈，仅验证经 Gateway 的浏览器闭环，直连 Portal 的 Playwright 冒烟显式降为 `test:e2e:portal`；同时在 PR/Main CI 提前执行与 release workflow 同构的 Gateway 发布旅程，避免“打 tag 后才发现 Portal 不能只放在 Gateway 后面”的拓扑回归。实测闭环过程中进一步修复了 Gateway Docker 日志目录权限、e2e/ci compose 项目名污染、HTTP/2 小写 `accept` 头导致的浏览器导航误判，以及 loopback TLS 入口被错误生成为 `http://127.0.0.1:19443/...` OAuth 跳转的问题；最终 `scripts/run-gateway-e2e.sh` 本地全绿，沉淀到 `docs/solution/2026-07-27-gateway-first-delivery-entrypoints.md`。
- 2026-07-27: 收敛数据库初始化、测试与发布入口：发布验收栈 `docker-compose.e2e.yml` 改为 `db:migrate + db:seed`，并由 Playwright Docker 镜像执行 `test:e2e:release`；PR/Main CI 新增 `docker-compose.ci.yml`，由 GitHub runner 调度 `node-test`/`postgres`/`redis` 同网段执行 lint、typecheck、`db:migrate + db:seed` 与 Vitest，不再让宿主机进程直连数据库；同时明确 GitHub 只承担 CI 验证，不再保留面向外部数据库的定时分区维护 workflow，`db:maintain-partitions` 回归部署/运维平台调度；Portal Vitest 拆为 API/UI 双 project，仅 API 测试连接 Docker 中的 PostgreSQL/Redis，并显式补齐 `@ -> src` alias，修复容器内 API 测试 helper 的模块解析失败；`apps/portal` 的 `db:migrate` 改为仓库内 `scripts/migrate.ts` 直接执行基线 SQL，替代无错误上下文的 `drizzle-kit migrate` 黑盒入口；`README.md`、`AGENTS.md`、`docs/INTEGRATION_GUIDE.md` 同步移除默认 `db:push` 指引；同时删除无消费者的 `db:cleanup` 孤儿脚本、无语义增量的根 `infra:up` 空别名，以及误入库的 `apps/portal/tsc_output.txt`；契约层同步移除无运行时消费者的 `LOGIN_LOG_PERMISSIONS` 僵尸权限组，登录日志权限统一回收至 `portal:audit:*`，沉淀到 `docs/solution/2026-07-27-ci-entrypoint-convergence.md`。
- 2026-07-27: 修复本地测试数据库自举缺口：Portal `vitest.globalSetup.ts` 在连接前自动补建缺失的 `auth_sso_test`，开发环境 `docker/init-db.sql` 首次启动同步创建测试库；避免 Vitest 因本地仅有 `auth_sso` 而卡死或误用业务库跑测试。沉淀到 `docs/solution/2026-07-27-local-test-db-bootstrap.md`。
- 2026-07-27: 完成 Portal 健康检查依赖探测收尾：`/api/health` 现主动探测 PostgreSQL `SELECT 1` 与 Redis `PING`，按 `healthy/degraded/unhealthy` 返回聚合状态；补齐数据库失败与双依赖失败测试，并沉淀依赖探针最佳实践到 `docs/solution/2026-07-27-health-check-active-dependency-probes.md`。
- 2026-07-24: 整理文件归属：用户创建权限守卫下沉至 users 模块、403 视图进入 shared；需求追溯报告改为忽略的本地生成物，消除每次生成带来的工作树噪声。
- 2026-07-24: 清除四份失效 E2E（过时 REST 写路径、错误 OAuth 回调/PKCE、无 baseline 的视觉快照、以无效授权码伪装安全验证）及其动态 `skip` 伪通过；追溯脚本改为信息清单，不再作为 CI 通过率门禁，真实缺口以 55/76 明示并纳入后续测试补齐。
- 2026-07-24: 首轮无效入口清理：删除与当前 schema 漂移、无调用方的调试/种子/生产改写脚本及其 `db:clean` 命令；移除被 Docker 发布验收替代的本地 QA 编排与未配置告警脚本。当时暂保留分区维护脚本与性能基准，后续在 2026-07-27 明确前者回归部署/运维平台调度。
- 2026-07-24: 建立可执行测试防线：PR/Main 的 lint、typecheck、单元/API/组件测试改为阻断门禁；新增 Docker 发布验收栈与标签/手动发布工作流，经 Gateway HTTPS 验证登录、OAuth 回调、Secure Cookie 和登出闭环。
- 2026-07-24: 新增生产就绪测试与验证框架（`docs/plans/2026-07-24-production-readiness-validation-framework.md`）：统一产品需求、NFR、架构约束、实现、测试与执行证据；将弱 E2E、NFR 追溯、Gateway 全链路、故障与性能演练列为发布前验证重点。
- 2026-07-24: 合并 PR #24 中经 main 基线复核的测试与 CI 改进：补充 Redis 降级授权覆盖、Gateway ES256 安全验签覆盖、测试基础设施与需求追溯扫描；剔除未能形成有效断言的 E2E 草案。
- 2026-07-24: 完成全维度审计整治：OAuth scope allow-list/授权码原子领取/UserInfo 最小披露，Gateway issuer 与生产共享密钥约束，唯一数据库基线与分区调度，Controller 权限常量收敛、受控 Prometheus metrics、Temporal 领域时间边界、OAuth 浏览器授权码 E2E，以及 337 项 Vitest 全绿的共享数据库隔离修复。
- 2026-07-23: ADR-009 Gateway 重构全量完成（G1-G7），全量文档同步审计（14 份文档）；修复角色绑定事务边界、REST 错误契约、权限 SQL 分页与 OIDC 死类型
- 2026-07-16: Gateway 安全修复与性能优化完成（B1-B9/D1-D5/C1-C3/A1-A6，见下方区块）
- 2026-07-16: ADR-006/007/008 全量实现完成，合并 main（75 文件，307 测试全绿）
- 2026-07-15: ADR-006/007/008 产出，领域重构计划制定（来源：/grilling 深度访谈）
- 2026-07-13: 新增"审计驱动待办（基于 2026-07-13-code-audit.md，经代码实证勘误）"区块
- 2026-07-10: 初始化路线图，对齐 v1.1 交付状态

## 审计驱动待办（基于 2026-07-13-code-audit.md）

> 下表条目均经过对 HEAD 代码的实证复核；审计报告本身的 3 处事实错误（13.1 CI、2.1 audit success、6.1 遗漏项）已在报告中勘误，此处不再重复。

### P0 紧急修复（安全 / 可独立上线）

| # | 状态 | 任务 | 文件:行 | 来源发现 |
|---|:--:|------|---------|:--:|
| A0-1 | ✅ | fire-and-forget → await（复核遗漏的 4 处安全关键调用） | `app/(dashboard)/users/actions.ts:120,232,282` + `app/profile/actions.ts:124` | 6.1 勘误 |
| A0-2 | ✅ | `revokeAllRefreshTokens` JTI 撤销 fire-and-forget（工作树已修复） | `lib/auth/token.ts:568-577` | 7.4（升级为严重） |
| A0-3 | ✅ | CI 增补 `pnpm audit` / `cargo audit` 依赖安全扫描 | `.github/workflows/*` | 13.2 |
| A0-4 | ✅ | permissions 列表接口补 SQL 分页（page/pageSize/pagination） | `api/permissions/route.ts` + `permissions/data.ts` | 5.2 |
| A0-5 | ✅ | 分页参数统一校验 + 提取 `MAX_PAGE_SIZE` 常量 | `contracts` + 4 个路由 | 5.1 |

### P1 规范统一

| # | 状态 | 任务 | 文件:行 | 来源发现 |
|---|:--:|------|---------|:--:|
| A1-1 | ✅ | facade.ts 错误响应补 `success: false`（统一 ApiResponse 契约） | `lib/auth/facade.ts:56-59,64-67,78-81` | 2.1 |
| A1-2 | ✅ | register 路由成功响应用 `data` 替代 `stats` | `api/permissions/register/route.ts:178` | 2.1 |
| A1-3 | ✅ | `LOG_LEVEL` 生效 + 全量日志结构化 | `packages/config/src/env.ts:39` + Portal 全局 | 10.1, 10.2 |
| A1-4 | ✅ | 管理员角色硬编码改为引用 `ADMIN_ROLE_CODES` | `app/profile/ProfileClient.tsx:270` | 11.1 |

### P2 公共抽取

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A2-1 | ✅ | 审计日志写入抽取公共工厂（消除 3 次重复） | `lib/audit.ts` | 7.2 |
| A2-2 | ✅ | 分页参数解析工具 `parsePagination()` | 新建 `lib/pagination.ts` | 14.5 |
| A2-3 | ✅ | 日期范围过滤条件构建工具 | `app/audit/data.ts` | 14.2 |
| A2-4 | ✅ | 密钥导入模式去重（`importJwk`） | `lib/auth/token.ts` | 3.4 |

### P3 架构优化

| # | 状态 | 任务 | 文件（实测行数） | 来源发现 |
|---|:--:|------|------|:--:|
| A3-1 | ✅ | 拆分 token.ts（584 行 → 实测 `token.ts` **407** 行 + `token/signing-keys.ts` **215** 行 + `token/revocation.ts` **144** 行，**2 个子模块**，无 `token/index.ts`） | `lib/auth/token.ts` | 3.1 |
| A3-2 | ✅ | 分离 gateway.rs 的 OAuth client 逻辑（853 行） | `gateway/src/gateway.rs` | 3.2 |
| A3-3 | ✅ | 删除无逻辑的 facade re-export，公开入口直接导出实际模块 | `lib/auth/index.ts` | 3.5 |
| A3-4 | ✅ | 健康检查加 DB/Redis 连通性探测与失败边界测试 | `api/health/route.ts` + `__tests__/api/health.test.ts` | 10.3 |

### P4 质量防护

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A4-1 | ✅ | 重写虚假覆盖率测试（audit-logging、user-actions 等） | `__tests__/api/*` | 12.1-12.3 |
| A4-2 | ✅ | 补充 CRUD write 路径的受控 API/浏览器集成测试 | `apps/portal/__tests__/api/`、`tests/e2e/` | 12.6 |
| A4-3 | ✅ | auth-login 测试降低 mock 粒度，真实测密码验证 | `__tests__/api/auth-login.test.ts` | 12.4 |
| A4-4 | ✅ | session-lifecycle 测试恢复 jose 真实验签 | `__tests__/api/session-lifecycle.test.ts` | 12.5 |

### P5 细节清洁

| # | 状态 | 任务 | 文件 | 来源发现 |
|---|:--:|------|------|:--:|
| A5-1 | ✅ | Dockerfile 层缓存优化（先 COPY lockfile 后 install） | `apps/portal/Dockerfile` | 13.3 |
| A5-2 | ✅ | 恢复 tsconfig 3 个 strict 子选项 | `apps/portal/tsconfig.json:14-16` | 13.4 |
| A5-3 | ✅ | PortalJwtClaims 跨语言契约（JSON Schema 权威定义） | `domain/auth/types.ts` + `gateway/auth/mod.rs` | 7.5 |
| A5-4 | ✅ | trace-id 跨服务传播 | `lib/auth/server-logger.ts` | 10.4 |
| A5-5 | ✅ | Cookie Secure 增加独立配置（非仅依赖 NODE_ENV） | `lib/session/cookies.ts` | 9.3 |
| A5-6 | ✅ | 文档版本号统一 | `docs/spec/API.md` 等 | 2.4 |

---

## ADR-006/007/008 领域重构（2026-07-15 /grilling 产出）

> 详细计划：`docs/plans/2026-07-15-adr-006-007-008-implementation.md`

### Phase 1: Schema & Migrations

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D1-1 | ✅ | permissions: 删除 `resource`/`action` 列，扩展 `code`→varchar(150)，更新 CHECK | `db/schema/rbac.ts` |
| D1-2 | ✅ | refresh_tokens: 删除 `client_id` 列及索引 | `db/schema/auth.ts` |
| D1-3 | ✅ | 生成并执行迁移 SQL | Drizzle migration |

### Phase 2: Contracts

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D2-1 | ✅ | 所有权限常量加 `portal:` 前缀 | `packages/contracts/src/permissions.ts` |
| D2-2 | ✅ | `PortalJwtClaims` 最小化（移除 roles/permissions/deptIds） | `domain/auth/types.ts` |
| D2-3 | ✅ | OIDC 常量 `iss`/`aud` 改为 `"auth-sso"` | `packages/contracts/src/oidc.ts` |

### Phase 3: JWT Token 签发/验证

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D3-1 | ✅ | `signAccessToken` 最小化 claims | `lib/auth/token.ts` |
| D3-2 | ✅ | `verifyAccessToken` aud/iss 改为 `"auth-sso"` | `lib/auth/token.ts` |
| D3-3 | ✅ | `resolveTokenClaims` 不再返回鉴权数据供 JWT 嵌入 | `lib/auth/permissions.ts` |

### Phase 4: 权限上下文 Redis 化

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D4-1 | ✅ | RBAC 变更时主动更新 Redis `user:{sub}:perms` | `lib/permissions.ts` |
| D4-2 | ✅ | Token 续签时预填充 Redis 权限缓存 | `lib/permissions.ts` |

### Phase 5: Portal 自身鉴权改造

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D5-1 | ✅ | `checkPermission` 改为读 Redis | `lib/auth/check-permission.ts` |
| D5-2 | ✅ | `withPermission` 移除 claims 注入 | `lib/auth/guard.ts` |
| D5-3 | ✅ | `withAuth` AuthContext 简化为 `{ userId }` | `lib/auth/guard.ts` |
| D5-4 | ✅ | 所有 Controller/Page 去除 `claims.deptIds` 直接引用，改为 Redis 获取 | `app/(dashboard)/**`, `app/api/**` |

### Phase 6: Refresh Token 去 ClientId

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D6-1 | ✅ | `issueRefreshToken` 移除 clientId 参数 | `lib/auth/token.ts` |
| D6-2 | ✅ | `rotateRefreshToken` 移除 clientId 参数 | `lib/auth/token.ts` |
| D6-3 | ✅ | 调用方更新（/token /refresh 端点） | `app/api/auth/oauth2/token/route.ts`, `app/api/auth/refresh/route.ts` |

### Phase 7: Gateway 改造 (Rust)

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D7-1 | ✅ | Claims 结构体移除 roles/permissions/dept_ids | `gateway/src/auth/mod.rs` |
| D7-2 | ✅ | 验签 issuer 固定为 `"auth-sso"`；aud 按 ADR-006 不在 Gateway 校验 | `gateway/src/auth/verify.rs` |
| D7-3 | ✅ | 移除 X-User-Roles/Permissions/DeptIds 注入 | `gateway/src/gateway.rs` |

### Phase 8: Seed 数据

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D8-1 | ✅ | 权限 code 加 `portal:` 前缀；删除 resource/action 赋值 | `scripts/seed-rbac.ts` |
| D8-2 | ✅ | Portal 菜单 code 加 `portal:` 前缀 | `scripts/seed-rbac.ts` |

### Phase 9: 测试更新

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| D9-1 | ✅ | 鉴权测试适配（mock Redis 替代 JWT claims） | `__tests__/lib/auth/*` |
| D9-2 | ✅ | API 测试适配（aud/iss claims 移除） | `__tests__/api/*` |
| D9-3 | ✅ | Gateway 测试适配（Claims 结构体） | `apps/gateway/src/auth/tests.rs` |

---

## ADR-009 Gateway 重构（2026-07-16 /grilling 产出）

> ADR-009 已于 2026-07-23 全量实现完成，经 `cargo clippy` + `cargo fmt` + `cargo test` 全绿验证。详见 `apps/gateway/src/auth/mod.rs`、`gateway/src/authenticate.rs`、`gateway/src/config.rs`。

| # | 状态 | 任务 | 文件 |
|---|:--:|------|------|
| G1-1 | ✅ | 新增 `AuthDecision` 枚举（Pass/Interrupted/PkceRequired） | `gateway/src/auth/mod.rs` |
| G1-2 | ✅ | `authenticate::check` 重写：`Result<bool>`→`Result<AuthDecision>`，`match expiry` 替代 `matches!`，删除 `respond_auth_failure` | `gateway/src/authenticate.rs` |
| G2-1 | ✅ | 删除 `request_filter` step 7（`hasJwt` Cookie 预判） | `gateway/src/gateway.rs` |
| G2-2 | ✅ | 删除 callback 中 `oidc_provider_name` 跳过分支 | `gateway/src/gateway.rs` |
| G2-3 | ✅ | 删除 callback 透传分支（`client_secret.is_some()` 检查 + passthrough） | `gateway/src/gateway.rs` |
| G2-4 | ✅ | step 8 替换为 `match AuthDecision` 统一分支 | `gateway/src/gateway.rs` |
| G3-1 | ✅ | `OAuthConfig.client_secret` → `String`（必填），`UpstreamConfig.oauth` → 必填 | `gateway/src/config.rs` |
| G3-2 | ✅ | 删除 `Gateway.oidc_provider_name`、`GatewayCtx.oauth_passthrough_verifier` | `gateway/src/gateway.rs` |
| G3-3 | ✅ | `resolve_oauth` 返回 `&OAuthConfig`（不再 `Option`） | `gateway/src/gateway.rs` |
| G4-1 | ✅ | 删除 `upstream_request_filter` 中 `X-OAuth-Code-Verifier` 注入 | `gateway/src/gateway.rs` |
| G4-2 | ✅ | `handle_oauth_callback` 删除 `client_secret.is_some()` 分支 + passthrough | `gateway/src/gateway.rs` |
| G5-1 | ✅ | 增补 `AuthDecision` 单元测试 | `gateway/src/auth/tests.rs` |
| G6-1 | ✅ | `gateway.toml` + `gateway.docker.toml` 增加必填 `client_secret` | 配置文件 |
| G7-1 | ✅ | `cargo clippy` + `cargo fmt` + `cargo test` 全绿验证 | CI |

---

## Gateway 安全修复与性能优化（2026-07-16 审计驱动）

> 计划：`.kilo/plans/1784180149059-gateway-security-fixes.md`；最佳实践沉淀见 `docs/solution/`。

| # | 状态 | 任务 | 审计项 |
|---|:--:|------|:--:|
| S1 | ✅ | 扩展名白名单边界收窄（/api/ 命名空间禁止扩展名旁路，优先级降至 Microservice 后） | B1/D5 |
| S2 | ✅ | 客户端 IP 改用 socket 真实地址；XFF/X-Real-IP/X-Client-IP 权威覆写 | B2/B7 |
| S3 | ✅ | scheme 判定统一为 `is_secure_host`（IP 解析 + is_loopback），删除重复实现 | B3 |
| S4 | ✅ | 续签去重改 Redis SET NX EX 前置抢占 + 失败释放（消除 TOCTOU） | B4 |
| S5 | ✅ | Token 交换跨节点故障转移（网络错误换节点，非 2xx 确定性拒绝） | B5 |
| S6 | ✅ | PKCE return_to 保留 query | B6 |
| S7 | ✅ | `query_param` 重写（大小写敏感、零分配）+ IdP error 回调显式处理 | C3/B8/B9 |
| S8 | ✅ | 单一路由表 RouteEntry（prefix+LB+OAuth 同源）+ 上游 TLS 生效 | D2/A2/A3 |
| S9 | ✅ | JWKS 缓存 ArcSwap 快照化（删除锁中毒分支）+ upstream_scheme 显式注入 | D1/A1 |
| S10 | ✅ | Cookie 热路径：ctx 缓存一次 collapse + 单遍重写 + strip 零分配 | D3/C1/C2 |
| S11 | ✅ | public_paths 归属校验（越界白名单启动期拒绝） | A4 |
| S12 | ✅ | 删除 get_host `:authority` 死分支；callback 判定零分配 | A6/D4 |

不做（Out of scope）：trusted-proxy 层级配置、Redis 缓存新 AT、C4 Bearer 拼接微优化、分布式限流。

### 状态图例

- 🔲 待处理 ｜ ⏳ 进行中 ｜ ✅ 已完成 ｜ ⚠️ 有阻塞

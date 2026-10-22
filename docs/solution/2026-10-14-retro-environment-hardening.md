# /retro 落地：把"设备会坏在哪"变成检查与标准（#90）

> 日期：2026-10-14
> 来源：`/retro`（对第 30–36 轮那次 31 票弧的复盘）
> 关联：#58（上一次 retro 的落地方式）、ADR-022、`CODING_STANDARDS.md`、`.githooks/pre-commit`
> 词汇：module / interface / seam / leverage / locality

## 一、retro 的做法与证据来源

按 `retro` 的步骤：读**会话原始记录**（本会话日志 `session-19982e63…`，28.5MB zstd）、
先读仓库**既有检查**（`package.json` 脚本 / pre-commit / CI workflow），再看七个类别：
导航、**自动化检查**、编码标准、AGENTS.md、工具经济、no-op、信息获取。

> 计数口径的诚实说明：会话日志是**上下文快照**型，字符串计数会被历史重复放大
> （例如 `msg.txt` 出现 212 次，实际事故只有 2 次）⇒ 频率一律引用我**当时写下**的复发记录
> （如"本会话第 5 次…"），不引用原始 substring 计数。

## 二、落地了什么

| 项 | 内容 | 验证 |
|---|---|---|
| **A1 门禁清单自检** | 新增 `gate-inventory-guard.test.ts`：①每个 `apps/*`、`packages/*` 包必须有 `lint`+`typecheck`；②根命令必须是递归（`pnpm -r …`）；③脚本**不得吞掉失败**（`\|\| echo` / `\|\| true` / `2>/dev/null` / `--no-eslintrc`） | **两次变异**：把 config 的 lint 改成吞错形状 ⇒ 精确变红；删掉它的 `typecheck` ⇒ 报 `缺少：typecheck`。含判定夹具。**可复跑命令**：`npx vitest run --project @auth-sso/portal-api apps/portal/__tests__/api/gate-inventory-guard.test.ts` |
| **A3 pre-commit 加 Rust** | 钩子新增 4/4 步：仅当本次暂存了 `.rs` 时跑 `cargo fmt -- --check` + `cargo clippy -D warnings`（实测增量 1.5–5s）；未装 cargo 时明确跳过而非假装 | **变异**：注入格式违规 ⇒ 钩子打印 fmt diff 并以 1 退出 |
| **A4 两个脚本** | `scripts/push-main.sh`（保留**真实退出码**，此前命令行 `for` 循环的 `$?` 被后续命令覆盖）；`scripts/ci-verify.sh`（**pin headSha** + 断言所有 job success + 0 非成功步骤，并区分"被取代而 cancelled"） | 本轮**当场使用**它们完成推送与 CI 校验 |
| **B 三条判断题** | `CODING_STANDARDS.md` 新增 §8 替身不得手写被替换者的行为 / §9 红必须红在正确原因上 / §10 未来时承诺必须带触发条件 | 该文件的定位是"只收判断题、机械的一律造检查" |
| **C1 决策索引** | 新增 `docs/solution/README.md`（64 篇按 **9 主题**索引 + 何时读），`AGENTS.md` 加一行导航指针；并把**完整性做成检查**（`docs-references.test.ts` 新增断言：每篇文档都必须能从索引到达） | **变异**：新增一篇未挂索引的 `zz-probe.md` ⇒ 精确变红并点名 |

门禁：`pnpm test` **99 文件 / 826 用例**（+1 文件 11 用例）· `pnpm -r typecheck` 4/4 · `pnpm -r lint` 4/4。

## 三、⚠️ A2 没有按原设计落地——因为**规则本身过粗**

原设计：**`Partial<typeof X>` 的工厂必须 `importOriginal`**（本会话踩了 5 次：
部分替换导致未列出的导出是 `undefined`，运行时炸、`tsc` 不报）。

把守卫写出来后，它在仓库里标出 **29 处**存量。逐处核实时发现了两个事实：

1. **扫描器首版有假阳性**：用"扫到 `}));` 行"的启发式会把相邻 mock 串进同一窗口
   ⇒ 上一个 mock 的 `Partial<typeof` 栽到下一个头上。改成**括号配平**后，28 → 23
   （再加上排除守卫自身夹具字符串里的示例）。
2. **规则会误伤真存量**：`app-sidebar.test.tsx` / `command-palette.test.tsx` 的
   `@/components/ui/*` mock 是**UI 原语 stub**（注解 kind 就是 `infra-boundary`，
   理由是"真实组件是 forwardRef，本文件测的是导航逻辑"）——对它们做
   `importOriginal` + spread 会**把真实组件装回去**，恰好**违背 mock 的本意**。

⇒ **"`Partial` 且无 `importOriginal`" 并不总是缺陷**：有时作者只是借 `Partial`
当"只列我要的那几个"的**类型简写**，而**本意就是整体替换**。

**修订后的设计**（尚未落地，见 §四）：把契约说全——
**要么 `importOriginal` + spread（部分替换），要么显式声明"整体替换"**。
实现上给 ADR-022 的 kind 枚举加一个 `full-replacement`：29 处各自二选一，
守卫则要求"`Partial<typeof` 且非 `full-replacement` 注解 ⇒ 必须 `importOriginal`"。
这样 UI 原语 stub 只需把自己的意图**写明**，而部分替换的陷阱被机械堵住。

> **教训**：一个"显然是机械类"的规则，落到 29 处存量上才暴露它**混了两种意图**。
> **先测量存量，再决定规则**——否则会得到一条"绿不了也讲不清"的门禁。

## 四、未落地项 —— **2026-10-15 全部结案**（保留原文可见演进）

> 本节原列 A2 修订版 / A5 / D / G 四项"未落地"。它们此后**都已落地**：
> **A2 修订版**（`full-replacement` 声明 + 26 处二选一清扫 + 守卫）见 commit `83112e2`（closes #91）；
> **A5**（`seedTestData` 形状守卫真正落地 + 助手审计断言）、**D**（`CLAUDE.md` 命令表改指针）、
> **G**（`AGENTS.md` 写明装包限制）同批。本节文字保留，是因为"曾经未落地"本身是这条复盘的证据。

- **A2 修订版**（`full-replacement` 声明 + 29 处二选一清扫）：这是**项目**而不是 retro 的边角，
  需单独一票，附 29 处清单与两种修法。
- **A5 同类"静默跳过"助手审计**：`seedTestData` 已加固（非数组即抛），其余 seed/请求助手待逐一看形状。
- **D**：`CLAUDE.md` 的 "Development Commands" 是 `package.json` 的缓存（会 stale）⇒ 可缩成指针（低优先）。
- **G**：本机 pnpm store 只读 ⇒ 装不了新依赖（#89 因此只能给结论不能落地）⇒ 建议给 agent 一个可写 store 路径，或在 `AGENTS.md` 写明"装新包需用户代跑"。

## 五、最佳实践（可复用）

1. **retro 的价值在"既有检查是否真的在跑"，而不是"再造一个检查"。** 本会话的主导失败类
   全是这一种：#77（contracts 测试不在 typecheck）、#83（两个包没有 lint 脚本）、
   #83 副产物（`2>/dev/null || echo 'ok'` 恒绿并掩盖坏配置）。**A1 把这一类变成常设检查。**
2. **机械类规则先量存量。** A2 的教训：规则形状对，但**混了两种意图**；
   先跑一遍存量，才知道该不该加"声明"这一半。
3. **每次新门禁都要证明它会红。** 本轮三条新检查各自做了变异（吞错脚本、缺 typecheck、
   格式违规、未挂索引的文档），全部**精确变红并点名**。
4. **导航索引必须自带完整性检查。** 索引天生会腐坏（新文档写完就忘），
   所以把"每篇文档都能从索引到达"做成断言——**这是它唯一的维护机制**。
5. **脚本要保留真实退出码。** 命令行里现写的 `for` 循环会把 `$?` 丢给后续命令；
   推送/CI 校验这类"结果决定了下一步"的动作，值得固化成脚本（`push-main.sh` / `ci-verify.sh`）。

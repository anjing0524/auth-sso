# /retro（第二次）：把"声明 ≠ 实现""竞态""引号陷阱"变成规程与标准

> 日期：2026-10-15
> 来源：`/retro` 对**本目标这一整段会话**（6 个提交：`83112e2` → `71cc348`，含两轮两轴代码评审）的复盘
> 关联：上一次 retro 的产出 `2026-10-14-retro-environment-hardening.md`（A1–A5/D/G）；`CODING_STANDARDS.md` §11；`AGENTS.md`
> 词汇：module / interface / seam / leverage / locality

## 一、方法

按 `retro` 的七类（导航 / **自动化检查** / 编码标准 / AGENTS.md / 工具经济 / no-op / 信息获取）逐类找候选，
并按严重度排序。证据一律取**本会话实测**（提交信息、评审报告、失败输出），不用二手叙述。

## 二、候选与处置（按严重度）

### 1. 「**声明范围 ≠ 实现范围**」——本会话出现 **3 次** ⇒ **落成标准 §11**（最高优先）

三次的形态完全一致，都是"文档说 A，代码做 B"：

| 实例 | 声明 | 实现 |
|---|---|---|
| 代码评审查出 | `gate-inventory-guard` 文件头列了 `; true` 禁令 | 正则表只有 4 条（`; true` / `\|\| exit 0` / `\| tee` 全放过） |
| 代码评审查出 | ADR-022 说"**15** 个违例夹具" | 紧随的枚举仍列 **10** 项 |
| 代码评审查出 | README 声称"生成时脚本断言无重复" | **不存在**这样的生成脚本，也没有重复断言 |

⇒ **新增 `CODING_STANDARDS.md §11`**：同一事实只保留一处来源；写第二处就必须**指向第一处**或**加断言绑住**。
并给出可执行判据：写"必须/全部/每一个"时问 **"如果我少写一条，谁会红？"**——答不上来，那句话只是愿望。

### 2. **竞态**：两次都发生在"长作业 vs 写操作"上 ⇒ **落成 AGENTS.md 规程**

- 第一次：在同一次调用里「提交 + 启动 CI 校验」⇒ 脚本 `git rev-parse` 落在**旧提交**上，验了个已废弃的 run；
- 第二次：**在脚本运行中改写它** ⇒ bash 增量读取，读到半行，报 `*) break ;;` 语法错误（校验根本没跑完）。

⇒ AGENTS.md 新增：长任务开始前**固化 SHA**（`scripts/ci-verify.sh <sha>`）、不要并发写、不要在脚本运行时改它。

### 3. **批量改写脚本的引号陷阱**（本会话 **5 次**）⇒ **落成 AGENTS.md 规程**

把英文引号嵌进双引号 Python 字符串 ⇒ **整段脚本不执行**；其中一次导致索引与 roadmap 漏写，
是靠 `docs-references` 的完整性断言才发现的。⇒ AGENTS.md 新增："一律用三引号或中文引号；写完先看确认行是否打印"。

### 4. **规范性数字已全部有断言**（本类**无需新增检查**，只做确认）

逐个核对：夹具数 → `docs-claims`；索引篇数与"每篇恰好链接一次" → `docs-references`；
豁免集两副本相等 → `module-mock-guard`；禁令表 → `gate-inventory-guard`；错误组完整性 → `docs-api-error-codes`。
⇒ 本会话把这一类补得很密，retro 只需**确认**，不再重复造检查（避免"检查通胀"）。

### 5. 对外可见变更缺 release note ⇒ **写入 `CHANGELOG.md` 的 `[Unreleased]`**

404 统一、冲突码具体化、管理员不得自删/自禁、软删除语义修正、删除 24 个零引用码——
这些都是**集成方会感知**的变化。已按既有 `CHANGELOG.md` 格式补 `### Changed` / `### Removed`。

### 6. 采纳但**不改**（判断题，写明理由）

- 仓库根路径 `'../../../..'` 在多个守卫里各算一遍（收进 barrel 收益小、动面大）；
- `push-main.sh` / `ci-verify.sh` 的可调上限（`MAX_ATTEMPTS` / `MAX_WAIT_SECONDS`）；
- `gate-inventory-guard` 单列 `--no-eslintrc` 模式（与 #83 同源，保留可读性）。

### 7. 无发现

- **导航**：`docs/solution/README.md` 索引有效（本会话"这件事以前有人做过吗"多次靠它，
  且两次评审都验证了"每篇恰好链接一次"）；
- **AGENTS.md 规模**：新增 3 条后仍在 160 行量级，无 no-op；
- **工具经济**：`scripts/push-main.sh`（首次即成功）与 `ci-verify.sh` 已把"每轮现写 bash"收掉；
  `job_*` 后台作业的等待策略本会话未造成浪费。

## 三、验证

| 项 | 结果 |
|---|---|
| `pnpm test` | 全量绿（含 `docs-claims` / `docs-references` 的规范性数字断言） |
| 新增文档挂索引 | ✓（`docs-references` 断言"每篇恰好一次 + 声明篇数=实际篇数"） |
| 本轮改动 | `CODING_STANDARDS.md` §11 · `AGENTS.md` 两条例程 · `CHANGELOG.md` `[Unreleased]` |

## 四、最佳实践（可复用）

1. **"声明 ≠ 实现"要落成标准，而不是每次都靠评审抓。** 它在本会话出现 3 次、形态完全相同
   ⇒ 值得一条 §11；否则下次还会由评审来发现（而评审也是人写的，会漏）。
2. **规程也是环境的一部分。** 竞态与引号陷阱都不是代码问题，但都真实浪费了时间 ⇒
   写进 `AGENTS.md`（智能体每次都读的入口），而不是留在会话记忆里。
3. **不要造重复的检查。** 本类第 4 条的正确处置是"确认已有断言覆盖"，不是"再写一个守卫"——
   检查通胀会让门禁更难维护，也会稀释每条检查的分量。
4. **对外可见的变更必须走 changelog。** 内部重构可以只进 `docs/solution/`，
   但**错误码、状态码、权限规则、复用语义**这类要进 `CHANGELOG.md`。
5. **验证类数字与时点记录是允许的，规范性数字必须有断言。** 前者（"当时 104 文件 865 用例"）
   是历史；后者（篇数、夹具数、禁令条数）会**静默过期**——这正是 §11 要区分开的两种。


---

## 五、第三轮评审（对"修复本身"）：发现与处置

第三轮两轴评审的区间是 `4920381...HEAD`（即前两轮评审的**修复本身**）。它再次证明**"修复"也需要被评审**——
两轴各自独立复算后，抓到的问题集中在这一轮的主题上：

| # | 发现（评审实测） | 处置 |
|---|---|---|
| H4 | `push-main.sh` 的 `*"protected branch"*` 与 GitHub 真实文案（`GH006: Protected branch update failed`）**大小写不符** ⇒ 永久性拒绝被当成网络类，空等 ~200s | 改为大小写不敏感并补 `GH006`；stub 实测三种永久拒绝均**立即** exit 1 |
| H5 | `ci-verify.sh` **从不比较运行级 `conclusion`** ⇒ 0 个 job 的 `startup_failure`/`failure`/`cancelled` 会打印"✓ 全绿" | 增加运行级判据；**并加固计数解析**（空值曾误报"有  个 job 被取消"）。stub 四情形实测：success→0、failure→1、cancelled→1、success 但有 cancelled job→1 |
| H1/H2 | `gate-inventory-guard` 头部仍写"以下**四条**"（实为 5 条），并把只含已知形状的表称为"**完整**且规范性的清单" ⇒ 管道 `\| cat`、`; echo`、结尾 `&` 全部放过 | 计数不写死；措辞降级为"**已知形状，不是穷尽**"（真正的保证是 CI 用 `pnpm test` 的退出码）；补 3 类模式 + 4 条夹具 |
| H3 | `module-mock-guard` 的 `/\\.\\.\\./` 把"有 spread"当"spread 了真身" ⇒ `...defaults`、注释里的 `...actual`、数组 spread 全通过 | 改为**绑定 importOriginal 的结果变量**（`const actual = await importOriginal()` → `...actual`）；补夹具 16（有 `...` 但不是真身）/ 17（绑定真身的正例）。**收紧后立刻暴露一处假阳性**：`importOriginal<typeof import('x')>()`（真实存在于 `auth-refresh.test.ts`）⇒ 正则允许类型实参 |
| H8 | `field-error.tsx` 声称"渲染端形状只有这一处"，而 `CreateUserDialog` 仍有 3 份内联 `<p role="alert">`（且字号已从 `text-xs` 漂到 `text-sm`） | 那 3 处改用 `<FieldError>`；头注释改为实况（4 个文件共 8 处） |
| H9 | `FieldError.field: string` 与 hook 的 `readonly string[]` 把刚收紧的 `ErrorField` 又放宽 ⇒ `field="cdoe"` 零诊断 | 两处都收紧为 `ErrorField` |
| H10 | `API.md` 409 行的新断言"`AUTH_SSO_1005` 是参数校验失败的 400"与本仓 `error-status-guard.test.ts`（422 也带 1005）**冲突** | 改为"1005 是**通用**码，状态码由错误类决定（400/409/422）" |
| H6 | `docs/solution/README.md` 的假声明（"生成时脚本断言无遗漏、无重复"）**只加了更正注、没改原句** ⇒ 三行内自相矛盾 | 整句改写（由测试断言：可到达 / 恰好一次 / 篇数=实测） |
| H7 | "`module-mock-guard` **19 用例**"从未成立（实测 16）且把"豁免清单相等"记错文件 | 改为不写死用例数，并指明该断言在 `docs-claims` |
| A2 | ADR-022 与守卫的**夹具枚举**（14 项）与声明数字（15）不符、工厂形态数写成 4 | 数字 → 17、枚举补齐（16/17 加入），三处声明同步（`docs-claims` 钉） |
| A5 | 变异证据还差**输出**（只补了命令） | 两篇文档补上实测输出片段（红时的点名行 + 恢复后的全绿） |
| A6 | 去零采用者 export 这件事**没记录**，同类仍有 20 处 | 记录 ✅ + **20 处全部清掉**（逐名验证无引用方） |
| A7 | 写"魔法数下限被**接替**"，实际是**并存** | 措辞更正 |
| B3 | `sonner`（豁免目标）的注解 kind 是 `infra-boundary`，与语义更近的 `full-replacement` 不符 | 改为 `full-replacement` |

### 新增的**预防性**机制：并发运行检测

本轮我自己也踩了一次"红→绿"的假失败（同一文件连跑两次：先红后绿），两个评审子代理同样报告"全绿无法复现、
17 文件 118 用例红、无并发进程"。根因是本仓文档早已记载的：**两个 vitest 进程打同一个物理测试库会互相
`TRUNCATE … CASCADE`**（`duplicate key … departments_pkey`、`users_dept_id_fkey` 找不到父行）。

⇒ `vitest.globalSetup.ts` 新增 **PID 锁文件**：若另一个活着的进程持有锁，**明确报错**并给出处置命令
（`pgrep -af vitest`）。**实测**：并发启动第二个套件 ⇒ 立刻 `Error: [globalSetup] 另一个测试进程（pid 19）正在运行…`
并 exit 1，把十几分钟的困惑排查变成一行可操作的错误。

### 验证

| 项 | 结果 |
|---|---|
| `pnpm test` | **104 文件 / 871 用例全绿**（+6：gate-inventory +4 夹具、module-mock-guard +2） |
| `typecheck` / `lint` / `cargo fmt` / `clippy` | 4/4 · 0 error · 净 · 净 |
| 脚本 stub 实测 | `push-main.sh` 三种永久拒绝立即失败；`ci-verify.sh` 四情形（success/failure/cancelled/成功但有 cancelled job）全部正确 |
| 并发锁 | 第二个套件被明确拦下（exit 1，附处置命令） |

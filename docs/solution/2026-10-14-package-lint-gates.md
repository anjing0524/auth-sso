# 让"没上过门禁"的包真正过门禁 —— 以及一个**假门禁**被揭开（#83）

> 日期：2026-10-14
> 来源：**#83**（#77 的同类发现：`packages/contracts` 与 `packages/config` 没有 `lint` 脚本）
> 关联：ADR-022（测试/门禁真实性）、#77（同一类：契约包的测试不被 typecheck 覆盖）
> 词汇：module / interface / seam / leverage / locality

## 一、问题一：两个包不在"门禁名单"上

根 `package.json` 是 `"lint": "pnpm -r lint"`（递归）。而：

```
apps/portal      lint: eslint .
apps/demo-app    lint: npx eslint --no-eslintrc . 2>/dev/null || echo 'ok'   ← 见第二节
packages/contracts   （无 lint 脚本）
packages/config      （无 lint 脚本）
```

⇒ **`pnpm -r lint` 静默跳过**这两个包。而 `packages/contracts` 是**枚举值唯一真相源**
（错误码、权限码、OIDC 常量）——它的风格问题（未使用导入、`any` 泄漏、
`consistent-imports`）不会被任何门禁发现。这与 #77（该包的测试不被 typecheck 覆盖）**同一类**：
**一个包能否通过 CI，取决于它上没上"门禁名单"。**

## 二、问题二（本轮顺带揭开）：`apps/demo-app` 的 lint 是**假门禁**

```json
"lint": "npx eslint --no-eslintrc . 2>/dev/null || echo 'ok'"
```

- `--no-eslintrc` 在 ESLint 9 的 flat config 下**不是合法参数**；
- 错误被 `2>/dev/null` 吞掉，`|| echo 'ok'` 于是**永远输出 ok** ⇒ **门禁恒绿**。

把它改成真的 `eslint .` 后立刻暴露：**配置本身是坏的**——

```
Error: Cannot find module 'eslint-plugin-import'
```

`apps/demo-app/eslint.config.mjs`（正确的 Next 配置）**从来没能运行过**。
补上直接依赖 `eslint-plugin-import` 后，真实 lint 通过（该 app 的代码本身是干净的）。

> **假门禁比没有门禁更糟**：它给出虚假的绿色，并把"配置坏了"这件事藏了整整一个版本周期。
> 这正是 #83 备注里写的风险——**"脚本存在但什么都不检查"**。

## 三、修法

| 包 | 改动 |
|---|---|
| `packages/contracts` / `packages/config` | 新增 `eslint.config.mjs`（**框架无关**：`typescript-eslint` 推荐集 + workspace `sharedRules`）、`"lint": "eslint ."`、devDeps `eslint` + `typescript-eslint` |
| `apps/demo-app` | 假脚本 → `eslint .`；补 `eslint-plugin-import`（pnpm 的严格 `node_modules` 下"传递依赖可见"不成立） |

不照抄 `apps/portal` 的配置（它依赖 `eslint-config-next`）：纯 TS 包只需
`tseslint.configs.recommended` + 共享规则 ✓。

## 四、证明这些门禁**真的会失败**（#83 的核心要求）

新增"脚本"不等于"新增门禁"。逐包注入一次必然违规的代码，验证 lint 退出非 0：

| 包 | 注入 | 结果 |
|---|---|---|
| `packages/contracts` | `const UNUSED_PROBE = 1;` | **3 条 error**（`no-unused-vars`） |
| `packages/config` | `var VAR_PROBE = 1;` | **4 条 error**（`no-var` 等） |
| `apps/demo-app` | `var DEMO_PROBE = 1;` | **2 条 error**，exit 1 |

全部还原后 `git status` 只显示预期改动 ✓（`packages/contracts/src/errors.ts` 恢复为**逐字一致**）。

### 门禁接入的**即时回报**：抓到我自己上一轮的缺陷

`packages/contracts` 的新 lint 第一次运行就报：

```
src/__tests__/error-code-usage.test.ts
  27:37  error  'statSync' is defined but never used
```

那是 **R30 我写的守卫文件**——`tsc` 不报未使用导入（那不是类型错误），
`pnpm test` 也不会报（运行时无害）⇒ **只有 lint 能发现它** ✓。已修。

## 五、验证

| 门禁 | 结果 |
|---|---|
| `pnpm -r lint` | **4/4 包 Done**、exit 0（portal 的 84 条 warning 为既有） |
| 变异（3 次注入） | 每包 lint 都**失败** ⇒ 不是假门禁 |
| `pnpm -r typecheck` | 4/4 Done |
| `pnpm test` | **98 文件 / 812 用例全绿** |
| CI 覆盖 | workflow 第 41 行 `pnpm lint`（= 递归）⇒ 新脚本自动在 CI 内；`pnpm-lock.yaml` 已更新（docker 测试镜像用 `--frozen-lockfile`） |

## 六、最佳实践（可复用）

1. **"脚本存在"不是门禁，"会失败"才是。** 每新增一个门禁脚本，都要**注入一次违规**证明它会红
   （本轮 3 个包各做一次）。这与"守卫要证明会失败"是同一条纪律。
2. **假门禁比没有门禁更糟。** `2>/dev/null || echo 'ok'` 这类写法把"配置坏了"变成"永远绿"。
   凡是看到 `|| echo`/`|| true` 结尾的 lint/test 脚本，都要当作**告警**处理。
3. **门禁要逐个包确认，而不是相信聚合命令。** `pnpm -r X` 的绿色可能意味着"有些包压根没跑 X"——
   逐包核对 `scripts` 与根的递归命令。
4. **纯 TS 包不要照抄框架配置。** 只需 `typescript-eslint` 推荐集 + 共享规则；
   把 `eslint-config-next` 塞进无框架的包只会带来额外依赖与解析风险。
5. **打开门禁要同批修完存量问题。** 本轮一打开就抓到两处：我自己上一轮的未使用导入，
   以及 demo-app 的坏配置——**"先开灰灯再慢慢修"会让门禁立刻被无视**。

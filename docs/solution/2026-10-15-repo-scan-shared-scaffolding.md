# 守卫的 repo 扫描脚手架：收成一个 module（架构巡检候选 2）

> 日期：2026-10-15
> 来源：`/improve-codebase-architecture` 巡检的 **Top 推荐**（候选 2 `Strong`）+ 巡检额外发现（`pre-commit` 守卫名单漂移）
> 巡检报告：`docs/archive/architecture-review-2026-10-15.html`
> 词汇：module / interface / seam / depth / leverage / locality（`codebase-design`）

## 一、问题：同一个安全语义抄了两遍，第二遍靠注释提醒第一遍

本仓有一族"把机械性违规做成确定性检查"的静态守卫（8 个文件、1406 行）。巡检实测：
**每个守卫各自算仓库根、各自 walk、各自断言"扫描范围非空"**：

| 重复物 | 出现处 |
|---|---|
| `__tests__/api/` → 上溯 4 层到仓库根 | **7 份（8 个守卫内）／9 份（含 contracts 与 deployment-wiring）**；两个名字 `REPO_ROOT` / `ROOT` + 一处匿名 `path.resolve` |
| `walk`（递归收集文件） | **5 份**（其中一份在 `packages/contracts`） |
| `isCommentLine`（跳不跳注释） | **2 份**（第二份的注释写着"教训来自 module-mock-guard"） |
| "扫描范围非空"断言 | 阈值各写各的（`≥50` / `≥4` / 无），靠作者记得加 |

`isCommentLine` 不是小细节：它是"跳不跳注释"的判定，而这些守卫最容易出的就是**假绿/假红**
（在注释里叙述某个模式是常态——解释"为什么不能用它"、记录"此前是这么写的"）。
`cache-invalidation-site-guard.test.ts:34-36` 的注释直白地承认了这一点：**同一个语义抄了两遍**。

## 二、做法：一个深 module，8 个调用点

新 module `apps/portal/__tests__/helpers/repo-scan.ts`（接口小，行为厚）：

| 接口 | 作用 |
|---|---|
| `REPO_ROOT` | **向上找 `pnpm-workspace.yaml`** 得到的仓库根（唯一出处） |
| `walk(dir, isTarget, skipDirs?)` | 递归收集；目录不存在返回空（不抛错） |
| `tsFiles(dir, { includeTests? })` | `.ts`/`.tsx`，默认排除测试自身 |
| `assertScannedNonEmpty(items, what, min?)` | "空扫描即假绿"的统一防线（泛型，只看长度） |
| `isCommentLine(line, codeToken?)` | 整行注释 + "token 之前有 `//`"的行尾注释 |
| `stripComments(source)` | 块注释 + 行注释（不影响 `https://`） |

**8 个 portal 守卫**全部改为直接打这个接口（另加本 module 的自测）。

> **seam 止于包边界**（实测决策）：`packages/contracts` 的守卫一度也改成引用本 module，
> 但 `pnpm -r typecheck` 直接报 `TS6059: File … is not under 'rootDir' packages/contracts`
> ——跨包引用会让该包的编译根垮掉（pre-commit 的 typecheck 当场拦下这次提交）。
> 它本来也有包特有的跳过语义（`node_modules` / `target` / `coverage`），
> 于是**保留本地 walk**：两个用户跨了包边界、且一边要付编译根代价 ⇒ 这个 seam 不划算。

## 三、四个关键设计决策（都不是风格问题）

1. **根推导：向上找标志文件，而不是"上溯 N 层"。**
   旧写法把"`__tests__/api/` 距仓库根 4 层"写死在 6 处。本次把 module 从 `test-support/`
   移到 `__tests__/helpers/`（另一个设计决策，见第 3 条）——**旧写法刚好会因此全部失效**，
   这就是"数层数"的真实代价。
2. **非空断言必须有**有意义的**下限，且下限不准随便放宽。**
   先写成 `min = 1` ⇒ 变异测试立刻暴露它没用：把 `walk` 的递归打断后，扫描范围仍然"非空"
   （顶层几个文件），守卫**照样绿**。改为按实测规模设定（模块级 mock 扫描 `≥50`／
   `apps/portal/src` `≥40`／`route.ts` `≥10`）后，同一次变异 ⇒ **3 个守卫 4 条红**，
   消息是"实测 0，期望 ≥ 10……别放宽阈值"。
3. **module 放在被 lint 覆盖的包内。**
   第一版放在仓库根的 `test-support/`（意图是"跨包共享"），但根 `lint` 脚本是 `pnpm -r lint`
   ⇒ **根目录的 TS 逃过 lint**（实测：报 `File ignored because outside of base path`）。
   移到 `apps/portal/__tests__/helpers/` 后进入 lint 面；contracts 的守卫用相对路径引用它。
4. **`pre-commit` 的守卫名单由扫描派生，不再手抄。**
   巡检额外发现：钩子里硬编码的 5 个文件**漏了 3 个守卫**
   （`cache-invalidation-site-guard` / `error-status-guard` / `scoped-write-guard`）
   ⇒ 本地提交有"5 个守卫绿了"的假绿窗口（CI 跑全量所以不漏）。
   改为 `$(ls apps/portal/__tests__/api/*guard.test.ts apps/portal/__tests__/api/docs-*.test.ts)`
   ⇒ 8 个文件全在。**这正是本 module 的 leverage 论证的现成例子**：把"哪些文件算守卫"
   变成可被扫描的事实，这类漂移就能机械挡住。

## 四、验证

| 项 | 结果 |
|---|---|
| `tsc --noEmit` | 0 错（含 module 与其自测） |
| `pnpm -r lint` | 0 error（module 在包内 ⇒ 被覆盖） |
| 8 个守卫 + module 自测 | **9 文件 / 72 用例全绿** |
| `pnpm test` | **105 文件 / 883 用例全绿**（+1 文件 +12 用例） |
| **变异** | 打断 `walk` 递归 ⇒ 3 个守卫 **4 条红**（消息可操作）；还原后 `git diff` 为空 + 守卫复绿 |
| `pre-commit` 名单 | 由派生改为 8 个（`bash -n` 通过；钩子实测通过） |

## 五、最佳实践（可复用）

1. **同一个安全语义只能有一处实现。** 判定逻辑（跳注释、扫描范围、阈值）被抄第二遍时，
   第一遍与第二遍会各自演化，且**没人会发现**——直到某一边出现假绿。
2. **"上溯 N 层"是定时炸弹。** 用"向上找标志文件"（`pnpm-workspace.yaml`）把仓库形状的
   知识放在一处；目录一调整，数层数的写法就静默失效。
3. **下限写 1 等于没设。** 非空断言的目的是挡住"结构性失效"（不递归、过滤条件写错），
   所以下限必须接近**实测规模**；而"下限"必须带可操作的消息（"别放宽阈值，先查扫描路径"）。
4. **基础设施代码要落在被门禁覆盖的位置。** 放在 lint/typecheck 覆盖范围之外的"共享目录"，
   等于给自己开一个静默区（本次实测：根 `test-support/` 逃过 `pnpm -r lint`）。
5. **手抄的名单一定会漂移。** 凡是"哪些文件/哪些项属于某一类"的判断，都应由
   **扫描事实**派生（本仓已有 `gate-inventory-guard` 守 `package.json` 的清单，
   本条把同一思路用在 `pre-commit` 的守卫名单上）。

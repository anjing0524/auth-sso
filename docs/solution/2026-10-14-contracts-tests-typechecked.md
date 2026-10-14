# 让契约包的测试真的被类型检查 —— 守卫不能是装饰（#77）

> 日期：2026-10-14
> 来源：R2 第二轮次级候选之三「错误码词汇表」（#76）的**变异验证副产物**
> 关联 ADR：ADR-022（测试真实性）、ADR-021（变异验证纪律）
> 词汇：module / interface / seam / leverage / locality

## 一、问题：该包的测试从来不在编译范围内

`packages/contracts/tsconfig.json`：

```json
"include": ["src/**/*"],
"exclude": ["node_modules", "dist", "src/__tests__"]     // ← 测试被排除
```

该包只有两个脚本：`typecheck: tsc --noEmit`、`test: vitest run` —— **`typecheck` 用的就是这个 tsconfig**
⇒ `src/__tests__/**` 完全不被类型检查。

### 它是怎么被发现的

#76 里我在 `src/__tests__/errors.test.ts` 放了一条**类型层守卫**：

```ts
// @ts-expect-error 'INVALID_SCOPE' 不在词汇表内
const NOT_A_CODE: ErrorCode = 'INVALID_SCOPE';
```

随后做变异（把 `ErrorCode` 退化成 `string`）：**`npx tsc --noEmit` 仍然通过**。
因为那条 `@ts-expect-error` 根本不在编译范围内，"指令未使用"也不会报错。

> **守卫只是装饰。** 这与 R15 的另一条教训（"类型退化会让 `@ts-expect-error` 失效"）
> 是同一课题的两面：**守卫的价值 = 它被检查的强度**。

### 顺带：该包连 `@types/node` 都没有

`ttl-sync.test.ts` 用 `node:fs` / `node:path` / `__dirname` 读 Gateway 的 Rust 常量做跨语言同步校验，
而 `@types/node` 只装在 `apps/portal` ⇒ 把测试纳入编译后立刻报：

```
error TS2591: Cannot find name 'node:fs'      (src/__tests__/ttl-sync.test.ts:5)
error TS2591: Cannot find name 'node:path'    (…:6)
error TS2304: Cannot find name '__dirname'    (…:9)
```

## 二、修复

1. **装 `@types/node`**（`pnpm add -D @types/node@^26.0.0 --filter @auth-sso/contracts`）
   —— 版本与 `apps/portal` 对齐；`pnpm-lock.yaml` 已更新（CI 用 `--frozen-lockfile`）。
2. **`packages/contracts/tsconfig.json` 从 `exclude` 移除 `src/__tests__`**。
3. **加 `"types": ["node"]`**（与 `packages/config/tsconfig.json` 的既有做法一致）。

> 第 3 步不是多余的：只装 `@types/node` 后仍报同样的错——本仓库的**基座 tsconfig 没有声明 `types`**，
> 而 `packages/config` 早就用显式 `"types": ["node"]` 解决过同一个问题（**对齐既有做法**，
> 而不是发明新写法）。

4. **类型层守卫移回它的自然归属**：`packages/contracts/src/__tests__/errors.test.ts`
   （词汇表的测试在本包；此前被迫寄居 portal）。portal 侧那份删除，
   避免同一守卫在两处维护（"两处就要改两处"）。并在 contracts 的测试文件头写明
   **不要再把 `src/__tests__` 加回 `exclude`**，否则守卫会静默失效。

## 三、验证

| 证据 | 结果 |
|---|---|
| **变异 S**（`ErrorCode` 退化成 `string`） | `packages/contracts` `tsc --noEmit` **报错** `src/__tests__/errors.test.ts(65,1): error TS2578: Unused '@ts-expect-error' directive` —— **修复前实测静默通过** |
| 还原哈希 | `packages/contracts/src/errors.ts` = `b343fd90e5c6fcfd…c248a2a8` 逐字一致 |
| 仓库级 `pnpm -r typecheck`（CI 路径） | 4 个项目全 Done、exit 0 ⇒ 契约包已在门禁内 |

### 门禁

| 门禁 | 结果 |
|---|---|
| `pnpm test` | **96 文件 / 786 用例全绿**（契约包 6 文件 62 用例，+1 守卫用例；portal 侧 −1 同源用例） |
| `pnpm -r typecheck` | exit 0（含契约包） |
| `eslint`（改动文件） | 0 问题 |

## 四、顺带发现（同类：包未被门禁覆盖）

`packages/contracts` 与 `packages/config` **都没有 `lint` 脚本** ⇒ `pnpm -r lint` 跳过它们
（根目录也没有可用的 `eslint` 二进制，平面配置的覆盖范围未含这两个包）。
这与 #77 是**同一类**：**一个包能否通过 CI，取决于它上没上"门禁名单"**。
已另记 issue，不在本票一并处理（需要先确认平面配置对这两个包的覆盖方式）。

## 五、最佳实践（可复用）

1. **守卫必须放在"会被检查"的地方。** 写完任何守卫（类型层断言、迁移/一致性检查、恢复脚本）
   都要问：**它在 CI 的哪一步被真正执行？** 本轮之前，那条 `@ts-expect-error` 的答案是"没有"。
   验证手段只有一个——**做一次变异，看它是否真的会失败**（本轮：变异 S）。
2. **`exclude` 里的 `__tests__` 是隐形门禁缺口。** 仓库里其它三个包（portal/gateway/config）
   都包含测试；只有契约包排除。**逐包核对 `include`/`exclude` 与脚本的组合**，
   比相信"`pnpm -r typecheck` 全绿"更可靠——它绿，可能是因为**它压根没检查**。
3. **先照既有做法对齐，再考虑新写法。** 缺 `@types/node` 的下一步不是发明 `tsconfig.typecheck.json`，
   而是看同仓 `packages/config` 怎么做的（`"types": ["node"]`）——**仓库里往往已经有人解过同一个问题**。
4. **同一守卫不要在两处维护。** #76 期间我把守卫临时放在 portal 才生效；#77 修复后移回契约包。
   临时措施要留下"为什么在这里"的注释，并在条件消失后**迁回**，否则会变成两处都要改。
5. **依赖新增要走 lockfile。** `--offline` 在本仓不可行（pnpm 需要全部依赖的元数据），
   走正常 `pnpm add` 即可；CI 的 `--frozen-lockfile` 会验证 lockfile 与 `package.json` 一致。

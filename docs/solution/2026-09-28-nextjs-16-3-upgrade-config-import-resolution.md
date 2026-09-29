# 2026-09-28 Next.js 16.2.9 → 16.3.6 升级：next.config.ts 导入解析修复

> 来源：Next.js latest 升级（16.3.6 含关键 RCE 安全修复）期间，生产等价 Docker 构建暴露 `next.config.ts` 跨文件导入解析失败。
> 关联：ADR-012（OIDC issuer env 驱动）、`next.base.ts` workspace 共享配置（commit 3f3ebfe 扁平化）。

## 现象

`next build`（Turbopack）在配置加载阶段失败：

```
Error: Cannot find module '/home/uos/Documents/auth-sso/next.base'
imported from /home/uos/Documents/auth-sso/apps/portal/next.config.compiled.js
    at ...
    code: 'ERR_MODULE_NOT_FOUND',
    url: 'file:///home/uos/Documents/auth-sso/next.base'
```

## 根因

`next.config.ts` 的**配置评估按 ESM 语义解析相对导入，且不做扩展名探测**：

- Node 26（`process.features.typescript = 'strip'` 默认开启）下实测：
  - ESM `import './lib'`（无扩展名）→ `ERR_MODULE_NOT_FOUND`（报错形态与构建失败完全一致：绝对路径 + `url` 字段）；
  - ESM `import './lib.ts'`（显式扩展名）→ 正常（类型剥离加载）；
  - CJS `require('./lib')` 同样**不探测** `.ts`（`require.extensions['.ts']` 仅在扩展名确定后生效）。
- 因此 `import { baseNextConfig } from '../../next.base'` 在任何加载路径下都无法命中 `next.base.ts`。
- TypeScript 侧无感知：`moduleResolution: 'bundler'` 允许无扩展名导入，IDE 与 `tsc --noEmit` 全绿——**类型检查通过 ≠ 构建工具链可解析**。

## 修复（两处）

1. `apps/portal/next.config.ts`：导入改显式扩展名 `from '../../next.base.ts'`（两种加载语义下都成立：ESM 类型剥离必需显式扩展名；CJS 精确路径命中 `require.extensions['.ts']` hook）。
2. `apps/portal/tsconfig.json`：删除 `allowImportingTsExtensions: false` 覆盖（3f3ebfe 批量保守默认引入，无特定理由；`tsconfig.base.json` 本就 `true` 且 `noEmit: true`）。

## 同类问题审阅（修订范围）

配置加载链路全面排查：

| 配置 | 导入 | 加载器 | 结论 |
|---|---|---|---|
| `apps/portal/next.config.ts` → `next.base.ts` | 无扩展名 | **next build（ESM 严格）** | ✅ 已修复（本文档） |
| `vitest.*.config.ts` → `vitest.base` | 无扩展名 | Vite（bundler 解析，探测扩展名） | 无需改 |
| `eslint.config.mjs` → `eslint.base.mjs` | 显式 `.mjs` | jiti/ESLint | 无需改 |
| `drizzle.config.ts` → `drizzle.base` | 无扩展名 | tsx（探测扩展名） | 无需改 |
| `next.base.ts` 自身 | 零导入（纯对象） | — | 无传递风险 |

**最佳实践**：凡进入 `next build`/`next dev` 配置评估的导入链（含传递导入），相对导入必须显式带扩展名。其余工具链（Vite/tsx/eslint）有 bundler 级扩展名探测，不受影响。

## 升级验证矩阵（16.3.6）

| 门禁 | 结果 |
|---|---|
| `pnpm -r typecheck` | ✅ 0 错误 |
| `pnpm -r lint` | ✅ 0 错误（284 条存量警告与升级无关） |
| `pnpm test`（vitest 4 projects） | ✅ 43 文件 / 356 测试全绿 |
| 生产等价构建（`apps/portal/Dockerfile`，node:26-alpine + Turbopack） | ✅ 26.5s，全部路由正常，standalone 导出 |
| 容器冒烟（`docker run` → curl） | ✅ `/.well-known/openid-configuration` 200（issuer 正确）；`/login` 200 |

## 环境备注（非本次回归，记录防误判）

1. **本机 glibc 2.28 < SWC 要求 2.29**：`@next/swc-linux-x64-gnu` 无法加载，Turbopack 拒绝 WASM 绑定 → **本机裸机无法跑 `next build`**（与 Next 版本无关）。本地构建统一走 Dockerfile：根级 `pnpm build:docker`（即 `docker build -f apps/portal/Dockerfile`），用户已入 docker 组。
2. **构建期环境参数（2026-09-28 参数化）**：`apps/portal/Dockerfile` 暴露三个带默认值的 `ARG`——`NEXT_PUBLIC_APP_URL`（默认 `http://localhost:4100`）、`NEXT_PUBLIC_APP_NAME`、`PORTAL_ISSUER`（空则由 APP_URL 推导）。`NEXT_PUBLIC_*` 内联进客户端包、预渲染路由（OIDC Discovery）在构建期读取，**必须与目标环境一致**：`--build-arg NEXT_PUBLIC_APP_URL=https://xxx` 即可构建任意环境（dev/test/staging/prod）。
3. `demo-app` 升级同步至 16.3.6（配置自包含，无跨文件导入，无需改动）。

/**
 * 守卫：env schema 里的每个变量都必须在 `.env.example` 里**出现过**（可注释，但不可无记载）
 *
 * ## 为什么需要
 *
 * `packages/config/src/env.ts` 的 Zod schema 才是"代码实际读哪些环境变量"的真相源，
 * 而 `.env.example` 是新人配置环境的唯一入口。schema 里加了变量、模板里没写 ⇒
 * 新人配不出能跑的环境（本仓 2026-10-19 实测：`PORTAL_ISSUER` 与 `TRUSTED_ORIGINS`
 * 就完全没被提到；`DATABASE_URL` 的示例库名 `auth_sso_portal` 也不存在，真实库是 `auth_sso`）。
 *
 * 判据刻意宽松：**出现即算**（注释掉的可选变量也是文档的一部分），只防"完全没记载"。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const ENV_SCHEMA = join(REPO_ROOT, 'packages/config/src/env.ts');
const ENV_EXAMPLE = join(REPO_ROOT, 'apps/portal/.env.example');

/** 从 schema 源码里抽出键名（形如 `  KEY: z…`） */
function schemaKeys(): string[] {
  const src = readFileSync(ENV_SCHEMA, 'utf8');
  return [...src.matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,}):/gm)].map((m) => m[1]!);
}

describe('env schema ↔ .env.example 覆盖', () => {
  it('schema 的每个变量都在 .env.example 里出现过', () => {
    const keys = schemaKeys();
    // 非空下限：防止 schema 结构变化后守卫悄悄变成空转
    expect(keys.length, `实测 schema 键数 ${keys.length}`).toBeGreaterThanOrEqual(10);

    const example = readFileSync(ENV_EXAMPLE, 'utf8');
    // 用**词边界**而非子串：否则 TRUSTED_ORIGIN 会因 ⊂ TRUSTED_ORIGINS 而假绿。
    // 范围刻意只查 portal 的 .env.example：它是这份 schema 的规范模板；
    // 根 .env.example 面向 Docker 部署面，允许有所取舍。
    const missing = keys.filter((k) => !new RegExp(`\\b${k}\\b`).test(example));
    expect(missing.join(', '), '以下环境变量在 .env.example 中完全没被提到').toBe('');
  });
});

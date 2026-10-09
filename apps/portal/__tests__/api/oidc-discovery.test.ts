/**
 * OIDC Discovery 文档契约（GET /.well-known/openid-configuration）
 *
 * ## 为什么需要它
 *
 * 这是**唯一完全无单测的公开端点**：19 个元数据字段里，e2e 只断言了 4 个的
 * 存在性（`toBeDefined`），其余从不校验。而它是所有外部 RP 与 Gateway 接入
 * 本 Provider 的**唯一入口**——字段写错或端点路径漂移会静默打破全部互操作。
 *
 * 本文件锁定三件事（均按规范要求，而非按当前实现复述）：
 *
 * 1. **端点路径必须对应真实存在的路由文件**。路径在 discovery 里是硬编码
 *    字符串；若某天路由被重命名而 discovery 未同步，没有任何测试会失败，
 *    外部 RP 却会拿到 404。故此断言**文件系统**，而非断言字符串字面量。
 * 2. **OIDC Discovery §3 的必需字段齐全**，且按 RFC 8414 §2 扩展字段必须
 *    带命名空间前缀（`com_authsso_*`），不得使用会与注册字段冲突的裸名。
 * 3. **issuer 与各端点 URL 同源**（OIDC Discovery §4.3）：issuer 必须与
 *    discovery URL 同源，且端点应为绝对 URL。
 *
 * @req H-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi } from 'vitest';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ISSUER = 'https://sso.example.com';

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return {
    ...actual,
    getIssuer: () => ISSUER,
    getAppBaseURL: () => ISSUER,
  };
});

import { GET } from '@/app/.well-known/openid-configuration/route';
import {
  CODE_CHALLENGE_METHODS_SUPPORTED,
  GRANT_TYPES_SUPPORTED,
  ID_TOKEN_SIGNING_ALG_VALUES_SUPPORTED,
  RESPONSE_TYPES_SUPPORTED,
  SCOPES_SUPPORTED,
  SUBJECT_TYPES_SUPPORTED,
} from '@auth-sso/contracts';

/**
 * app 目录，**相对本测试文件**解析。
 *
 * 不能用 `process.cwd()`：vitest 的 cwd 是仓库根，而 project 的 root 是
 * `apps/portal`，二者不一致会让路径静默解析到不存在的目录（曾因此产生过一个
 * 假阳性失败）。
 */
const APP_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../src/app',
);

/** discovery 字段名 → 该端点对应的真实路由文件相对路径 */
const ENDPOINT_ROUTES: ReadonlyArray<readonly [string, string]> = [
  ['authorization_endpoint', 'api/auth/oauth2/authorize/route.ts'],
  ['token_endpoint', 'api/auth/oauth2/token/route.ts'],
  ['userinfo_endpoint', 'api/auth/oauth2/userinfo/route.ts'],
  ['introspection_endpoint', 'api/auth/oauth2/introspect/route.ts'],
  ['revocation_endpoint', 'api/auth/oauth2/revoke/route.ts'],
  ['jwks_uri', 'api/auth/jwks/route.ts'],
  ['end_session_endpoint', 'api/auth/logout/route.ts'],
  ['com_authsso_refresh_endpoint', 'api/auth/refresh/route.ts'],
];

async function fetchDocument(): Promise<Record<string, unknown>> {
  const res = await GET();
  expect(res.status).toBe(200);
  return (await res.json()) as Record<string, unknown>;
}

describe('OIDC Discovery 文档结构', () => {
  it('OIDC Discovery §3 的必需字段全部齐全', async () => {
    const doc = await fetchDocument();

    for (const field of [
      'issuer',
      'authorization_endpoint',
      'token_endpoint',
      'jwks_uri',
      'response_types_supported',
      'subject_types_supported',
      'id_token_signing_alg_values_supported',
    ]) {
      expect(doc[field], `缺少必需字段 ${field}`).toBeDefined();
    }
  });

  it('issuer 是一个合法的 https URL（曾因非 URL 值违反规范）', async () => {
    const doc = await fetchDocument();

    expect(() => new URL(doc['issuer'] as string)).not.toThrow();
    expect(doc['issuer']).toBe(ISSUER);
  });

  it('**每个声明的端点路径都对应真实存在的路由文件**（防声明与实现漂移）', async () => {
    const doc = await fetchDocument();

    for (const [field, relPath] of ENDPOINT_ROUTES) {
      const url = doc[field];
      expect(typeof url, `${field} 应为字符串`).toBe('string');

      // 从 URL 取路径，映射回 app 目录下的路由文件
      const declPath = new URL(url as string).pathname;
      const expected = `${declPath}/route.ts`.replace(/\/+/g, '/');
      const resolved = path.join(APP_DIR, expected);
      expect(
        existsSync(resolved),
        `${field} 声明 ${declPath}，但解析出的 ${resolved} 不存在——discovery 与路由已漂移`,
      ).toBe(true);

      // 同时校验与测试表里声明的映射一致（防本表自身腐化）
      expect(declPath).toBe(`/${relPath.replace(/\/route\.ts$/, '')}`);
    }
  });

  it('所有 URL 字段均为绝对地址且与 issuer 同源', async () => {
    const doc = await fetchDocument();
    const issuerOrigin = new URL(ISSUER).origin;

    const urlFields = Object.entries(doc).filter(
      ([, v]) => typeof v === 'string' && (v as string).startsWith('https://'),
    );
    expect(urlFields.length).toBeGreaterThan(0);

    for (const [field, value] of urlFields) {
      const parsed = new URL(value as string);
      expect(parsed.origin, `${field} 与 issuer 不同源`).toBe(issuerOrigin);
    }
  });

  it('自定义扩展字段带命名空间前缀（RFC 8414 §2），不得用裸名', async () => {
    const doc = await fetchDocument();

    const custom = Object.keys(doc).filter(
      (k) => k.includes('refresh') || k.includes('callback'),
    );
    expect(custom).toContain('com_authsso_refresh_endpoint');
    expect(custom).toContain('com_authsso_callback_path');
    // 裸名的 refresh_endpoint / oauth_callback_path 会与注册字段名冲突
    expect(custom).not.toContain('refresh_endpoint');
    expect(custom).not.toContain('oauth_callback_path');
  });

  it('值数组**逐项等于** contracts 常量（单一真相源，防就地字面量漂移）', async () => {
    const doc = await fetchDocument();

    // 断言「等于 contracts 常量」而非「包含某值」：后者在有人就地改写数组时仍会
    // 通过，无法证明单一真相源成立。
    expect(doc['scopes_supported']).toEqual([...SCOPES_SUPPORTED]);
    expect(doc['response_types_supported']).toEqual([...RESPONSE_TYPES_SUPPORTED]);
    expect(doc['grant_types_supported']).toEqual([...GRANT_TYPES_SUPPORTED]);
    expect(doc['subject_types_supported']).toEqual([...SUBJECT_TYPES_SUPPORTED]);
    expect(doc['code_challenge_methods_supported']).toEqual([
      ...CODE_CHALLENGE_METHODS_SUPPORTED,
    ]);
    expect(doc['id_token_signing_alg_values_supported']).toEqual([
      ...ID_TOKEN_SIGNING_ALG_VALUES_SUPPORTED,
    ]);
  });

  it('PKCE 仅声明 S256（plain 为 OAuth 2.1 禁止项）', async () => {
    const doc = await fetchDocument();

    expect(doc['code_challenge_methods_supported']).toContain('S256');
    expect(doc['code_challenge_methods_supported']).not.toContain('plain');
  });
});

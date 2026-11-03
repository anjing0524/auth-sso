/**
 * 受保护 API 路由的“接线冒烟”（一条测试覆盖全部 route）。
 *
 * 行为矩阵在 permission-enforcement.test.ts：401/403/错误映射/超级管理员旁路。
 * 本文件只回答一个结构问题：每个受保护 route 是否真的接了授权门面？
 * 新增 route 若既不在 public 也不在 manual 允许表、又没接 withPermission/withAuth，会在这里红。
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from '../helpers/repo-scan';

const API_ROOT = 'apps/portal/src/app/api';

/** 公开路由：OIDC/auth/health/机器注册，不需要用户会话 */
const PUBLIC = new Set([
  'auth/jwks/route.ts',
  'auth/login/route.ts',
  'auth/logout/route.ts',
  'auth/refresh/route.ts',
  'auth/oauth2/authorize/route.ts',
  'auth/oauth2/introspect/route.ts',
  'auth/oauth2/revoke/route.ts',
  'auth/oauth2/token/route.ts',
  'auth/oauth2/userinfo/route.ts',
  'health/route.ts',
  'permissions/register/route.ts',
]);

/** 手工会话路由：只做身份解析，不做 RBAC */
const MANUAL_AUTH = new Set([
  'me/route.ts',
  'me/permissions/route.ts',
]);

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(REPO_ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`;
    if (entry.isDirectory()) out.push(...routeFiles(rel));
    else if (entry.name === 'route.ts') out.push(rel.replace(`${API_ROOT}/`, ''));
  }
  return out;
}

describe('API 路由授权接线', () => {
  it('每个受保护 route 都接了 withPermission/withAuth；新增 route 不得静默裸奔', () => {
    const violations: string[] = [];
    for (const route of routeFiles(API_ROOT)) {
      if (PUBLIC.has(route)) continue;
      const source = readFileSync(join(REPO_ROOT, API_ROOT, route), 'utf-8');
      if (MANUAL_AUTH.has(route)) {
        if (!source.includes('resolveIdentity')) violations.push(`${route}: manual-auth route 缺少 resolveIdentity`);
        continue;
      }
      if (!source.includes('withPermission(') && !source.includes('withAuth(')) {
        violations.push(`${route}: 未接 withPermission/withAuth`);
      }
    }
    expect(violations, violations.join('\n')).toEqual([]);
  });
});

import { describe, expect, it } from 'vitest';
import fixture from './jwt-claims-fixture.json';
import { PORTAL_CLIENT_ID, TOKEN_TTL } from './oidc';
import { PORTAL_JWT_CLAIM_KEYS } from './jwt-contract';

/**
 * Portal JWT Claims 跨语言契约测试（A5-3）
 *
 * 唯一真相源：jwt-claims-fixture.json。Rust 侧（Gateway `auth::Claims`）
 * 以 include_str! 消费同一文件；本文件守护签发端语义。
 */
describe('Portal JWT Claims 跨语言契约（A5-3）', () => {
  it('字段集合恰好为双端约定的 6 个 claims', () => {
    expect(Object.keys(fixture).sort()).toEqual([...PORTAL_JWT_CLAIM_KEYS].sort());
  });

  it('exp - iat = ACCESS_TOKEN TTL（3600s，Gateway 三态续签依赖该窗口）', () => {
    expect(fixture['exp'] - fixture['iat']).toBe(TOKEN_TTL.ACCESS_TOKEN);
  });

  it('iss 为 URL 且 aud/client_id 为签发对象 client_id（ADR-013）', () => {
    expect(fixture['iss']).toMatch(/^https?:\/\//);
    expect(fixture['aud']).toBe(PORTAL_CLIENT_ID);
    expect(fixture['client_id']).toBe(PORTAL_CLIENT_ID);
  });

  it('jti 带 jti_ 前缀（Redis jti 黑名单键空间契约）', () => {
    expect(fixture['jti'].startsWith('jti_')).toBe(true);
  });

  it('sub 为 UUID 形态（users.id 主键契约）', () => {
    expect(fixture['sub']).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  });
});

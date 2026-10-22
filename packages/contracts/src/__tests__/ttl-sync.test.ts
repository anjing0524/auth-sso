/**
 * @req NFR-PERF-03
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TOKEN_TTL } from '../oidc';

const RUST_AUTH_MOD = resolve(__dirname, '../../../../apps/gateway/src/auth/mod.rs');

function readRustMod(): string {
  return readFileSync(RUST_AUTH_MOD, 'utf-8');
}

function extractConstU64(source: string, name: string): number | null {
  const re = new RegExp(`${name}\\s*:\\s*u64\\s*=\\s*(\\d+)`);
  const m = source.match(re);
  return m ? Number(m[1]) : null;
}

describe('Rust ↔ TypeScript TTL 同步', () => {
  it('ACCESS_TOKEN TTL: Gateway(ACCESS_TOKEN_MAX_AGE_SEC) === Contracts(TOKEN_TTL.ACCESS_TOKEN)', () => {
    const rust = readRustMod();
    const gatewayAt = extractConstU64(rust, 'ACCESS_TOKEN_MAX_AGE_SEC');
    expect(gatewayAt, '未找到 ACCESS_TOKEN_MAX_AGE_SEC 常量').not.toBeNull();
    expect(gatewayAt).toBe(TOKEN_TTL.ACCESS_TOKEN);
  });

  it('REFRESH_TOKEN TTL: Gateway(REFRESH_TOKEN_MAX_AGE_SEC) === Contracts(TOKEN_TTL.REFRESH_TOKEN)', () => {
    const rust = readRustMod();
    const gatewayRt = extractConstU64(rust, 'REFRESH_TOKEN_MAX_AGE_SEC');
    expect(gatewayRt, '未找到 REFRESH_TOKEN_MAX_AGE_SEC 常量').not.toBeNull();
    expect(gatewayRt).toBe(TOKEN_TTL.REFRESH_TOKEN);
  });
});

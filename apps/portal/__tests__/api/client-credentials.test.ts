/**
 * OAuth Client 凭证解析测试 — 纯函数单测（无 DB）
 *
 * 覆盖 client_secret_basic / client_secret_post 双通道（RFC 6749 §2.3.1）：
 * Basic 解析、urlencoded 解码、body 回退、双通道冲突拒绝。
 *
 * @req H-AUTH-003
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { resolveClientCredentials } from '@/lib/auth/client-credentials';
import { InvalidClientError } from '@/domain/shared/errors';

function reqWithBasic(credentials: string): Request {
  return new Request('http://localhost:4100/api/auth/oauth2/token', {
    headers: { authorization: `Basic ${credentials}` },
  });
}

function basicOf(username: string, password: string): string {
  return Buffer.from(`${username}:${password}`).toString('base64');
}

describe('resolveClientCredentials', () => {
  it('解析 Basic 头凭证（client_secret_basic）', () => {
    const req = reqWithBasic(basicOf('portal', 'portal-secret'));
    const creds = resolveClientCredentials(req, {});
    expect(creds).toEqual({ clientId: 'portal', clientSecret: 'portal-secret' });
  });

  it('Basic 凭证按 RFC 6749 §2.3.1 做 urlencoded 解码', () => {
    // client_id 'cl@x'、secret 'p@ss word' 经 form-urlencoded 后拼接
    const req = reqWithBasic(basicOf('cl%40x', 'p%40ss%20word'));
    const creds = resolveClientCredentials(req, {});
    expect(creds).toEqual({ clientId: 'cl@x', clientSecret: 'p@ss word' });
  });

  it('client_secret 含冒号时按首个冒号切分', () => {
    const req = reqWithBasic(basicOf('portal', 'se:cret'));
    const creds = resolveClientCredentials(req, {});
    expect(creds.clientSecret).toBe('se:cret');
  });

  it('无 Basic 头时回退请求体字段（client_secret_post）', () => {
    const req = new Request('http://localhost:4100/api/auth/oauth2/token');
    const creds = resolveClientCredentials(req, { client_id: 'portal', client_secret: 'pw' });
    expect(creds).toEqual({ clientId: 'portal', clientSecret: 'pw' });
  });

  it('Basic 与 body 的 client_id 冲突时拒绝（凭证混淆）', () => {
    const req = reqWithBasic(basicOf('portal', 'pw'));
    expect(() => resolveClientCredentials(req, { client_id: 'other' })).toThrow(InvalidClientError);
  });

  it('Basic 与 body 的 client_secret 冲突时拒绝（凭证混淆）', () => {
    const req = reqWithBasic(basicOf('portal', 'pw1'));
    expect(() =>
      resolveClientCredentials(req, { client_id: 'portal', client_secret: 'pw2' }),
    ).toThrow(InvalidClientError);
  });

  it('Basic 与 body 一致时放行（客户端冗余携带不视为攻击）', () => {
    const req = reqWithBasic(basicOf('portal', 'pw'));
    const creds = resolveClientCredentials(req, { client_id: 'portal', client_secret: 'pw' });
    expect(creds.clientId).toBe('portal');
  });

  it('Basic 凭证缺少冒号分隔符时拒绝', () => {
    const req = reqWithBasic(Buffer.from('no-colon').toString('base64'));
    expect(() => resolveClientCredentials(req, {})).toThrow(InvalidClientError);
  });

  it('Basic 头 urlencoded 畸形时拒绝', () => {
    const req = reqWithBasic(basicOf('%zz', 'pw'));
    expect(() => resolveClientCredentials(req, {})).toThrow(InvalidClientError);
  });

  it('双通道均无凭证时拒绝', () => {
    const req = new Request('http://localhost:4100/api/auth/oauth2/token');
    expect(() => resolveClientCredentials(req, {})).toThrow(InvalidClientError);
  });

  it('非 Basic 的 Authorization 头被忽略，回退 body', () => {
    const req = new Request('http://localhost:4100/api/auth/oauth2/token', {
      headers: { authorization: 'Bearer something' },
    });
    const creds = resolveClientCredentials(req, { client_id: 'portal' });
    expect(creds.clientId).toBe('portal');
  });
});

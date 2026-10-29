/**
 * Proxy CSRF 纵深：跨站无 Origin 请求必须由 Sec-Fetch-Site 拦截。
 *
 * @req H-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '@/proxy';

function request(method: string, headers: Record<string, string>) {
  return new NextRequest('https://127.0.0.1:19443/api/users/00000000-0000-4000-8000-000000000001/roles', {
    method,
    headers,
  });
}

describe('proxy CSRF 纵深', () => {
  it('POST + Sec-Fetch-Site: cross-site + 无 Origin → 403', async () => {
    const res = await proxy(request('POST', { 'sec-fetch-site': 'cross-site' }));
    expect(res.status).toBe(403);
  });

  it('POST + same-origin（无 Origin）→ 放行到鉴权层', async () => {
    const res = await proxy(request('POST', { 'sec-fetch-site': 'same-origin' }));
    expect(res.status).not.toBe(403);
  });

  it('GET + cross-site → 不按 CSRF 拦截', async () => {
    const res = await proxy(request('GET', { 'sec-fetch-site': 'cross-site' }));
    expect(res.status).not.toBe(403);
  });
});

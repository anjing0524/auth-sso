/**
 * 登录 API 单元测试 (POST /api/auth/login)
 *
 * @req H-AUTH-002, H-AUTH-006, DC-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const holder = vi.hoisted<{
  mockSignLoginSession: ReturnType<typeof vi.fn>;
  mockVerifyPassword: ReturnType<typeof vi.fn>;
  mockValidateLoginCredentials: ReturnType<typeof vi.fn>;
  mockCheckBruteForce: ReturnType<typeof vi.fn>;
  mockIncrementBruteForce: ReturnType<typeof vi.fn>;
  mockClearBruteForceCounter: ReturnType<typeof vi.fn>;
  mockMapDomainError: ReturnType<typeof vi.fn>;
  mockDb: any;
  state: { dbRows: any[] };
}>(() => {
  const state = { dbRows: [] as any[] };

  const createChain = () => {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(state.dbRows);
    chain.catch = () => ({ then: (r: Function) => r([]) });
    return new Proxy(chain, {
      get(t: any, prop: string) {
        if (prop === 'then' || prop === 'catch') return t[prop];
        return () => createChain();
      },
    });
  };

  const mockUpdateWhere: any = () => {};
  mockUpdateWhere.catch = (fn: Function) => { fn(null); return mockUpdateWhere; };

  const mockDb = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'select') return () => createChain();
      if (prop === 'update') return () => ({ set: () => ({ where: () => mockUpdateWhere }) });
      return undefined;
    },
  });

  return {
    mockSignLoginSession: vi.fn(),
    mockVerifyPassword: vi.fn(),
    mockValidateLoginCredentials: vi.fn(),
    mockCheckBruteForce: vi.fn(),
    mockIncrementBruteForce: vi.fn(),
    mockClearBruteForceCounter: vi.fn(),
    mockMapDomainError: vi.fn(),
    mockDb,
    state,
  };
});

vi.mock('@/infrastructure/db', () => ({ db: holder.mockDb, schema: { users: {} } }));

vi.mock('@/domain/auth/login', () => ({
  validateLoginCredentials: holder.mockValidateLoginCredentials,
}));

vi.mock('@/domain/auth/password', () => ({
  verifyPassword: holder.mockVerifyPassword,
}));

vi.mock('@/domain/auth/brute-force', () => ({
  checkBruteForce: holder.mockCheckBruteForce,
  incrementBruteForce: holder.mockIncrementBruteForce,
  clearBruteForceCounter: holder.mockClearBruteForceCounter,
}));

vi.mock('@/lib/auth/token', () => ({
  signLoginSession: holder.mockSignLoginSession,
  LOGIN_SESSION_TTL: 300,
}));

vi.mock('@/domain/shared/error-mapping', () => ({
  mapDomainError: holder.mockMapDomainError,
}));

vi.mock('@auth-sso/contracts', () => ({
  COOKIE_NAMES: { LOGIN_SESSION: 'login_session' },
}));

import { POST } from '@/app/api/auth/login/route';

function buildLoginRequest(body: any): any {
  return new Request('http://localhost:4100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holder.state.dbRows = [];
  holder.mockCheckBruteForce.mockResolvedValue({ locked: false, message: '' });
  holder.mockValidateLoginCredentials.mockImplementation(() => {});
  holder.mockVerifyPassword.mockResolvedValue(true);
  holder.mockSignLoginSession.mockResolvedValue('mock-login-session-jwt');
  holder.mockMapDomainError.mockImplementation((err: any) => {
    if (err?.status && err?.message) {
      return { status: err.status, error: err.code || 'ERROR', message: err.message };
    }
    return { status: 500, error: 'INTERNAL_ERROR', message: err?.message || 'Internal Error' };
  });
});

describe('POST /api/auth/login', () => {
  it('缺少 email 字段时返回 400 并包含 success:false', async () => {
    const res = await POST(buildLoginRequest({ password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('VALIDATION_ERROR');
    expect(json.message).toBeDefined();
  });

  it('无效 email 格式时返回 400', async () => {
    const res = await POST(buildLoginRequest({ email: 'not-an-email', password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('用户不存在时返回 401（防枚举，不泄露是否存在）', async () => {
    holder.mockMapDomainError.mockReturnValueOnce({
      status: 401, error: 'AUTH_SSO_2002', message: '邮箱或密码错误',
    });
    const res = await POST(buildLoginRequest({ email: 'notfound@example.com', password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(json.message).not.toMatch(/不存在/i);
  });

  it('密码错误时返回 401，并增加暴力破解计数', async () => {
    holder.state.dbRows = [{ id: 'u1', email: 'user@example.com', passwordHash: '$2b$...', status: 'ACTIVE' }];
    holder.mockVerifyPassword.mockResolvedValueOnce(false);
    holder.mockMapDomainError.mockReturnValueOnce({
      status: 401, error: 'AUTH_SSO_2002', message: '邮箱或密码错误',
    });

    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'wrong' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(holder.mockIncrementBruteForce).toHaveBeenCalledWith('u1');
  });

  it('登录成功时返回 200、设置 Cookie、清除暴力破解计数', async () => {
    holder.state.dbRows = [{ id: 'u1', email: 'user@example.com', passwordHash: '$2b$...', status: 'ACTIVE' }];
    holder.mockVerifyPassword.mockResolvedValueOnce(true);

    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'correct' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(holder.mockSignLoginSession).toHaveBeenCalledWith('u1');
    expect(res.cookies.get('login_session')?.value).toBe('mock-login-session-jwt');
    expect(holder.mockClearBruteForceCounter).toHaveBeenCalledWith('u1');
  });

  it('暴力破解锁定后返回 423，不尝试验证密码', async () => {
    holder.state.dbRows = [{ id: 'u1', email: 'locked@example.com', passwordHash: '$2b$...', status: 'ACTIVE' }];
    holder.mockCheckBruteForce.mockResolvedValueOnce({
      locked: true, message: '登录失败次数过多，账户已临时锁定',
    });

    const res = await POST(buildLoginRequest({ email: 'locked@example.com', password: 'test123' }));
    const json = await res.json();

    expect(res.status).toBe(423);
    expect(json.success).toBe(false);
    expect(holder.mockVerifyPassword).not.toHaveBeenCalled();
  });
});

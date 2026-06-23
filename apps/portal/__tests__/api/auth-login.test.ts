/**
 * 登录 API 单元测试 (POST /api/auth/login)
 *
 * 覆盖范围：
 * - Zod 校验失败 → 400
 * - 用户不存在 → EntityNotFoundError
 * - 密码错误 → BusinessRuleViolationError
 * - 登录成功 → 200 + Cookie
 *
 * @req AUTH-001, AUTH-002
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// =========================================
// Mock 基础设施（vi.hoisted 共享状态 — 所有 mock 在同一个闭包中）
// =========================================
const {
  mockSignLoginSession,
  mockVerifyPassword,
  mockValidateLoginCredentials,
  mockMapDomainError,
  mockDb,
  setDbRows,
  resetDb,
} = vi.hoisted(() => {
  const state: { dbRows: any[] } = { dbRows: [] };

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

  const mockDb = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'select') return () => createChain();
      if (prop === 'update') {
        return () => ({
          set: () => ({
            where: () => {
              const c: any = () => {};
              c.catch = () => c;
              return c;
            },
          }),
        });
      }
      return undefined;
    },
  });

  return {
    mockSignLoginSession: vi.fn(),
    mockVerifyPassword: vi.fn(),
    mockValidateLoginCredentials: vi.fn(),
    mockMapDomainError: vi.fn(),
    mockDb,
    setDbRows(r: any[]) {
      state.dbRows = r;
    },
    resetDb() {
      state.dbRows = [];
    },
  };
});

vi.mock('@/infrastructure/db', () => ({
  db: mockDb,
  schema: { users: {} },
}));

vi.mock('@/domain/auth/login', () => ({
  validateLoginCredentials: mockValidateLoginCredentials,
}));

vi.mock('@/domain/auth/password', () => ({
  verifyPassword: mockVerifyPassword,
}));

vi.mock('@/lib/auth/token', () => ({
  signLoginSession: mockSignLoginSession,
  LOGIN_SESSION_TTL: 300,
}));

vi.mock('@/domain/shared/error-mapping', () => ({
  mapDomainError: mockMapDomainError,
}));

vi.mock('@auth-sso/contracts', () => ({
  COOKIE_NAMES: { LOGIN_SESSION: 'login_session' },
}));

import { POST } from '@/app/api/auth/login/route';

// 辅助函数
function buildLoginRequest(body: any): any {
  return new Request('http://localhost:4100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDb();
  // mapDomainError 默认透传
  mockMapDomainError.mockImplementation((err: any) => {
    if (err?.status && err?.message) {
      return { status: err.status, error: err.code || 'ERROR', message: err.message };
    }
    return { status: 500, error: 'INTERNAL_ERROR', message: err?.message || 'Internal Error' };
  });
});

describe('POST /api/auth/login', () => {
  it('缺少 email 字段时返回 400', async () => {
    const req = buildLoginRequest({ password: 'test123' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toBe('VALIDATION_ERROR');
  });

  it('无效 email 格式时返回 400', async () => {
    const req = buildLoginRequest({ email: 'not-an-email', password: 'test123' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('缺少密码字段时返回 400', async () => {
    const req = buildLoginRequest({ email: 'test@example.com' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json.success).toBe(false);
  });

  it('用户不存在时返回域错误', async () => {
    setDbRows([]);
    mockValidateLoginCredentials.mockImplementation(() => {});
    mockMapDomainError.mockReturnValueOnce({
      status: 404,
      error: 'ENTITY_NOT_FOUND',
      message: 'User not found',
    });

    const req = buildLoginRequest({ email: 'notfound@example.com', password: 'test123' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(404);
    expect(json.success).toBe(false);
  });

  it('密码错误时返回 401', async () => {
    setDbRows([{ id: 'u1', email: 'user@example.com', passwordHash: '$2b$...', status: 'ACTIVE' }]);
    mockValidateLoginCredentials.mockImplementation(() => {});
    mockVerifyPassword.mockResolvedValueOnce(false);
    mockMapDomainError.mockReturnValueOnce({
      status: 401,
      error: 'BUSINESS_RULE_VIOLATION',
      message: '邮箱或密码错误',
    });

    const req = buildLoginRequest({ email: 'user@example.com', password: 'wrong' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json.success).toBe(false);
    expect(mockVerifyPassword).toHaveBeenCalled();
  });

  it('登录成功时返回 200 并设置 Cookie', async () => {
    setDbRows([{ id: 'u1', email: 'user@example.com', passwordHash: '$2b$...', status: 'ACTIVE' }]);
    mockValidateLoginCredentials.mockImplementation(() => {});
    mockVerifyPassword.mockResolvedValueOnce(true);
    mockSignLoginSession.mockResolvedValueOnce('mock-login-session-jwt');

    const req = buildLoginRequest({ email: 'user@example.com', password: 'correct' });
    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.success).toBe(true);
    expect(mockSignLoginSession).toHaveBeenCalled();
    expect(res.cookies.get('login_session')?.value).toBe('mock-login-session-jwt');
  });
});

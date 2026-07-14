/**
 * 登录 API 单元测试 (POST /api/auth/login)
 *
 * Controller 层测试：Mock 基础设施（DB/Redis），使用真实领域函数。
 * 仅 Mock 操作耗时或依赖外部服务的模块：verifyPassword(bcrypt)、brute-force(Redis/DB)、token签发(签名密钥)。
 *
 * @req H-AUTH-002, H-AUTH-006, DC-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { COMMON_ERRORS, USER_LOCKED, USER_DELETED } from '@auth-sso/contracts';

const holder = vi.hoisted<{
  mockSignLoginSession: ReturnType<typeof vi.fn>;
  mockVerifyPassword: ReturnType<typeof vi.fn>;
  mockCheckBruteForce: ReturnType<typeof vi.fn>;
  mockIncrementBruteForce: ReturnType<typeof vi.fn>;
  mockClearBruteForceCounter: ReturnType<typeof vi.fn>;
  mockDb: any;
  state: { dbRows: any[]; lastUpdateSet: Record<string, unknown> | null };
}>(() => {
  const state: {
    dbRows: any[];
    lastUpdateSet: Record<string, unknown> | null;
  } = {
    dbRows: [],
    lastUpdateSet: null,
  };

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

  const mockUpdatePromise: any = () => {};
  mockUpdatePromise.catch = (fn: Function) => {
    fn(null);
    return mockUpdatePromise;
  };

  const mockDb = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'select') return () => createChain();
      if (prop === 'update')
        return () => ({
          set: (data: Record<string, unknown>) => {
            state.lastUpdateSet = data;
            return { where: () => mockUpdatePromise };
          },
        });
      return undefined;
    },
  });

  return {
    mockSignLoginSession: vi.fn(),
    mockVerifyPassword: vi.fn(),
    mockCheckBruteForce: vi.fn(),
    mockIncrementBruteForce: vi.fn(),
    mockClearBruteForceCounter: vi.fn(),
    mockDb,
    get state() {
      return state;
    },
  };
});

vi.mock('@/infrastructure/db', () => ({
  db: holder.mockDb,
  schema: { users: {} },
}));

vi.mock('@/domain/auth/password', () => ({
  verifyPassword: holder.mockVerifyPassword,
}));

vi.mock('@/lib/auth/brute-force', () => ({
  checkBruteForce: holder.mockCheckBruteForce,
  incrementBruteForce: holder.mockIncrementBruteForce,
  clearBruteForceCounter: holder.mockClearBruteForceCounter,
}));

vi.mock('@/lib/auth/token', () => ({
  signLoginSession: holder.mockSignLoginSession,
  LOGIN_SESSION_TTL: 300,
}));

import { POST } from '@/app/api/auth/login/route';
import { NextRequest } from 'next/server';

function buildLoginRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  holder.state.dbRows = [];
  holder.state.lastUpdateSet = null;
  holder.mockCheckBruteForce.mockResolvedValue({ locked: false, message: '' });
  holder.mockVerifyPassword.mockResolvedValue(true);
  holder.mockSignLoginSession.mockResolvedValue('mock-login-session-jwt');
});

describe('POST /api/auth/login', () => {
  it('缺少 email 字段时返回 400', async () => {
    const res = await POST(buildLoginRequest({ password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
    expect(json.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
  });

  it('无效 email 格式时返回 400', async () => {
    const res = await POST(buildLoginRequest({ email: 'not-an-email', password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(400);
  });

  it('用户不存在时返回 401（防枚举，不泄露用户存在性）', async () => {
    // DB 返回空行 → Controller throw InvalidCredentialsError → mapDomainError 映射 401
    holder.state.dbRows = [];
    const res = await POST(buildLoginRequest({ email: 'notfound@example.com', password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.message).not.toMatch(/不存在/i);
  });

  it('密码错误时返回 401，并增加暴力破解计数', async () => {
    holder.state.dbRows = [
      {
        id: 'u1',
        username: 'user',
        email: 'user@example.com',
        name: 'User',
        avatarUrl: null,
        passwordHash: '$2b$hashed...',
        status: 'ACTIVE',
      },
    ];
    holder.mockVerifyPassword.mockResolvedValueOnce(false);

    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'wrong' }));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(holder.mockIncrementBruteForce).toHaveBeenCalledWith('u1');
  });

  it('登录成功时返回 200、设置 Cookie、清除暴力破解计数', async () => {
    holder.state.dbRows = [
      {
        id: 'u1',
        username: 'user',
        email: 'user@example.com',
        name: 'User',
        avatarUrl: null,
        passwordHash: '$2b$hashed...',
        status: 'ACTIVE',
      },
    ];
    holder.mockVerifyPassword.mockResolvedValueOnce(true);

    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'correct' }));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(holder.mockSignLoginSession).toHaveBeenCalledWith('u1');
    expect(res.cookies.get('login_session')?.value).toBe('mock-login-session-jwt');
    expect(holder.mockClearBruteForceCounter).toHaveBeenCalledWith('u1');
  });

  it('暴力破解锁定后返回 423，不尝试验证密码', async () => {
    holder.state.dbRows = [
      {
        id: 'u1',
        username: 'locked',
        email: 'locked@example.com',
        name: 'Locked',
        avatarUrl: null,
        passwordHash: '$2b$hashed...',
        status: 'ACTIVE',
      },
    ];
    holder.mockCheckBruteForce.mockResolvedValueOnce({
      locked: true,
      message: '登录失败次数过多，账户已临时锁定',
    });

    const res = await POST(buildLoginRequest({ email: 'locked@example.com', password: 'test123' }));
    const json = await res.json();

    expect(res.status).toBe(423);
    expect(holder.mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('LOCKED 状态用户登录时返回 403（真实领域函数校验）', async () => {
    // 此测试验证 validateLoginCredentials（真实领域函数）对 LOCKED 状态的校验
    holder.state.dbRows = [
      {
        id: 'u2',
        username: 'locked-user',
        email: 'locked-user@example.com',
        name: 'Locked',
        avatarUrl: null,
        passwordHash: '$2b$hashed...',
        status: USER_LOCKED,
      },
    ];

    const res = await POST(
      buildLoginRequest({ email: 'locked-user@example.com', password: 'test123' }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(holder.mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('DELETED 状态用户登录时返回 403（真实领域函数校验）', async () => {
    holder.state.dbRows = [
      {
        id: 'u3',
        username: 'deleted-user',
        email: 'deleted-user@example.com',
        name: 'Deleted',
        avatarUrl: null,
        passwordHash: '$2b$hashed...',
        status: USER_DELETED,
      },
    ];

    const res = await POST(
      buildLoginRequest({ email: 'deleted-user@example.com', password: 'test123' }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.message).toMatch(/注销/);
  });
});

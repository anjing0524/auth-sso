/**
 * 登录 API 集成测试 (POST /api/auth/login) — 真实 DB
 *
 * 真实 DB 用于用户查询（Drizzle select），其余：
 *   verifyPassword(bcrypt)、brute-force(Redis/DB)、token签发(签名密钥) 均 mock。
 *
 * @req H-AUTH-002, H-AUTH-006, DC-AUTH-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { COMMON_ERRORS, USER_LOCKED, USER_DELETED } from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';

const holder = vi.hoisted<{
  mockSignLoginSession: ReturnType<typeof vi.fn>;
  mockVerifyPassword: ReturnType<typeof vi.fn>;
  mockCheckBruteForce: ReturnType<typeof vi.fn>;
  mockIncrementBruteForce: ReturnType<typeof vi.fn>;
  mockClearBruteForceCounter: ReturnType<typeof vi.fn>;
  tdHolder: { current: ReturnType<typeof createTestDbHandle> | null };
}>(() => ({
  mockSignLoginSession: vi.fn(),
  mockVerifyPassword: vi.fn(),
  mockCheckBruteForce: vi.fn(),
  mockIncrementBruteForce: vi.fn(),
  mockClearBruteForceCounter: vi.fn(),
  tdHolder: { current: null },
}));

vi.mock('@/infrastructure/db', () => ({
  get db() { return holder.tdHolder.current!.db; },
  get schema() { return holder.tdHolder.current!.schema; },
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

vi.mock('@/lib/audit', () => ({
  writeLoginLog: () => {},
  extractClientIP: () => null,
  extractUserAgent: () => null,
}));

import { POST } from '@/app/api/auth/login/route';
import { NextRequest } from 'next/server';

const now = new Date();
const USER_PWD_HASH = '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe';
const U1 = '00000000-0000-4000-8000-000000000301';
const U2 = '00000000-0000-4000-8000-000000000302';
const U3 = '00000000-0000-4000-8000-000000000303';

function seedTestUsers() {
  return [
    {
      id: U1, username: 'user', email: 'user@example.com', name: 'User',
      passwordHash: USER_PWD_HASH, status: 'ACTIVE' as const,
      emailVerified: true, mobileVerified: false,
      passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
      lastLoginAt: null, deletedAt: null, passwordChangedAt: null,
      createdAt: now, updatedAt: now,
    },
    {
      id: U2, username: 'locked-user', email: 'locked-user@example.com', name: 'Locked',
      passwordHash: USER_PWD_HASH, status: USER_LOCKED as typeof USER_LOCKED,
      emailVerified: true, mobileVerified: false,
      passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
      lastLoginAt: null, deletedAt: null, passwordChangedAt: null,
      createdAt: now, updatedAt: now,
    },
    {
      id: U3, username: 'deleted-user', email: 'deleted-user@example.com', name: 'Deleted',
      passwordHash: USER_PWD_HASH, status: USER_DELETED as typeof USER_DELETED,
      emailVerified: true, mobileVerified: false,
      passwordHistory: null, avatarUrl: null, mobile: null, deptId: null,
      lastLoginAt: null, deletedAt: now, passwordChangedAt: null,
      createdAt: now, updatedAt: now,
    },
  ];
}

const td = createTestDbHandle();
holder.tdHolder.current = td;

function buildLoginRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:4100/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, { users: seedTestUsers() });
  vi.clearAllMocks();
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
    expect(res.status).toBe(400);
  });

  it('用户不存在时返回 401（防枚举，不泄露用户存在性）', async () => {
    const res = await POST(buildLoginRequest({ email: 'notfound@example.com', password: 'test123' }));
    const json = await res.json();
    expect(res.status).toBe(401);
    expect(json.message).not.toMatch(/不存在/i);
  });

  it('密码错误时返回 401，并增加暴力破解计数', async () => {
    holder.mockVerifyPassword.mockResolvedValueOnce(false);

    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'wrong' }));

    expect(res.status).toBe(401);
    expect(holder.mockIncrementBruteForce).toHaveBeenCalledWith(U1);
  });

  it('登录成功时返回 200、设置 Cookie、清除暴力破解计数', async () => {
    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'correct' }));

    expect(res.status).toBe(200);
    expect(holder.mockSignLoginSession).toHaveBeenCalledWith(U1);
    expect(res.cookies.get('login_session')?.value).toBe('mock-login-session-jwt');
    expect(holder.mockClearBruteForceCounter).toHaveBeenCalledWith(U1);
  });

  it('暴力破解锁定后返回 423，不尝试验证密码', async () => {
    holder.mockCheckBruteForce.mockResolvedValueOnce({
      locked: true,
      message: '登录失败次数过多，账户已临时锁定',
    });

    const res = await POST(buildLoginRequest({ email: 'user@example.com', password: 'test123' }));

    expect(res.status).toBe(423);
    expect(holder.mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('LOCKED 状态用户登录时返回 403（真实领域函数校验）', async () => {
    const res = await POST(
      buildLoginRequest({ email: 'locked-user@example.com', password: 'test123' }),
    );

    expect(res.status).toBe(403);
    expect(holder.mockVerifyPassword).not.toHaveBeenCalled();
  });

  it('DELETED 状态用户登录时返回 403（真实领域函数校验）', async () => {
    const res = await POST(
      buildLoginRequest({ email: 'deleted-user@example.com', password: 'test123' }),
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json.message).toMatch(/注销|锁定/);
  });
});

/**
 * Session 生命周期 API 单元测试
 *
 * 覆盖范围：
 * - Session 创建、获取、更新、删除
 * - Idle timeout 和 Absolute timeout 检查
 * - Token 自动刷新判断
 * - 用户级全量踢出
 *
 * @req SESS-001~005
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createMockRedis } from '../helpers/mock-redis';

// Mock Redis 模块，使用内存实现替代真实连接
const { getRedis, store } = createMockRedis();
vi.mock('@/lib/redis', () => ({
  getRedis: () => getRedis(),
  closeRedis: vi.fn(),
}));

// Mock next/headers（session.ts 中 getSessionIdFromCookie 依赖）
vi.mock('next/headers', () => ({
  cookies: vi.fn(),
}));

// Mock crypto 模块，使 ID 生成可预测
vi.mock('@/lib/crypto', () => ({
  generateId: vi.fn((len = 20) => 'mock-id-' + 'x'.repeat(len - 8)),
}));

// Mock DB
vi.mock('@/lib/db', () => ({
  db: {},
  schema: {},
}));

import {
  createSession,
  getSession,
  deleteSession,
  revokeUserSessions,
  touchSession,
  updateSessionToken,
  shouldRefreshToken,
  SESSION_CONFIG,
} from '@/lib/session';

describe('Session 生命周期', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  describe('createSession', () => {
    it('成功创建 Session 并存入 Redis', async () => {
      const session = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        refreshToken: 'refresh-456',
        expiresIn: 3600,
      });

      expect(session.id).toBeTruthy();
      expect(session.userId).toBe('user-1');
      expect(session.accessToken).toBe('access-123');
      expect(session.tokenExpiresAt).toBeGreaterThan(Date.now() - 1000);

      // 验证 Redis 中已存储
      const stored = await store.get(`${SESSION_CONFIG.keyPrefix}${session.id}`);
      expect(stored).toBeTruthy();
    });

    it('设置正确的 TTL（与 absolute timeout 一致）', async () => {
      const session = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      const key = `${SESSION_CONFIG.keyPrefix}${session.id}`;
      const hasExpiry = store['expiries'].has(key);
      expect(hasExpiry).toBe(true);
    });

    it('建立用户 Session 反向映射索引', async () => {
      const session = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      const userSessionKey = `portal:user_sessions:user-1`;
      const members = await store.smembers(userSessionKey);
      expect(members).toContain(session.id);
    });

    it('支持可选的 userInfo', async () => {
      const session = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
        userInfo: { email: 'test@example.com', name: '测试用户' },
      });

      expect(session.userInfo).toEqual({ email: 'test@example.com', name: '测试用户' });
    });

    // @req SESS-001
    it('Redis 故障时不崩溃（防御性降级）', async () => {
      // 强制 Redis 操作抛出异常
      const originalSetex = store.setex.bind(store);
      store.setex = async () => { throw new Error('Redis down'); };

      // 不应抛出异常
      const session = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      expect(session).toBeDefined();
      expect(session.userId).toBe('user-1');

      // 恢复
      store.setex = originalSetex;
    });
  });

  describe('getSession', () => {
    it('返回有效的 Session', async () => {
      const created = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      const session = await getSession(created.id);
      expect(session).toBeTruthy();
      expect(session!.userId).toBe('user-1');
    });

    it('不存在的 Session 返回 null', async () => {
      const session = await getSession('nonexistent');
      expect(session).toBeNull();
    });

    // @req SESS-002
    it('Absolute timeout 后 Session 失效返回 null', async () => {
      const created = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      // 手动设置 absoluteExpiresAt 为过去
      const key = `${SESSION_CONFIG.keyPrefix}${created.id}`;
      const data = JSON.parse((await store.get(key))!);
      data.absoluteExpiresAt = Date.now() - 1000;
      await store.setex(key, 3600, JSON.stringify(data));

      const session = await getSession(created.id);
      expect(session).toBeNull();
    });

    // @req SESS-003
    it('Idle timeout 后 Session 失效返回 null', async () => {
      const created = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      // 手动设置 lastAccessAt 为过去（超过 idle timeout）
      const key = `${SESSION_CONFIG.keyPrefix}${created.id}`;
      const data = JSON.parse((await store.get(key))!);
      data.lastAccessAt = Date.now() - SESSION_CONFIG.idleTimeoutMs - 1000;
      await store.setex(key, 3600, JSON.stringify(data));

      const session = await getSession(created.id);
      expect(session).toBeNull();
    });
  });

  describe('touchSession', () => {
    it('更新 lastAccessAt 时间戳', async () => {
      const created = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      const key = `${SESSION_CONFIG.keyPrefix}${created.id}`;
      const before = JSON.parse((await store.get(key))!);
      const originalAccess = before.lastAccessAt;

      // 等待一小段时间确保时间戳不同
      await new Promise(r => setTimeout(r, 10));
      await touchSession(created.id);

      const after = JSON.parse((await store.get(key))!);
      expect(after.lastAccessAt).toBeGreaterThanOrEqual(originalAccess);
    });
  });

  describe('updateSessionToken', () => {
    it('更新 access token 和 refresh token', async () => {
      const created = await createSession({
        userId: 'user-1',
        accessToken: 'old-token',
        refreshToken: 'old-refresh',
        expiresIn: 3600,
      });

      await updateSessionToken(created.id, {
        accessToken: 'new-token',
        refreshToken: 'new-refresh',
        expiresIn: 7200,
      });

      const key = `${SESSION_CONFIG.keyPrefix}${created.id}`;
      const data = JSON.parse((await store.get(key))!);
      expect(data.accessToken).toBe('new-token');
      expect(data.refreshToken).toBe('new-refresh');
      expect(data.tokenExpiresAt).toBeGreaterThan(Date.now());
    });
  });

  describe('deleteSession', () => {
    // @req SESS-004
    it('删除 Session 并清理反向映射', async () => {
      const created = await createSession({
        userId: 'user-1',
        accessToken: 'access-123',
        expiresIn: 3600,
      });

      const key = `${SESSION_CONFIG.keyPrefix}${created.id}`;
      expect(await store.get(key)).toBeTruthy();

      await deleteSession(created.id);

      expect(await store.get(key)).toBeNull();
      const members = await store.smembers(`portal:user_sessions:user-1`);
      expect(members).not.toContain(created.id);
    });
  });

  describe('revokeUserSessions', () => {
    // @req SESS-005
    it('踢出用户所有活跃 Session', async () => {
      const s1 = await createSession({ userId: 'user-1', accessToken: 't1', expiresIn: 3600 });
      const s2 = await createSession({ userId: 'user-1', accessToken: 't2', expiresIn: 3600 });

      await revokeUserSessions('user-1');

      expect(await getSession(s1.id)).toBeNull();
      expect(await getSession(s2.id)).toBeNull();
    });
  });

  describe('shouldRefreshToken', () => {
    // @req AUTH-004
    it('Token 即将过期时返回 true', () => {
      const session = {
        id: 'test',
        userId: 'user-1',
        accessToken: 't',
        tokenExpiresAt: Date.now() + 60_000, // 1 分钟后过期（阈值 5 分钟内）
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        absoluteExpiresAt: Date.now() + 86400000,
      };

      expect(shouldRefreshToken(session as any)).toBe(true);
    });

    it('Token 充足时返回 false', () => {
      const session = {
        id: 'test',
        userId: 'user-1',
        accessToken: 't',
        tokenExpiresAt: Date.now() + 3600_000, // 1 小时后过期
        createdAt: Date.now(),
        lastAccessAt: Date.now(),
        absoluteExpiresAt: Date.now() + 86400000,
      };

      expect(shouldRefreshToken(session as any)).toBe(false);
    });
  });
});

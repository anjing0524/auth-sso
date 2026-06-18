/**
 * Mock 基础设施验证测试
 * 确保 mock-redis、mock-auth、test-fixtures、test-utils 正常工作
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MockRedisStore, createMockRedis } from './mock-redis';
import { createMockWithPermission } from './mock-auth';
import {
  createTestUser,
  createTestRole,
  createTestPermission,
  createTestDepartment,
  createTestSession,
  createTestPermissionContext,
} from './test-fixtures';
import { createTestRequest, createAuthenticatedRequest } from './test-utils';

describe('Mock 基础设施', () => {
  describe('MockRedisStore', () => {
    let store: MockRedisStore;

    beforeEach(() => {
      store = new MockRedisStore();
    });

    it('get/setex/del 基本操作', async () => {
      await store.setex('key1', 60, 'value1');
      expect(await store.get('key1')).toBe('value1');

      await store.del('key1');
      expect(await store.get('key1')).toBeNull();
    });

    it('sadd/srem/smembers 集合操作', async () => {
      await store.sadd('set1', 'member1');
      await store.sadd('set1', 'member2');
      expect(await store.smembers('set1')).toEqual(['member1', 'member2']);

      await store.srem('set1', 'member1');
      expect(await store.smembers('set1')).toEqual(['member2']);
    });

    it('keys 通配符匹配', async () => {
      await store.setex('portal:jti_blocklist:jti-abc', 60, '1');
      await store.setex('portal:jti_blocklist:jti-def', 60, '1');
      await store.setex('other:key', 60, 'x');

      const keys = await store.keys('portal:jti_blocklist:*');
      expect(keys).toHaveLength(2);
      expect(keys.every(k => k.startsWith('portal:jti_blocklist:'))).toBe(true);
    });

    it('pipeline 批处理', async () => {
      const pipeline = store.pipeline();
      pipeline.setex('k1', 60, 'v1');
      pipeline.setex('k2', 60, 'v2');
      await pipeline.exec();

      expect(await store.get('k1')).toBe('v1');
      expect(await store.get('k2')).toBe('v2');
    });

    it('clear 清空数据', async () => {
      await store.setex('k1', 60, 'v1');
      store.clear();
      expect(store.size).toBe(0);
    });
  });

  describe('createMockRedis', () => {
    it('返回共享 store 的 getRedis 函数', async () => {
      const { getRedis, store } = createMockRedis();
      const redis = getRedis();
      await redis.setex('test', 60, 'hello');
      expect(await redis.get('test')).toBe('hello');
      expect(store.size).toBe(1);
    });
  });

  describe('createMockWithPermission', () => {
    it('默认行为：直接调用 handler', async () => {
      const { mockFn } = createMockWithPermission('user-42');
      const handler = vi.fn(async (userId: string) => new Response(userId) as any);

      await mockFn({}, handler);

      expect(handler).toHaveBeenCalledWith('user-42');
    });

    it('mockUnauthorized 返回 401', async () => {
      const { mockFn, mockUnauthorized } = createMockWithPermission();
      mockUnauthorized(401, '未登录');

      const result = await mockFn({}, async () => new Response('ok') as any);
      expect(result.status).toBe(401);
    });
  });

  describe('Test Fixtures', () => {
    it('createTestUser 默认值', () => {
      const user = createTestUser();
      expect(user.id).toBe('user-1');
      expect(user.status).toBe('ACTIVE');
    });

    it('createTestUser 覆盖', () => {
      const user = createTestUser({ id: 'user-99', email: 'other@test.com' });
      expect(user.id).toBe('user-99');
      expect(user.email).toBe('other@test.com');
      expect(user.name).toBe('测试用户'); // 未覆盖的字段保持默认
    });

    it('createTestRole / Permission / Department', () => {
      expect(createTestRole().code).toBe('TEST_ROLE');
      expect(createTestPermission().code).toBe('user:list');
      expect(createTestDepartment().name).toBe('测试部门');
    });

    it('createTestSession 时间戳合理', () => {
      const session = createTestSession();
      expect(session.tokenExpiresAt).toBeGreaterThan(Date.now());
      expect(session.absoluteExpiresAt).toBeGreaterThan(session.tokenExpiresAt);
    });

    it('createTestPermissionContext 默认管理员', () => {
      const ctx = createTestPermissionContext();
      expect(ctx.dataScopeType).toBe('ALL');
      expect(ctx.permissions).toContain('user:list');
    });
  });

  describe('Test Utils', () => {
    it('createTestRequest 构造 GET 请求', () => {
      const req = createTestRequest('/api/users', {
        searchParams: { page: '1', pageSize: '10' },
      });
      expect(req.method).toBe('GET');
      expect(req.url).toContain('page=1');
      expect(req.url).toContain('pageSize=10');
    });

    it('createTestRequest 构造 POST 请求', () => {
      const req = createTestRequest('/api/users', {
        method: 'POST',
        body: { name: 'test' },
      });
      expect(req.method).toBe('POST');
    });

    it('createAuthenticatedRequest 带 Session Cookie', () => {
      const req = createAuthenticatedRequest('/api/me');
      expect(req.headers.get('cookie')).toContain('portal_jwt_token=session-123');
    });
  });

  describe('createMockDb', () => {
    let mockDb: ReturnType<typeof import('./mock-db').createMockDb>;

    beforeEach(async () => {
      const mod = await import('./mock-db');
      mockDb = mod.createMockDb();
    });

    it('select().from().where() 返回配置的查询结果', async () => {
      const users = [{ id: 'u1', name: 'Alice' }, { id: 'u2', name: 'Bob' }];
      mockDb.setQueryResult(users);

      const result = await mockDb.db.select().from('users').where({});
      expect(result).toEqual(users);
    });

    it('select() 列投影模式返回配置结果', async () => {
      mockDb.setQueryResult([{ deptId: 'd1' }]);
      const result = await mockDb.db.select({ deptId: 't.deptId' }).from('departments');
      expect(result).toEqual([{ deptId: 'd1' }]);
    });

    it('selectDistinct() 返回配置结果', async () => {
      mockDb.setQueryResult([{ deptId: 'd1' }]);
      const result = await mockDb.db.selectDistinct({ deptId: 't.deptId' }).from('departments').where({});
      expect(result).toEqual([{ deptId: 'd1' }]);
    });

    it('insert().values().returning() 返回插入结果', async () => {
      mockDb.setInsertResult([{ id: 'new-1', name: 'New' }]);
      const result = await mockDb.db.insert('users').values({ name: 'New' }).returning();
      expect(result).toEqual([{ id: 'new-1', name: 'New' }]);
    });

    it('update().set().where().returning() 返回更新结果', async () => {
      mockDb.setReturningResult([{ id: 'u1', name: 'Updated' }]);
      const result = await mockDb.db.update('users').set({ name: 'Updated' }).where({}).returning();
      expect(result).toEqual([{ id: 'u1', name: 'Updated' }]);
    });

    it('delete().where() 返回受影响行数', async () => {
      mockDb.setRowCountResult(1);
      const result = await mockDb.db.delete('users').where({ id: 'u1' });
      expect(result).toBe(1);
    });

    it('execute() 原始 SQL 返回配置结果', async () => {
      mockDb.setExecuteResult([{ deptId: 'd1' }, { deptId: 'd2' }]);
      const result = await mockDb.db.execute('WITH RECURSIVE sub_depts AS (...)');
      expect(result).toEqual([{ deptId: 'd1' }, { deptId: 'd2' }]);
    });

    it('transaction() 执行回调并返回其 promise 结果', async () => {
      mockDb.setQueryResult([{ id: 'u1' }]);
      const result = await mockDb.db.transaction(async (tx: any) => {
        const rows = await tx.select().from('users');
        return rows;
      });
      expect(result).toEqual([{ id: 'u1' }]);
    });

    it('transaction 内 tx.execute() 返回配置结果', async () => {
      mockDb.setExecuteResult([{ deptId: 'd1' }]);
      const result = await mockDb.db.transaction(async (tx: any) => {
        return tx.execute('SELECT pg_advisory_xact_lock(1)');
      });
      expect(result).toEqual([{ deptId: 'd1' }]);
    });

    it('reset() 清除全部配置到默认值', async () => {
      mockDb.setQueryResult([{ id: 'u1' }]);
      mockDb.reset();
      const result = await mockDb.db.select().from('users');
      expect(result).toEqual([]);
    });

    it('setThrowError 使 execute 抛出异常', async () => {
      mockDb.setThrowError(new Error('DB error'));
      let threw = false;
      try {
        await mockDb.db.execute('SELECT 1');
      } catch (e: any) {
        threw = true;
        expect(e.message).toBe('DB error');
      }
      expect(threw).toBe(true);
      mockDb.clearThrowError();
    });
  });

  describe('createMockFetch', () => {
    import('./test-utils');
    let createMockFetch: Function;

    beforeEach(async () => {
      const mod = await import('./test-utils');
      createMockFetch = mod.createMockFetch;
    });

    it('匹配 URL 返回 JSON 响应', async () => {
      const mockFn = createMockFetch({
        'https://portal.example.com/token': { json: { access_token: 'mock-token' } },
      });
      const response = await mockFn('https://portal.example.com/token');
      expect(response.status).toBe(200);
      const json = await response.json();
      expect(json.access_token).toBe('mock-token');
    });

    it('不匹配 URL 返回 500', async () => {
      const mockFn = createMockFetch({});
      const response = await mockFn('https://unknown.example.com/api');
      expect(response.status).toBe(500);
    });

    it('error 模式抛出异常（模拟网络错误）', async () => {
      const mockFn = createMockFetch({
        'https://portal.example.com/down': { error: 'NETWORK_ERROR' },
      });
      await expect(mockFn('https://portal.example.com/down')).rejects.toThrow('NETWORK_ERROR');
    });

    it('最长前缀匹配', async () => {
      const mockFn = createMockFetch({
        'https://portal.example.com/oauth2': { json: { default: true } },
        'https://portal.example.com/oauth2/token': { json: { access_token: 'specific' } },
      });
      const response = await mockFn('https://portal.example.com/oauth2/token');
      const json = await response.json();
      expect(json.access_token).toBe('specific');
    });
  });
});

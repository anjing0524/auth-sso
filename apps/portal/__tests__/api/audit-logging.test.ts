/**
 * 审计日志 API 单元测试
 *
 * @req J-LOG-001, J-LOG-002
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest } from '../helpers/test-utils';

// =========================================
// Mock 基础设施（holder 模式避免 vi.mock 提升问题）
// =========================================
const holder = vi.hoisted<{ mockDb: any; mockWithPermission: any; state: { _queryResult: any[] } }>(() => {
  const state: { _queryResult: any[] } = { _queryResult: [] };

  const createChain = () => {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(state._queryResult);
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
      if (prop === 'insert')
        return () => ({
          values: () => ({
            then: (resolve: Function) => resolve([{ id: 'log-1' }]),
          }),
        });
      if (prop === 'update')
        return () => ({
          set: () => ({
            where: () => ({ then: (resolve: Function) => resolve([1]) }),
          }),
        });
      if (prop === 'delete')
        return () => ({
          where: () => ({ then: (resolve: Function) => resolve([1]) }),
        });
      return undefined;
    },
  });

  const mockWithPermission = vi.fn(
    async (_options: any, handler: (userId: string) => Promise<Response>) =>
      handler('audit-admin'),
  );

  return {
    mockDb,
    mockWithPermission,
    get state() { return state; },
  };
});

vi.mock('@/infrastructure/db', () => ({
  db: holder.mockDb,
  schema: { auditLogs: {}, loginLogs: {} },
}));

vi.mock('@/lib/auth', () => ({
  resolveIdentity: vi.fn(async () => ({ claims: { deptIds: ['dept-1'] } })),
  logServerDataRead: vi.fn(async () => {}),
  canAccessDept: vi.fn(() => true),
  withPermission: holder.mockWithPermission,
}));

vi.mock('@/infrastructure/redis', () => ({}));
vi.mock('@/lib/session', () => ({}));

import { GET as GetAuditLogs } from '@/app/api/audit/logs/route';
import { GET as GetLoginLogs } from '@/app/api/audit/login-logs/route';

describe('Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    holder.state._queryResult = [];
  });

  describe('GET /api/audit/logs', () => {
    it('返回空日志列表，响应结构符合 ApiResponse 契约', async () => {
      const response = await GetAuditLogs(createTestRequest('/api/audit/logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
    });

    it('正确分页结构（page=1, pageSize=20）', async () => {
      holder.state._queryResult = [{ count: 2 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { page: '1', pageSize: '20' } })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(20);
    });

    it('pageSize > 100 时被钳制（防资源耗尽）', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { pageSize: '200' } })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.pagination.pageSize).toBeLessThanOrEqual(100);
      expect(body.pagination.pageSize).not.toBe(200);
    });

    it('pageSize 为负数时被钳制为最小值 1', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { pageSize: '-5' } })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination.pageSize).toBeGreaterThanOrEqual(1);
    });

    it('支持日期范围过滤（验证响应结构完整）', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', {
          searchParams: { startDate: '2026-01-01', endDate: '2026-01-31' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('过滤参数透传（验证 success + pagination）', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', {
          searchParams: { operation: 'USER_CREATE', userId: 'user-1' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.pagination).toBeDefined();
    });
  });

  describe('GET /api/audit/login-logs', () => {
    it('返回登录日志列表（success + 分页）', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetLoginLogs(createTestRequest('/api/audit/login-logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
    });

    it('eventType 过滤 + 日期范围（响应结构完整）', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetLoginLogs(
        createTestRequest('/api/audit/login-logs', {
          searchParams: { eventType: 'LOGIN_FAILED', startDate: '2026-01-01', endDate: '2026-01-31' },
        })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.success).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.pageSize).toBeGreaterThanOrEqual(1);
    });
  });
});

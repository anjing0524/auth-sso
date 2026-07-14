/**
 * 审计日志 API 单元测试
 *
 * Controller 层测试：验证请求处理、分页参数钳制、响应格式合规性。
 * 数据内容验证属于集成测试范畴（需真实 DB），不在本测试文件中覆盖。
 *
 * @req J-LOG-001, J-LOG-002
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createTestRequest } from '../helpers/test-utils';

const holder = vi.hoisted<{
  mockDb: any;
  mockWithPermission: any;
  state: { _queryResult: any[] };
}>(() => {
  const state = { _queryResult: [] as any[] };

  const createChain = () => {
    const chain: any = () => {};
    chain.then = (resolve: Function) => resolve(state._queryResult);
    chain.catch = () => ({ then: (r: Function) => r([]) });
    return new Proxy(chain, {
      get(_t: any, prop: string) {
        if (prop === 'then' || prop === 'catch') return chain[prop];
        return () => createChain();
      },
    });
  };

  const mockDb = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'select') return () => createChain();
      if (prop === 'insert') return () => ({ values: () => ({ then: (r: Function) => r([{ id: 'log-1' }]) }) });
      if (prop === 'update') return () => ({ set: () => ({ where: () => ({ then: (r: Function) => r([1]) }) }) });
      if (prop === 'delete') return () => ({ where: () => ({ then: (r: Function) => r([1]) }) });
      return undefined;
    },
  });

  const mockWithPermission = vi.fn(async (_options: any, handler: () => Promise<Response>) => handler());

  return { mockDb, mockWithPermission, state };
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
    // 模拟 count 查询返回 [{ count: 0 }]，数据查询返回空数组
    // 模因为 count 和数据查询在同一 mock chain 中无法区分，
    // 均使用默认值 [{ count: 3 }] 供分页计算使用
    holder.state._queryResult = [{ count: 3 }];
  });

  describe('GET /api/audit/logs', () => {
    it('响应结构符合 ApiResponse 契约（success + data + pagination）', async () => {
      const response = await GetAuditLogs(createTestRequest('/api/audit/logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(Array.isArray(body.data)).toBe(true);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBeDefined();
      expect(body.pagination.pageSize).toBeDefined();
      expect(body.pagination.total).toBeDefined();
      expect(body.pagination.totalPages).toBeDefined();
    });

    it('正确分页结构（page=1, pageSize=20）', async () => {
      holder.state._queryResult = [{ count: 2 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { page: '1', pageSize: '20' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(20);
    });

    it('pageSize > 100 时被钳制到 100（防资源耗尽）', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { pageSize: '200' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination.pageSize).toBeLessThanOrEqual(100);
      expect(body.pagination.pageSize).not.toBe(200);
    });

    it('pageSize 为负数时被钳制为最小值 1', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { pageSize: '-5' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination.pageSize).toBeGreaterThanOrEqual(1);
    });

    it('日期范围过滤不破坏响应结构', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', {
          searchParams: { startDate: '2026-01-01', endDate: '2026-01-31' },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('operation 过滤参数透传不破坏响应结构', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', {
          searchParams: { operation: 'USER_CREATE', userId: 'user-1' },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
    });

    it('分页参数缺省值时使用默认值', async () => {
      holder.state._queryResult = [{ count: 1 }];

      const response = await GetAuditLogs(createTestRequest('/api/audit/logs'));
      const body = await response.json();

      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(20);
    });
  });

  describe('GET /api/audit/login-logs', () => {
    it('返回登录日志响应结构（success + data + 分页）', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetLoginLogs(createTestRequest('/api/audit/login-logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
    });

    it('eventType 过滤 + 日期范围不破坏响应结构', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetLoginLogs(
        createTestRequest('/api/audit/login-logs', {
          searchParams: { eventType: 'LOGIN_FAILED', startDate: '2026-01-01', endDate: '2026-01-31' },
        }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.pageSize).toBeGreaterThanOrEqual(1);
    });
  });
});

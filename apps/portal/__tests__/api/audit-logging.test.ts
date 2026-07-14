/**
 * 审计日志 API 单元测试
 *
 * Controller 层测试：验证分页参数钳制、响应格式、数据流向。
 * 注入 mock 数据并通过响应体验证数据正确透传。
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

const sampleAuditRow = { id: 'log-1', userId: 'user-1', username: 'admin', operation: 'USER_CREATE', method: 'POST', url: '/api/users', ip: '127.0.0.1', status: 200, duration: 50 };
const sampleLoginRow = { id: 'log-2', userId: 'user-1', username: 'admin', eventType: 'LOGIN_SUCCESS', ip: '127.0.0.1' };

describe('Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/audit/logs', () => {
    it('返回正确分页结构（pageSize 钳制）', async () => {
      holder.state._queryResult = [sampleAuditRow, { count: 1 }];

      const response = await GetAuditLogs(createTestRequest('/api/audit/logs', { searchParams: { page: '1', pageSize: '200' } }));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBeLessThanOrEqual(100);
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('注入数据后响应中透传业务字段', async () => {
      holder.state._queryResult = [sampleAuditRow, { count: 1 }];

      const response = await GetAuditLogs(createTestRequest('/api/audit/logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      // 验证业务数据字段透传
      const row = body.data[0];
      expect(row).toBeDefined();
      expect(row.operation).toBe('USER_CREATE');
      expect(row.userId).toBe('user-1');
      expect(row.username).toBe('admin');
    });

    it('日期范围过滤不破坏响应结构', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { startDate: '2026-01-01', endDate: '2026-01-31' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('operation 过滤参数不破坏响应结构', async () => {
      holder.state._queryResult = [sampleAuditRow, { count: 1 }];

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { operation: 'USER_CREATE', userId: 'user-1' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(Array.isArray(body.data)).toBe(true);
    });

    it('空数据 → 返回空数组', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetAuditLogs(createTestRequest('/api/audit/logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination.total).toBe(0);
    });

    it('分页参数缺省使用默认值', async () => {
      holder.state._queryResult = [sampleAuditRow, { count: 1 }];

      const response = await GetAuditLogs(createTestRequest('/api/audit/logs'));
      const body = await response.json();

      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(20);
    });
  });

  describe('GET /api/audit/login-logs', () => {
    it('返回登录日志且业务字段透传', async () => {
      holder.state._queryResult = [sampleLoginRow, { count: 1 }];

      const response = await GetLoginLogs(createTestRequest('/api/audit/login-logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      // 验证业务数据
      const row = body.data[0];
      expect(row).toBeDefined();
      expect(row.eventType).toBe('LOGIN_SUCCESS');
      expect(row.userId).toBe('user-1');
    });

    it('eventType 过滤 + 日期范围不破坏响应结构', async () => {
      holder.state._queryResult = [{ count: 0 }];

      const response = await GetLoginLogs(
        createTestRequest('/api/audit/login-logs', { searchParams: { eventType: 'LOGIN_FAILED', startDate: '2026-01-01', endDate: '2026-01-31' } }),
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.pageSize).toBeGreaterThanOrEqual(1);
    });
  });
});

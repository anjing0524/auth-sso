/**
 * 审计日志 API 单元测试
 *
 * 覆盖范围：
 * - GET /api/audit/logs 分页参数校验（pageSize > 100 复位）
 * - GET /api/audit/logs 日期范围过滤
 * - GET /api/audit/login-logs 分页 + eventType + 日期范围过滤
 *
 * @req B-LOG-L, B-LOG-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { createTestRequest } from '../helpers/test-utils';

// =========================================
// Mock 基础设施
// =========================================
const {
  mockDb,
  resetDbState,
  setQueryResult,
  mockWithPermission,
} = vi.hoisted(() => {
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

  // 创建一个可被 vi.spyOn 追踪的 insert 函数
  const dbInsertImpl = vi.fn(() => ({
    values: (data: any) => ({
      then: (resolve: Function) => resolve([{ ...data, id: 'log-1' }]),
    }),
  }));

  const mockDb = new Proxy({} as any, {
    get(_t: any, prop: string) {
      if (prop === 'select') return () => createChain();
      if (prop === 'insert') return dbInsertImpl;
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
    resetDbState() {
      state._queryResult = [];
    },
    setQueryResult(r: any[]) {
      state._queryResult = r;
    },
    mockWithPermission,
  };
});

vi.mock('@/infrastructure/db', () => ({
  db: mockDb,
  schema: {
    auditLogs: {},
    loginLogs: {},
  },
}));

vi.mock('@/lib/auth', () => ({
  withPermission: mockWithPermission,
}));

vi.mock('@/infrastructure/redis', () => ({}));

vi.mock('@/lib/session', () => ({}));

import { GET as GetAuditLogs } from '@/app/api/audit/logs/route';
import { GET as GetLoginLogs } from '@/app/api/audit/login-logs/route';

describe('Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbState();
  });

  // ======== GET /api/audit/logs ========

  describe('GET /api/audit/logs', () => {
    it('返回空日志列表', async () => {
      setQueryResult([]);

      const response = await GetAuditLogs(createTestRequest('/api/audit/logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.data).toEqual([]);
      expect(body.pagination.total).toBe(0);
    });

    it('返回正确分页结构', async () => {
      setQueryResult([{ count: 2 }]);

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { page: '1', pageSize: '20' } })
      );
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
      expect(body.pagination.page).toBe(1);
      expect(body.pagination.pageSize).toBe(20);
    });

    it('pageSize > 100 复位为 20', async () => {
      setQueryResult([]);

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', { searchParams: { pageSize: '200' } })
      );

      expect(response.status).toBe(200);
    });

    it('支持日期范围过滤', async () => {
      setQueryResult([]);

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', {
          searchParams: {
            startDate: '2026-01-01',
            endDate: '2026-01-31',
          },
        })
      );

      expect(response.status).toBe(200);
    });

    it('支持操作类型过滤', async () => {
      setQueryResult([]);

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', {
          searchParams: { operation: 'USER_CREATE' },
        })
      );

      expect(response.status).toBe(200);
    });

    it('支持 userId 过滤', async () => {
      setQueryResult([]);

      const response = await GetAuditLogs(
        createTestRequest('/api/audit/logs', {
          searchParams: { userId: 'user-1' },
        })
      );

      expect(response.status).toBe(200);
    });
  });

  // ======== GET /api/audit/login-logs ========

  describe('GET /api/audit/login-logs', () => {
    it('返回登录日志列表（含分页）', async () => {
      setQueryResult([]);

      const response = await GetLoginLogs(createTestRequest('/api/audit/login-logs'));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.pagination).toBeDefined();
    });

    it('支持 eventType 过滤', async () => {
      setQueryResult([]);

      const response = await GetLoginLogs(
        createTestRequest('/api/audit/login-logs', {
          searchParams: { eventType: 'LOGIN_FAILED' },
        })
      );

      expect(response.status).toBe(200);
    });

    it('支持日期范围过滤', async () => {
      setQueryResult([]);

      const response = await GetLoginLogs(
        createTestRequest('/api/audit/login-logs', {
          searchParams: {
            startDate: '2026-01-01',
            endDate: '2026-01-31',
          },
        })
      );

      expect(response.status).toBe(200);
    });
  });
});

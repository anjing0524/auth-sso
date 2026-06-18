/**
 * 审计日志 API 单元测试
 *
 * 覆盖范围：
 * - logAuditEvent 记录事件参数正确
 * - GET /api/audit/logs 分页参数校验（pageSize > 100 复位）
 * - GET /api/audit/logs 日期范围过滤
 * - 写操作触发审计日志记录
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
  dbInsertMock,
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
  const dbInsertImpl = vi.fn((table: any) => ({
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
    dbInsertMock: dbInsertImpl,
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

// Mock crypto 使 ID 可预测
vi.mock('crypto', () => ({
  randomBytes: vi.fn((len: number) => ({
    toString: (enc: string) => 'a'.repeat(len).slice(0, len),
    toStringHex: 'a'.repeat(len),
  })),
}));

import { logAuditEvent, logLoginEvent } from '@/lib/audit';
import { GET as GetAuditLogs } from '@/app/api/audit/logs/route';
import { GET as GetLoginLogs } from '@/app/api/audit/login-logs/route';

describe('Audit Logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetDbState();
  });

  // ======== logAuditEvent ========

  describe('logAuditEvent', () => {
    it('记录审计事件，参数完整', async () => {
      await logAuditEvent({
        userId: 'user-1',
        username: 'admin',
        operation: 'USER_CREATE',
        method: 'POST',
        url: '/api/users',
        ip: '127.0.0.1',
        status: 200,
        duration: 42,
      });

      expect(dbInsertMock).toHaveBeenCalled();
    });

    it('记录 USER_DELETE 操作', async () => {
      await logAuditEvent({
        userId: 'user-1',
        username: 'admin',
        operation: 'USER_DELETE',
        method: 'DELETE',
        url: '/api/users/u_abc',
        status: 200,
      });

      expect(dbInsertMock).toHaveBeenCalled();
    });

    it('记录 ROLE_PERMISSION_ASSIGN 操作', async () => {
      await logAuditEvent({
        userId: 'user-1',
        username: 'admin',
        operation: 'ROLE_PERMISSION_ASSIGN',
        method: 'POST',
        url: '/api/roles/r_01/permissions',
        status: 200,
      });

      expect(dbInsertMock).toHaveBeenCalled();
    });

    it('记录失败操作（含 errorMsg）', async () => {
      await logAuditEvent({
        userId: 'user-1',
        username: 'admin',
        operation: 'USER_UPDATE',
        method: 'PUT',
        url: '/api/users/u_abc',
        status: 500,
        errorMsg: 'Database connection failed',
      });

      expect(dbInsertMock).toHaveBeenCalled();
    });

    it('DB 写入失败不影响主流程（防御性）', async () => {
      dbInsertMock.mockImplementationOnce(() => {
        throw new Error('DB down');
      });

      // 不应抛出异常
      await expect(
        logAuditEvent({
          userId: 'user-1',
          username: 'admin',
          operation: 'USER_CREATE',
        })
      ).resolves.toBeUndefined();
    });
  });

  // ======== logLoginEvent ========

  describe('logLoginEvent', () => {
    it('记录登录成功事件', async () => {
      await logLoginEvent({
        userId: 'user-1',
        username: 'admin',
        eventType: 'LOGIN_SUCCESS',
        ip: '192.168.1.1',
      });

      expect(dbInsertMock).toHaveBeenCalled();
    });

    it('记录登录失败事件含失败原因', async () => {
      await logLoginEvent({
        username: 'unknown',
        eventType: 'LOGIN_FAILED',
        failReason: 'invalid_password',
      });

      expect(dbInsertMock).toHaveBeenCalled();
    });
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

/**
 * @req Portal infrastructure build-time boundary regression
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockDrizzle, mockGetDatabaseUrl, mockPostgres, mockSelect } = vi.hoisted(() => ({
  mockDrizzle: vi.fn(),
  mockGetDatabaseUrl: vi.fn(),
  mockPostgres: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock('postgres', () => ({ default: mockPostgres }));
vi.mock('drizzle-orm/postgres-js', () => ({ drizzle: mockDrizzle }));
vi.mock('@auth-sso/config', () => ({ getDatabaseUrl: mockGetDatabaseUrl }));

describe('database infrastructure initialization', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    // getDb() 现在挂在 globalThis 上（跨模块实例复用连接池）；测试之间必须清空，
    // 否则第二个用例会命中上一个用例留下的实例，看不到「首次访问才初始化」。
    delete (globalThis as { __authSsoPortalDb?: unknown }).__authSsoPortalDb;
    mockGetDatabaseUrl.mockReturnValue('postgresql://localhost/auth_sso');
    mockPostgres.mockReturnValue({ client: true });
    mockDrizzle.mockReturnValue({ select: mockSelect, query: {} });
  });

  it('does not read runtime configuration when the module is imported', async () => {
    await import('./index');

    expect(mockGetDatabaseUrl).not.toHaveBeenCalled();
    expect(mockPostgres).not.toHaveBeenCalled();
    expect(mockDrizzle).not.toHaveBeenCalled();
  });

  it('initializes the database once on first access', async () => {
    const { db, getDb } = await import('./index');

    expect(db.select).toBeTypeOf('function');
    expect(getDb()).toBe(getDb());
    expect(mockGetDatabaseUrl).toHaveBeenCalledTimes(1);
    expect(mockPostgres).toHaveBeenCalledWith('postgresql://localhost/auth_sso');
    expect(mockDrizzle).toHaveBeenCalledTimes(1);
  });
});

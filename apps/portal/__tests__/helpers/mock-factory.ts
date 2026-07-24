/**
 * 统一 Mock 工厂 — 消除 API 测试中 ~1000 行重复 inline mock
 *
 * 采用 vi.hoisted 模式：在测试文件顶层创建 holder 对象，
 * vi.mock() 的 factory 闭包引用 holder，测试间通过 holder 切换状态。
 *
 * @vitest-environment node
 *
 * @example 标准用法
 * ```typescript
 * import { createTestDbHandle, seedTestData } from '../helpers/test-db';
 * import { createHoistedHolders } from '../helpers/mock-factory';
 * import { seedRootDept } from '../helpers/seed-fixtures';
 *
 * const holders = createHoistedHolders();
 *
 * vi.mock('@/infrastructure/db', () => ({
 *   get db() { return holders.tdHolder.current!.db; },
 *   get schema() { return holders.tdHolder.current!.schema; },
 * }));
 * vi.mock('@/lib/auth', () => ({ ...holders.mockAuth }));
 * vi.mock('@/lib/crypto', () => ({ ...holders.mockCrypto }));
 * vi.mock('@/lib/permissions', () => ({ ...holders.mockPermissions }));
 * vi.mock('@/lib/session/revoke', () => ({ ...holders.mockRevoke }));
 * vi.mock('next/cache', () => ({ ...holders.mockNextCache }));
 * vi.mock('@/infrastructure/redis', () => ({ getRedis: () => holders.redisStore }));
 *
 * const td = createTestDbHandle();
 * holders.tdHolder.current = td;
 *
 * beforeAll(async () => { await td.connect(); });
 * afterAll(async () => { await td.close(); });
 * beforeEach(async () => {
 *   await td.cleanup();
 *   await seedTestData(td.db, { departments: seedRootDept() });
 *   holders.redisStore.clear();
 * });
 * ```
 */

import { vi } from 'vitest';
import type { TestDbHandle } from './test-db';
import { MockRedisStore } from './mock-redis';

// ── 常值 ──────────────────────────────────────────────

export const DEFAULT_ADMIN_ID = '00000000-0000-4000-8000-000000000101';

// ── hoisted holders 工厂 ─────────────────────────────────

export interface HoistedHolders {
  /** TestDb 引用 holder — vi.hoisted 确保 vi.mock factory 闭包可用 */
  tdHolder: { current: TestDbHandle | null };

  /** 内存 Redis store — 用于 @/infrastructure/redis mock，以及 jti 黑名单/权限缓存测试 */
  redisStore: InstanceType<typeof MockRedisStore>;

  /** @/lib/auth mock */
  mockAuth: {
    withAuth: ReturnType<typeof vi.fn>;
    withPermission: ReturnType<typeof vi.fn>;
    resolveIdentity: ReturnType<typeof vi.fn>;
    logServerDataRead: ReturnType<typeof vi.fn>;
    getUserRoleDeptIds: ReturnType<typeof vi.fn>;
    canAccessDept: ReturnType<typeof vi.fn>;
  };

  /** @/lib/crypto mock */
  mockCrypto: {
    generateUUID: ReturnType<typeof vi.fn>;
    generateId: ReturnType<typeof vi.fn>;
    generateClientId: ReturnType<typeof vi.fn>;
    generateClientSecret: ReturnType<typeof vi.fn>;
    hashClientSecret: ReturnType<typeof vi.fn>;
    hashToken: ReturnType<typeof vi.fn>;
  };

  /** @/lib/permissions mock */
  mockPermissions: {
    refreshUsersPermissionCache: ReturnType<typeof vi.fn>;
    refreshUserPermissionCache: ReturnType<typeof vi.fn>;
  };

  /** @/lib/session/revoke mock */
  mockRevoke: {
    revokeUserAccessByUserId: ReturnType<typeof vi.fn>;
    revokeUsersAccessByUserId: ReturnType<typeof vi.fn>;
  };

  /** next/cache mock */
  mockNextCache: {
    revalidatePath: ReturnType<typeof vi.fn>;
    revalidateTag: ReturnType<typeof vi.fn>;
    updateTag: ReturnType<typeof vi.fn>;
  };
}

/**
 * 创建 vi.hoisted mock holder 集合。
 *
 * 必须在测试文件顶层调用（在 vi.mock() 之前），
 * 返回的 holders 对象可在 vi.mock factory 和 beforeEach 中共享引用。
 */
export function createHoistedHolders(): HoistedHolders {
  return {
    tdHolder: { current: null },

    redisStore: new MockRedisStore(),

    mockAuth: {
      withAuth: vi.fn((_opts: any, handler: Function) => {
        return async (...args: any[]) => {
          return handler({ userId: DEFAULT_ADMIN_ID }, ...args);
        };
      }),
      withPermission: vi.fn((_opts: any, _req: any, handler: Function) => {
        return async (...args: any[]) => {
          return handler(DEFAULT_ADMIN_ID, ...args);
        };
      }),
      resolveIdentity: vi.fn(async () => ({
        userId: DEFAULT_ADMIN_ID,
        claims: { sub: '', iss: '', aud: 'auth-sso', jti: '' },
      })),
      logServerDataRead: vi.fn(async () => {}),
      getUserRoleDeptIds: vi.fn(() => Promise.resolve([] as string[])),
      canAccessDept: vi.fn(() => true),
    },

    mockCrypto: {
      generateUUID: vi.fn(() => 'aabbccdd-eeff-4000-8000-000000000001'),
      generateId: vi.fn(() => 'aaaaaaaa'),
      generateClientId: vi.fn(() => 'client_test1234567890ab'),
      generateClientSecret: vi.fn(() => 's'.repeat(64)),
      hashClientSecret: vi.fn((s: string) => `hash:${s}`),
      hashToken: vi.fn((t: string) => t),
    },

    mockPermissions: {
      refreshUsersPermissionCache: vi.fn(async () => {}),
      refreshUserPermissionCache: vi.fn(async () => {}),
    },

    mockRevoke: {
      revokeUserAccessByUserId: vi.fn(async () => 0),
      revokeUsersAccessByUserId: vi.fn(async () => {}),
    },

    mockNextCache: {
      revalidatePath: vi.fn(),
      revalidateTag: vi.fn(),
      updateTag: vi.fn(),
    },
  };
}

/**
 * 初始化 holders（在每个测试文件的 beforeAll/beforeEach 中调用）。
 *
 * @param holders 从 createHoistedHolders() 获取
 * @param options 配置选项
 * @param options.dbHandle 测试 DB 句柄
 * @param options.authUserId 注入的 auth userId
 * @param options.authPermissions 注入的 auth 权限列表
 * @param options.authDeptIds 注入的 auth deptIds
 */
export function initHoistedHolders(
  holders: HoistedHolders,
  options: {
    dbHandle: TestDbHandle;
    authUserId?: string;
    authPermissions?: string[];
    authDeptIds?: string[];
  },
): void {
  holders.tdHolder.current = options.dbHandle;

  const uid = options.authUserId ?? DEFAULT_ADMIN_ID;
  const perms = options.authPermissions ?? [];

  // 更新 withAuth — 需要重新设置 mockImplementation
  holders.mockAuth.withAuth = vi.fn((_opts: any, handler: Function) => {
    return async (...args: any[]) => {
      return handler({ userId: uid }, ...args);
    };
  }) as any;

  holders.mockAuth.withPermission = vi.fn((_opts: any, _req: any, handler: Function) => {
    return async (...args: any[]) => {
      return handler(uid, ...args);
    };
  }) as any;

  holders.mockAuth.resolveIdentity = vi.fn(async () => ({
    userId: uid,
    claims: { sub: uid, iss: '', aud: 'auth-sso', jti: '' },
  }));

  holders.mockAuth.getUserRoleDeptIds = vi.fn(() =>
    Promise.resolve(options.authDeptIds ?? []),
  );
}

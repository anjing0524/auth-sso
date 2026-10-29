/**
 * 高权目标保护逐路径回归（真实 DB + 真实鉴权链路）
 *
 * 只 mock 身份（“谁已登录”），withAuth / 权限上下文 / 数据范围 / 高权目标守卫
 * 全部走生产实现。每条破坏性/凭证类 Action 都必须拒绝“权限高于操作者”的目标。
 *
 * @req H-ACL-002, H-ACL-003
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import {
  seedRootDept, seedTestUser, seedUserRoleBinding,
} from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供“低权操作者已登录”输入；本文件 admin-target-paths.test.ts 全部用例依赖它；权限判定、范围、目标高权判断均走生产代码
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({
      userId: '00000000-0000-4000-8000-000000000501',
      expiresAt: null,
      issuedAt: null,
    }),
  };
});

import {
  toggleUserStatusAction, updateUserAction, deleteUserAction,
  resetPasswordAction, unlockUserAction, forceLogoutUserAction,
} from '@/app/(dashboard)/users/actions';

const LOW_OPERATOR = '00000000-0000-4000-8000-000000000501';
const TARGET_HIGH = '00000000-0000-4000-8000-000000000502';
const DEPT_ID = '00000000-0000-4000-8000-000000000001';
const LOW_ROLE = '00000000-0000-4000-8000-000000000511';
const HIGH_ROLE = '00000000-0000-4000-8000-000000000512';
const P_UPDATE = '00000000-0000-4000-8000-000000000521';
const P_DELETE = '00000000-0000-4000-8000-000000000522';
const P_RESET = '00000000-0000-4000-8000-000000000523';
const P_MANAGE = '00000000-0000-4000-8000-000000000524';
const P_HIGH = '00000000-0000-4000-8000-000000000525';
const now = new Date();

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: [
      { ...(seedTestUser() ?? [])[0]!, id: LOW_OPERATOR, username: 'low_operator_paths', email: 'low_operator_paths@example.com' },
      { ...(seedTestUser() ?? [])[0]!, id: TARGET_HIGH, username: 'high_target', email: 'high_target@example.com' },
    ],
    roles: [
      { id: LOW_ROLE, name: '低权操作者', code: 'LOW_OPERATOR_PATHS', deptId: DEPT_ID, isSystem: false, status: 'ACTIVE', sort: 0 },
      { id: HIGH_ROLE, name: '高权目标', code: 'HIGH_TARGET_PATHS', deptId: DEPT_ID, isSystem: false, status: 'ACTIVE', sort: 1 },
    ],
    permissions: [
      { id: P_UPDATE, code: 'portal:user:update', name: '更新用户', type: 'API', status: 'ACTIVE' },
      { id: P_DELETE, code: 'portal:user:delete', name: '删除用户', type: 'API', status: 'ACTIVE' },
      { id: P_RESET, code: 'portal:user:reset_password', name: '重置密码', type: 'API', status: 'ACTIVE' },
      { id: P_MANAGE, code: 'portal:user:manage', name: '用户管理', type: 'API', status: 'ACTIVE' },
      { id: P_HIGH, code: 'portal:audit:read', name: '审计读取', type: 'API', status: 'ACTIVE' },
    ],
    userRoles: [
      ...seedUserRoleBinding(LOW_OPERATOR, LOW_ROLE),
      ...seedUserRoleBinding(TARGET_HIGH, HIGH_ROLE),
    ],
    rolePermissions: [
      { roleId: LOW_ROLE, permissionId: P_UPDATE, createdAt: now },
      { roleId: LOW_ROLE, permissionId: P_DELETE, createdAt: now },
      { roleId: LOW_ROLE, permissionId: P_RESET, createdAt: now },
      { roleId: LOW_ROLE, permissionId: P_MANAGE, createdAt: now },
      { roleId: HIGH_ROLE, permissionId: P_HIGH, createdAt: now },
    ],
  });
});

const expectRejected = (result: any) => {
  expect(result.success, JSON.stringify(result)).toBe(false);
  expect(result.message).toContain('不能操作权限高于自身的用户');
};

describe('高权目标保护逐路径', () => {
  it('toggleUserStatusAction', async () => {
    expectRejected(await toggleUserStatusAction(TARGET_HIGH));
  });

  it('updateUserAction', async () => {
    expectRejected(await updateUserAction(TARGET_HIGH, { name: 'renamed' } as any));
  });

  it('deleteUserAction', async () => {
    expectRejected(await deleteUserAction(TARGET_HIGH));
  });

  it('resetPasswordAction', async () => {
    expectRejected(await resetPasswordAction(TARGET_HIGH, 'StrongP@ss1'));
  });

  it('unlockUserAction', async () => {
    expectRejected(await unlockUserAction(TARGET_HIGH));
  });

  it('forceLogoutUserAction', async () => {
    expectRejected(await forceLogoutUserAction(TARGET_HIGH));
  });
});

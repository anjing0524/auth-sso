/**
 * 用户角色绑定 API 集成测试
 *
 * 注意：使用 var 声明测试 DB，避免 vi.mock 工厂中引用未初始化变量（TDZ）。
 * schema 直接引用 @/db/schema（不依赖 @/infrastructure/db 的运行时暴露），
 * db 通过 holder 间接访问以热插拔真实连接。
 *
 * @req C-ROL-ASGN, H-ACL-002
 * @vitest-environment node
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { NextResponse } from 'next/server';
import { DomainError } from '@/domain/shared/errors';
import { COMMON_ERRORS } from '@auth-sso/contracts';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedTestUser, seedUserRoleBinding } from '../helpers/seed-fixtures';
import { createTestRequest } from '../helpers/test-utils';
import * as schema from '@/db/schema';

// vi.mock 工厂会被提升；使用 var 避免它在 ESM 模块初始化期间触发 TDZ。
var td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  // 查询模块在 import 阶段读取 schema；它不依赖测试数据库连接。
  get schema() { return schema; },
}));

vi.mock('@/lib/auth', () => ({
  // 与真实包装器一致：领域错误映射为 HTTP 响应（DomainError.code → 状态码），
  // 其余异常照常抛出（审计失败回滚用例依赖这一点）。
  withPermission: vi.fn(async (_options: unknown, handler: (userId: string) => Promise<Response>) => {
    try {
      return await handler('00000000-0000-4000-8000-000000000101');
    } catch (err) {
      if (err instanceof DomainError) {
        const status = err.code === COMMON_ERRORS.FORBIDDEN ? 403
          : err.code === COMMON_ERRORS.NOT_FOUND ? 404
          : err.code === COMMON_ERRORS.VALIDATION_ERROR ? 422 : 400;
        return NextResponse.json({ error: err.code, message: err.message }, { status });
      }
      throw err;
    }
  }),
  canAccessDept: vi.fn(() => true),
  requireDeptAccess: vi.fn(async () => {}),
  getUserRoleDeptIds: vi.fn(async () => ['00000000-0000-4000-8000-000000000001']),
  logServerDataRead: vi.fn(async () => {}),
}));

vi.mock('@/lib/permissions', () => ({ refreshUserPermissionCache: vi.fn(async () => {}) }));
vi.mock('@/lib/session/revoke', () => ({ revokeUserAccessByUserId: vi.fn(async () => 0) }));
vi.mock('@/lib/audit', () => ({
  appendSecurityAudit: vi.fn(async () => {}),
  extractClientIP: vi.fn(() => '127.0.0.1'),
  extractUserAgent: vi.fn(() => 'Vitest'),
}));

import { POST as assignRoles, DELETE as removeRole } from '@/app/api/users/[id]/roles/route';

const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const ADMIN_ROLE_ID = '00000000-0000-4000-8000-000000000304';
const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_DEPT_ID = '00000000-0000-4000-8000-000000000009';
const USER_ID = '00000000-0000-4000-8000-000000000201';
const OUT_OF_SCOPE_USER_ID = '00000000-0000-4000-8000-000000000209';
const OLD_ROLE_ID = '00000000-0000-4000-8000-000000000301';
const ROLE_ID = '00000000-0000-4000-8000-000000000302';
const SECOND_ROLE_ID = '00000000-0000-4000-8000-000000000303';

beforeAll(async () => {
  await td.connect();
});
afterAll(async () => { await td.close(); });

beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  const now = new Date();
  await seedTestData(td.db, {
    departments: [
      ...seedRootDept(),
      // 不属于任何管理角色的部门 —— 用于证明越界被拦截
      {
        id: OTHER_DEPT_ID, parentId: null, name: '外部部门', code: 'OTHER',
        ancestors: null, sort: 9, status: 'ACTIVE', createdAt: now, updatedAt: now,
      },
    ],
    users: [
      ...(seedTestUser() ?? []),
      ...(seedAdminUser() ?? []),
      // 处于操作者数据范围之外的用户
      {
        ...(seedTestUser() ?? [])[0]!,
        id: OUT_OF_SCOPE_USER_ID, username: 'outsider', email: 'outsider@example.com',
        deptId: OTHER_DEPT_ID,
      },
    ],
    roles: [
      { id: OLD_ROLE_ID, name: '旧角色', code: 'OLD_ROLE', deptId: ROOT_DEPT_ID, isSystem: false, status: 'ACTIVE', sort: 0 },
      { id: ROLE_ID, name: '新角色', code: 'NEW_ROLE', deptId: ROOT_DEPT_ID, isSystem: false, status: 'ACTIVE', sort: 1 },
      { id: SECOND_ROLE_ID, name: '第二角色', code: 'SECOND_ROLE', deptId: ROOT_DEPT_ID, isSystem: false, status: 'ACTIVE', sort: 2 },
      { id: ADMIN_ROLE_ID, name: '管理员角色', code: 'ADMIN_ROLE', deptId: ROOT_DEPT_ID, isSystem: false, status: 'ACTIVE', sort: 3 },
    ],
    // 写路径的数据范围快照现在由真实 getUserRoleDeptIds 解析（经 lib/authz 门面），
    // 因此操作者必须在库中真实拥有一个根部门角色，否则其可见范围为空、守卫正确拒绝。
    userRoles: [
      ...seedUserRoleBinding(USER_ID, OLD_ROLE_ID),
      ...seedUserRoleBinding(ADMIN_ID, ADMIN_ROLE_ID),
    ],
  });
});

function params() {
  return { params: Promise.resolve({ id: USER_ID }) };
}

function request(body: unknown) {
  return createTestRequest(`/api/users/${USER_ID}/roles`, { method: 'POST', body });
}

async function roleIds(): Promise<string[]> {
  const rows = await td.db.select({ roleId: schema.userRoles.roleId })
    .from(schema.userRoles)
    .where(eq(schema.userRoles.userId, USER_ID));
  return rows.map((row) => row.roleId).sort();
}

describe('用户角色绑定 API', () => {
  it('重复 roleIds 返回 400 且不改变既有绑定', async () => {
    const response = await assignRoles(request({ roleIds: [ROLE_ID, ROLE_ID] }), params());

    expect(response.status).toBe(400);
    expect(await roleIds()).toEqual([OLD_ROLE_ID]);
  });

  it.each([
    { roleIds: ['not-a-uuid'] },
    { roleIds: [] },
    { roleIds: Array.from({ length: 101 }, () => ROLE_ID) },
  ])('非法 roleIds 返回 400', async (body) => {
    const response = await assignRoles(request(body), params());

    expect(response.status).toBe(400);
    expect(await roleIds()).toEqual([OLD_ROLE_ID]);
  });

  it('合法同部门启用角色替换旧绑定', async () => {
    const response = await assignRoles(request({ roleIds: [ROLE_ID] }), params());

    expect(response.status).toBe(200);
    expect(await roleIds()).toEqual([ROLE_ID]);
  });

  it('审计写入失败时回滚角色替换', async () => {
    const { appendSecurityAudit } = await import('@/lib/audit');
    vi.mocked(appendSecurityAudit).mockRejectedValueOnce(new Error('审计存储不可用'));

    await expect(assignRoles(request({ roleIds: [ROLE_ID] }), params())).rejects.toThrow('审计存储不可用');

    expect(await roleIds()).toEqual([OLD_ROLE_ID]);
  });

  it('DELETE 仅移除指定角色', async () => {
    await td.db.insert(schema.userRoles).values({ userId: USER_ID, roleId: SECOND_ROLE_ID, createdAt: new Date() });
    const response = await removeRole(
      createTestRequest(`/api/users/${USER_ID}/roles`, { method: 'DELETE', body: { roleId: OLD_ROLE_ID } }),
      params(),
    );

    expect(response.status).toBe(200);
    expect(await roleIds()).toEqual([SECOND_ROLE_ID]);
  });

  it('数据范围外用户 → POST 返回 403 且不改变绑定', async () => {
    const response = await assignRoles(
      createTestRequest(`/api/users/${OUT_OF_SCOPE_USER_ID}/roles`, { method: 'POST', body: { roleIds: [ROLE_ID] } }),
      { params: Promise.resolve({ id: OUT_OF_SCOPE_USER_ID }) },
    );

    expect(response.status).toBe(403);
    const rows = await td.db.select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles).where(eq(schema.userRoles.userId, OUT_OF_SCOPE_USER_ID));
    expect(rows).toEqual([]);
  });

  it('数据范围外用户 → DELETE 返回 403 且不删除绑定', async () => {
    await td.db.insert(schema.userRoles).values({ userId: OUT_OF_SCOPE_USER_ID, roleId: OLD_ROLE_ID, createdAt: new Date() });

    const response = await removeRole(
      createTestRequest(`/api/users/${OUT_OF_SCOPE_USER_ID}/roles`, { method: 'DELETE', body: { roleId: OLD_ROLE_ID } }),
      { params: Promise.resolve({ id: OUT_OF_SCOPE_USER_ID }) },
    );

    expect(response.status).toBe(403);
    const rows = await td.db.select({ roleId: schema.userRoles.roleId })
      .from(schema.userRoles).where(eq(schema.userRoles.userId, OUT_OF_SCOPE_USER_ID));
    expect(rows.map((r) => r.roleId)).toEqual([OLD_ROLE_ID]);
  });
});

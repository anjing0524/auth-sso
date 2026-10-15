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

// 2026-10-14（#87）：**只保留 auth-bypass，错误映射复用生产实现**。
//
// 此前这里的 `withPermission` 是**手写复刻**：领域错误映射为响应、**其余异常照常抛出**，
// 且注释明说"审计失败回滚用例依赖这一点"。但生产契约恰恰是 `withPermission`
// （`lib/auth/guard.ts:71-77`）**catch 一切**并 `mapServerError` ⇒ 审计失败应得到
// **500 响应**（事务已回滚），而不是把异常抛给调用方。手写的状态码表还会与
// `ERROR_STATUS` 漂移（它把 VALIDATION_ERROR 映射成 422，与生产不同）。
//
// 现在：保留"已授权"这一输入（auth-bypass 的正当用途），但错误映射**调用生产的
// `mapServerError`**——换掉替身而不重写契约。
// @allow-module-mock @/lib/auth auth-bypass: 只构造"已授权"上下文；错误映射复用生产 mapServerError。本文件依赖它的断言：user-role-api.test.ts 全部用例
vi.mock(import('@/lib/auth'), async (importOriginal): Promise<Partial<typeof authModule>> => {
  const actual = await importOriginal();
  const { mapServerError } = await import('@/lib/server-error');
  return {
    ...actual,
    withPermission: async (_options, handler) => {
      try {
        return await handler('00000000-0000-4000-8000-000000000101');
      } catch (err) {
        const mapped = mapServerError(err);
        return NextResponse.json({ error: mapped.error, message: mapped.message }, { status: mapped.status });
      }
    },
    logServerDataRead: vi.fn(async () => {}),
  };
});

// @allow-module-mock @/lib/permissions input-fixture: 只提供"刷新已完成"这类输入（单用户与批量两版）；真实 PG 驱动的分级由 permission-enforcement / rt-permission-failure 覆盖
vi.mock(import('@/lib/permissions'), async (importOriginal): Promise<Partial<typeof permissionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    refreshUserPermissionCache: vi.fn(async () => ({ ok: true })),
    refreshUsersPermissionCache: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
  };
});
// @allow-module-mock @/lib/session/revoke input-fixture: 只提供"撤销已完成（revoked=N、failed=false / succeeded、failed）"这类输入（单用户与批量两版）；importOriginal + spread 让未列出的导出走真身——路由经 lib/auth/authorization-effects 走**批量**原语，整体替换会让它变 undefined（本文件曾因此 2 例变红）；真实 Redis 撤销由 force-logout-revocation / oauth-revoke 覆盖
vi.mock(import('@/lib/session/revoke'), async (importOriginal): Promise<Partial<typeof sessionRevokeModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    revokeUserAccessByUserId: vi.fn(async () => ({ revoked: 0, failed: false })),
    revokeUsersAccessByUserId: vi.fn(async () => ({ succeeded: 0, failed: 0 })),
  };
});
// @allow-module-mock @/lib/audit infra-boundary: 审计写入是旁路副作用（fire-and-forget 写库），本文件测的是端点/动作语义
vi.mock(import('@/lib/audit'), async (importOriginal): Promise<Partial<typeof auditModule>> => {
  const actual = await importOriginal();
  return { ...actual,
  appendSecurityAudit: vi.fn(async () => {}),
  extractClientIP: vi.fn(() => '127.0.0.1'),
  extractUserAgent: vi.fn(() => 'Vitest'),
};
});;

import { POST as assignRoles, DELETE as removeRole } from '@/app/api/users/[id]/roles/route';
import type * as authModule from '@/lib/auth';
import type * as permissionsModule from '@/lib/permissions';
import type * as sessionRevokeModule from '@/lib/session/revoke';
import type * as auditModule from '@/lib/audit';


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

  it('审计写入失败 → **整体回滚**且返回 500（生产契约：错误边界映射，不抛出）', async () => {
    const { appendSecurityAudit } = await import('@/lib/audit');
    vi.mocked(appendSecurityAudit).mockRejectedValueOnce(new Error('审计存储不可用'));

    const response = await assignRoles(request({ roleIds: [ROLE_ID] }), params());

    // 审计在事务内：失败必须让角色替换一并回滚（本用例的核心价值）
    expect(await roleIds()).toEqual([OLD_ROLE_ID]);
    // 而非 DomainError 由错误边界映射为 500——**不是**抛给调用方
    expect(response.status).toBe(500);
    expect((await response.json()).error).toBe(COMMON_ERRORS.INTERNAL_ERROR);
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

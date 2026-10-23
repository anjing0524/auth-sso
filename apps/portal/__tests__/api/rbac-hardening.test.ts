/**
 * RBAC / 权限树 / 部门树 修复批次 F3 回归测试（task-11）
 *
 * 覆盖（先红后绿的锚点）：
 * - H-B-02 部门移动级联更新「直接子部门」ancestors，子树展开不漏行
 * - H-21   根部门唯一性服务端强制；非空树不得再把部门迁出为根；范围操作员不得建根
 * - H-B-01 删除目录权限时按子树递归收敛（子权限绑定用户缓存被刷新）
 * - H-20   核心权限（ALL_PERMISSIONS 被代码引用）不可删除；子树含核心码的父节点不可删
 * - H-19   权限 code 不可变、parentId 环检测、type 转换校验
 * - H-B-04 type 转换归一（API→PAGE 清 clientId、DIR→API 清菜单字段、PAGE 必须有 path）
 * - H-B-05 角色迁入 DISABLED / 不存在部门与 create 一致地被拒
 * - H-25（roles 侧）角色改部门时校验已绑定用户部门一致性
 *
 * 手法：真实 PostgreSQL（auth_sso_test）+ 真实 Redis + 真实 withAuth；
 * 只 mock「谁已登录」与 next/cache 失效原语，权限判定/范围守卫/错误映射全部走真身。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { eq, isNull, ne } from 'drizzle-orm';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedPortalClient } from '../helpers/seed-fixtures';
import {
  COMMON_ERRORS,
  DEPARTMENT_PERMISSIONS,
  USER_PERMISSIONS,
} from '@auth-sso/contracts';
import { createTestRequest } from '../helpers/test-utils';
import * as schema from '@/db/schema';

const td = createTestDbHandle();

/** 动态身份：同一文件内切换操作者（mock 身份输入，鉴权链路走真身） */
const state = vi.hoisted(() => ({ userId: '00000000-0000-4000-8000-000000000101' }));

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；本文件依赖它的断言：全部用例的操作者身份。权限判定/范围守卫/错误映射全部走真身；合法理由见 ADR-022（reason 点名本文件 rbac-hardening.test.ts）
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({ userId: state.userId, expiresAt: null, issuedAt: null }),
  };
});
vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
  updateTag: vi.fn(),
}));

import { db } from '@/infrastructure/db';
import { withPermission } from '@/lib/auth';
import { restSuccess } from '@/lib/response';
import { resolveScope } from '@/lib/authz';
import { getUserPermissionContext } from '@/lib/permissions';
import {
  createDepartmentAction,
  updateDepartmentAction,
} from '@/app/(dashboard)/departments/actions';
import {
  deletePermissionAction,
  updatePermissionAction,
} from '@/app/(dashboard)/permissions/actions';
import { updateRoleAction } from '@/app/(dashboard)/roles/actions';
import { GET as listRolesRoute } from '@/app/api/roles/route';
import { GET as listPermissionsRoute } from '@/app/api/permissions/route';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';

// ── 固定 ID / 时间 ─────────────────────────────────
const ROOT_ID = '00000000-0000-4000-8000-000000000001';
const TECH_ID = '00000000-0000-4000-8000-000000000002';
const FE_ID = '00000000-0000-4000-8000-000000000003';
const MKT_ID = '00000000-0000-4000-8000-000000000004';
const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const TECH_USER_ID = '00000000-0000-4000-8000-000000000201';
const SUPER_ROLE_ID = '00000000-0000-4000-8000-000000000301';
const TECH_ROLE_ID = '00000000-0000-4000-8000-000000000302';
const OP_ROLE_ID = '00000000-0000-4000-8000-000000000303';
const PERM_A_ID = '00000000-0000-4000-8000-000000000401';
const PERM_B_ID = '00000000-0000-4000-8000-000000000402';
const PERM_OP_ID = '00000000-0000-4000-8000-000000000403';

const now = new Date();

// ── 种子工厂 ───────────────────────────────────────
function deptRow(id: string, parentId: string | null, ancestors: string | null, name: string, code: string, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  return { id, parentId, ancestors, name, code, sort: 0, status, createdAt: now, updatedAt: now };
}
function userRow(id: string, deptId: string | null, username: string, email: string) {
  return {
    id, username, email, emailVerified: true, mobile: null, mobileVerified: false,
    name: username, passwordHash: '$2b$10$3NW6cGa0tGI9DCtuGr0leOcsRRUVKd.4hsrs7kWdhuK6.kaEXitVe',
    passwordHistory: null, avatarUrl: null, status: 'ACTIVE' as const, deptId,
    lastLoginAt: null, deletedAt: null, passwordChangedAt: null, createdAt: now, updatedAt: now,
  };
}
function roleRow(id: string, code: string, deptId: string, isSystem = false, status: 'ACTIVE' | 'DISABLED' = 'ACTIVE') {
  return { id, name: code, code, description: null, deptId, isSystem, status, sort: 0, createdAt: now, updatedAt: now };
}
function permRow(
  id: string,
  code: string,
  type: 'API' | 'PAGE' | 'DIRECTORY',
  parentId: string | null = null,
  extra: Partial<typeof schema.permissions.$inferInsert> = {},
) {
  return {
    id, code, name: code, description: null, type, parentId, status: 'ACTIVE' as const, sort: 0,
    path: type === 'API' ? null : '/qa', icon: null, visible: true, clientId: null,
    createdAt: now, updatedAt: now, ...extra,
  };
}
const binding = (roleId: string, permissionId: string) => ({ roleId, permissionId, createdAt: now });
const userRole = (userId: string, roleId: string) => ({ userId, roleId, createdAt: now });

/** 部门树：ROOT ├ TECH ├ FE；ROOT └ MKT */
async function seedDefaultTree() {
  await seedTestData(td.db, {
    departments: [
      deptRow(ROOT_ID, null, null, '总公司', 'ROOT'),
      deptRow(TECH_ID, ROOT_ID, ROOT_ID, '技术部', 'TECH'),
      deptRow(FE_ID, TECH_ID, `${ROOT_ID}/${TECH_ID}`, '前端组', 'FE'),
      deptRow(MKT_ID, ROOT_ID, ROOT_ID, '市场部', 'MKT'),
    ],
    users: [userRow(ADMIN_ID, ROOT_ID, 'admin', 'admin@example.com')],
    roles: [roleRow(SUPER_ROLE_ID, 'SUPER_ADMIN', ROOT_ID, true)],
    userRoles: [userRole(ADMIN_ID, SUPER_ROLE_ID)],
  });
}

/** 部门范围操作员：用户在 TECH、角色在 TECH、持指定权限 */
async function seedDeptOperator(permissionCode: string) {
  await seedTestData(td.db, {
    users: [userRow(TECH_USER_ID, TECH_ID, 'techuser', 'tech@example.com')],
    roles: [roleRow(OP_ROLE_ID, 'QA_OP_ROLE', TECH_ID)],
    permissions: [permRow(PERM_OP_ID, permissionCode, 'API')],
    rolePermissions: [binding(OP_ROLE_ID, PERM_OP_ID)],
    userRoles: [userRole(TECH_USER_ID, OP_ROLE_ID)],
  });
}

/** 跨部门 user_roles 不变量 */
async function crossDeptBindings() {
  return db.select({ userId: schema.userRoles.userId })
    .from(schema.userRoles)
    .innerJoin(schema.users, eq(schema.users.id, schema.userRoles.userId))
    .innerJoin(schema.roles, eq(schema.roles.id, schema.userRoles.roleId))
    .where(ne(schema.users.deptId, schema.roles.deptId));
}

async function deptById(id: string) {
  return (await db.query.departments.findFirst({ where: eq(schema.departments.id, id) }))!;
}
async function permById(id: string) {
  return db.query.permissions.findFirst({ where: eq(schema.permissions.id, id) });
}

// ── 生命周期 ───────────────────────────────────────
beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  vi.clearAllMocks();
  await td.cleanup();
  state.userId = ADMIN_ID;
  await seedDefaultTree();
});

// ═══════════════════════════════════════════════════
// H-B-02 部门移动：级联更新直接子部门 ancestors
// ═══════════════════════════════════════════════════
describe('H-B-02 部门移动级联 ancestors', () => {
  it('TECH 移到 MKT 之下：TECH 与直接子部门 FE 的 ancestors 同步更新', async () => {
    state.userId = ADMIN_ID;
    const r: any = await updateDepartmentAction(TECH_ID, { parentId: MKT_ID });
    expect(r.success).toBe(true);

    expect((await deptById(TECH_ID)).ancestors).toBe(`${ROOT_ID}/${MKT_ID}`);
    // 直接子部门：ancestors 恰等于旧前缀（ROOT/TECH），此前被 LIKE oldPrefix+'/%' 漏掉
    expect((await deptById(FE_ID)).ancestors).toBe(`${ROOT_ID}/${MKT_ID}/${TECH_ID}`);
  });

  it('移动后新父部门的角色数据范围包含被移动子树的直接子部门', async () => {
    // 用户在 MKT、角色绑 MKT：移动 TECH 到 MKT 后，范围应含 TECH 与 FE
    await seedTestData(td.db, {
      users: [userRow(TECH_USER_ID, MKT_ID, 'mktuser', 'mkt@example.com')],
      roles: [roleRow(TECH_ROLE_ID, 'QA_MKT_ROLE', MKT_ID)],
      userRoles: [userRole(TECH_USER_ID, TECH_ROLE_ID)],
    });
    state.userId = ADMIN_ID;
    expect((await updateDepartmentAction(TECH_ID, { parentId: MKT_ID })).success).toBe(true);

    const scope = await resolveScope(db, TECH_USER_ID);
    expect(scope.deptIds).toContain(TECH_ID);
    expect(scope.deptIds).toContain(FE_ID);
  });
});

// ═══════════════════════════════════════════════════
// H-21 根部门唯一性（服务端强制）
// ═══════════════════════════════════════════════════
describe('H-21 根部门唯一性', () => {
  it('已有根部门时创建第二个根被拒，DB 根数量不变', async () => {
    state.userId = ADMIN_ID;
    const r: any = await createDepartmentAction({ name: '非法第二根', code: 'QA-ROOT-2', parentId: null, sort: 0 });
    expect(r.success).toBe(false);
    expect(r.message).toContain('根部门');

    const roots = await db.select().from(schema.departments).where(isNull(schema.departments.parentId));
    expect(roots).toHaveLength(1);
  });

  it('非根部门不得迁出为根（update parentId=null 被拒）', async () => {
    state.userId = ADMIN_ID;
    const r: any = await updateDepartmentAction(TECH_ID, { parentId: null });
    expect(r.success).toBe(false);
    expect(r.message).toContain('根部门');
    expect((await deptById(TECH_ID)).parentId).toBe(ROOT_ID);

    const roots = await db.select().from(schema.departments).where(isNull(schema.departments.parentId));
    expect(roots).toHaveLength(1);
  });

  it('部门范围操作员（targets 为空）不能借道创建全局根部门', async () => {
    await seedDeptOperator(DEPARTMENT_PERMISSIONS.CREATE);
    state.userId = TECH_USER_ID;
    const r: any = await createDepartmentAction({ name: '范围外根', code: 'QA-OUT-ROOT', parentId: null, sort: 0 });
    expect(r.success).toBe(false);

    const roots = await db.select().from(schema.departments).where(isNull(schema.departments.parentId));
    expect(roots).toHaveLength(1);
  });

  it('范围内创建子部门不受影响（回归）', async () => {
    await seedDeptOperator(DEPARTMENT_PERMISSIONS.CREATE);
    state.userId = TECH_USER_ID;
    const r: any = await createDepartmentAction({ name: 'TECH 子部门', code: 'QA-TECH-CHILD', parentId: TECH_ID, sort: 0 });
    expect(r.success).toBe(true);
    const created = await db.query.departments.findFirst({ where: eq(schema.departments.code, 'QA-TECH-CHILD') });
    expect(created!.ancestors).toBe(`${ROOT_ID}/${TECH_ID}`);
  });
});

// ═══════════════════════════════════════════════════
// H-B-01 目录权限删除：按子树收敛受影响用户
// ═══════════════════════════════════════════════════
describe('H-B-01 权限子树删除的授权收敛', () => {
  it('仅绑定「子权限」的用户在父目录删除后被刷新缓存，不再持有已删权限', async () => {
    await seedTestData(td.db, {
      users: [userRow(TECH_USER_ID, TECH_ID, 'techuser', 'tech@example.com')],
      roles: [roleRow(TECH_ROLE_ID, 'QA_TECH_ROLE', TECH_ID)],
      permissions: [
        permRow(PERM_A_ID, 'qa:menu:root', 'DIRECTORY', null, { name: 'QA菜单根' }),
        permRow(PERM_B_ID, 'test:child:perm', 'PAGE', PERM_A_ID, { name: '子权限', path: '/qa-child' }),
      ],
      rolePermissions: [binding(TECH_ROLE_ID, PERM_B_ID)], // 只绑子权限，不绑父目录
      userRoles: [userRole(TECH_USER_ID, TECH_ROLE_ID)],
    });
    state.userId = TECH_USER_ID;
    const warm = await getUserPermissionContext(TECH_USER_ID);
    expect(warm.kind === 'ok' && warm.context.permissions).toContain('test:child:perm');

    state.userId = ADMIN_ID;
    const del: any = await deletePermissionAction(PERM_A_ID);
    expect(del.success).toBe(true);
    expect(await permById(PERM_B_ID)).toBeUndefined();

    state.userId = TECH_USER_ID;
    const after = await getUserPermissionContext(TECH_USER_ID);
    expect(after.kind).toBe('ok');
    expect(after.kind === 'ok' && after.context.permissions).not.toContain('test:child:perm');

    const denied = await withPermission({ permissions: ['test:child:perm'] }, async () => restSuccess({ ok: true }));
    expect(denied.status).toBe(403);
  });
});

// ═══════════════════════════════════════════════════
// H-20 核心权限保留清单
// ═══════════════════════════════════════════════════
describe('H-20 核心权限不可删除', () => {
  it('被代码引用的核心权限码（ALL_PERMISSIONS）删除被拒，行仍在', async () => {
    await seedTestData(td.db, {
      permissions: [permRow(PERM_A_ID, USER_PERMISSIONS.LIST, 'API')],
    });
    state.userId = ADMIN_ID;
    const r: any = await deletePermissionAction(PERM_A_ID);
    expect(r.success).toBe(false);
    expect(r.message).toContain('内置');
    expect(await permById(PERM_A_ID)).toBeDefined();
  });

  it('父目录子树包含核心权限时，删除父目录同样被拒（CASCADE 不得绕过）', async () => {
    await seedTestData(td.db, {
      permissions: [
        permRow(PERM_A_ID, 'qa:menu:root2', 'DIRECTORY', null, { name: 'QA菜单根2' }),
        permRow(PERM_B_ID, USER_PERMISSIONS.DELETE, 'API', PERM_A_ID),
      ],
    });
    state.userId = ADMIN_ID;
    const r: any = await deletePermissionAction(PERM_A_ID);
    expect(r.success).toBe(false);
    expect(await permById(PERM_B_ID)).toBeDefined();
  });

  it('普通自定义权限（不在 ALL_PERMISSIONS）仍可删除（不误伤）', async () => {
    await seedTestData(td.db, {
      permissions: [permRow(PERM_A_ID, 'test:custom:perm', 'API')],
    });
    state.userId = ADMIN_ID;
    const r: any = await deletePermissionAction(PERM_A_ID);
    expect(r.success).toBe(true);
    expect(await permById(PERM_A_ID)).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════
// H-19 / H-B-04 权限更新：code 不可变、环检测、type 归一
// ═══════════════════════════════════════════════════
describe('H-19 权限更新约束', () => {
  it('code 不可变更：带 code 的更新被拒且 DB 不变', async () => {
    await seedTestData(td.db, { permissions: [permRow(PERM_A_ID, 'qa:stable:code', 'API')] });
    state.userId = ADMIN_ID;
    const r: any = await updatePermissionAction(PERM_A_ID, { code: 'qa:changed:code', name: '改名' });
    expect(r.success).toBe(false);
    expect(r.message).toContain('编码不可变更');
    expect((await permById(PERM_A_ID))!.code).toBe('qa:stable:code');
  });

  it('父级不能设为自身', async () => {
    await seedTestData(td.db, { permissions: [permRow(PERM_A_ID, 'qa:dir:self', 'DIRECTORY')] });
    state.userId = ADMIN_ID;
    const r: any = await updatePermissionAction(PERM_A_ID, { parentId: PERM_A_ID });
    expect(r.success).toBe(false);
    expect((await permById(PERM_A_ID))!.parentId).toBeNull();
  });

  it('父级不能设为自身后代（环检测）', async () => {
    await seedTestData(td.db, {
      permissions: [
        permRow(PERM_A_ID, 'qa:dir:root', 'DIRECTORY', null, { name: '根目录' }),
        permRow(PERM_B_ID, 'qa:dir:child', 'DIRECTORY', PERM_A_ID, { name: '子目录' }),
      ],
    });
    state.userId = ADMIN_ID;
    const r: any = await updatePermissionAction(PERM_A_ID, { parentId: PERM_B_ID });
    expect(r.success).toBe(false);
    expect(r.message).toContain('后代');
    expect((await permById(PERM_A_ID))!.parentId).toBeNull();
    expect((await permById(PERM_B_ID))!.parentId).toBe(PERM_A_ID);
  });

  it('合法调整父级（子目录升为顶层）成功', async () => {
    await seedTestData(td.db, {
      permissions: [
        permRow(PERM_A_ID, 'qa:dir:root2', 'DIRECTORY', null, { name: '根目录2' }),
        permRow(PERM_B_ID, 'qa:dir:child2', 'DIRECTORY', PERM_A_ID, { name: '子目录2' }),
      ],
    });
    state.userId = ADMIN_ID;
    const r: any = await updatePermissionAction(PERM_B_ID, { parentId: null });
    expect(r.success).toBe(true);
    expect((await permById(PERM_B_ID))!.parentId).toBeNull();
  });
});

describe('H-B-04 type 转换校验/归一', () => {
  it('API(clientId)→PAGE：clientId 被归一清空，转换成功', async () => {
    await seedTestData(td.db, { clients: seedPortalClient() });
    await seedTestData(td.db, {
      permissions: [permRow(PERM_A_ID, 'portal:qa:apionly', 'API', null, { clientId: 'portal' })],
    });
    state.userId = ADMIN_ID;
    const r: any = await updatePermissionAction(PERM_A_ID, { type: 'PAGE', path: '/qa-page' });
    expect(r.success).toBe(true);
    const row = (await permById(PERM_A_ID))!;
    expect(row.type).toBe('PAGE');
    expect(row.clientId).toBeNull();
    expect(row.path).toBe('/qa-page');
  });

  it('PAGE 缺少 path 时被拒（类型专属字段约束）', async () => {
    await seedTestData(td.db, { permissions: [permRow(PERM_A_ID, 'qa:to-page', 'API')] });
    state.userId = ADMIN_ID;
    const r: any = await updatePermissionAction(PERM_A_ID, { type: 'PAGE' });
    expect(r.success).toBe(false);
    expect(r.message).toContain('路由路径');
    expect((await permById(PERM_A_ID))!.type).toBe('API');
  });

  it('DIRECTORY→API 成功且菜单专属字段被归一清空', async () => {
    await seedTestData(td.db, {
      permissions: [permRow(PERM_A_ID, 'qa:dir:to-api', 'DIRECTORY', null, { path: '/qa-dir', icon: 'Folder', visible: true })],
    });
    state.userId = ADMIN_ID;
    const r: any = await updatePermissionAction(PERM_A_ID, { type: 'API' });
    expect(r.success).toBe(true);
    const row = (await permById(PERM_A_ID))!;
    expect(row.type).toBe('API');
    expect(row.path).toBeNull();
    expect(row.icon).toBeNull();
    expect(row.visible).toBeNull();
  });
});

// ═══════════════════════════════════════════════════
// H-B-05 角色部门迁移：与 create 一致的 dept 可用性校验
// ═══════════════════════════════════════════════════
describe('H-B-05 角色迁移部门校验', () => {
  it('迁入 DISABLED 部门被拒（与 create 语义一致）', async () => {
    await seedTestData(td.db, {
      roles: [roleRow(TECH_ROLE_ID, 'QA_ROLE_MOVE', TECH_ID)],
    });
    state.userId = ADMIN_ID;
    expect((await updateDepartmentAction(MKT_ID, { status: 'DISABLED' })).success).toBe(true);

    const r: any = await updateRoleAction(TECH_ROLE_ID, { deptId: MKT_ID });
    expect(r.success).toBe(false);
    expect(r.message).toContain('禁用');
    const row = await db.query.roles.findFirst({ where: eq(schema.roles.id, TECH_ROLE_ID) });
    expect(row!.deptId).toBe(TECH_ID);
  });

  it('迁入不存在部门被拒（不在操作者范围 ⇒ fail-closed 403）且不落库', async () => {
    await seedTestData(td.db, { roles: [roleRow(TECH_ROLE_ID, 'QA_ROLE_MOVE2', TECH_ID)] });
    state.userId = ADMIN_ID;
    const r: any = await updateRoleAction(TECH_ROLE_ID, { deptId: '00000000-0000-4000-8000-00000000dead' });
    expect(r.success).toBe(false);
    // 不存在的部门天然不在任何角色子树内 ⇒ 范围守卫先以 403 拒绝（不泄露存在性）
    expect(r.error).toBe(COMMON_ERRORS.FORBIDDEN);
    const row = await db.query.roles.findFirst({ where: eq(schema.roles.id, TECH_ROLE_ID) });
    expect(row!.deptId).toBe(TECH_ID);
  });
});

// ═══════════════════════════════════════════════════
// H-25（roles 侧）角色改部门时校验绑定用户部门一致性
// ═══════════════════════════════════════════════════
describe('H-25 roles 侧跨部门不变量', () => {
  it('角色仍有绑定用户时不得迁往其他部门（避免 user_roles 跨部门漂移）', async () => {
    await seedTestData(td.db, {
      users: [userRow(TECH_USER_ID, TECH_ID, 'techuser', 'tech@example.com')],
      roles: [roleRow(TECH_ROLE_ID, 'QA_BOUND_ROLE', TECH_ID)],
      userRoles: [userRole(TECH_USER_ID, TECH_ROLE_ID)],
    });
    state.userId = ADMIN_ID;
    const r: any = await updateRoleAction(TECH_ROLE_ID, { deptId: MKT_ID });
    expect(r.success).toBe(false);
    expect(r.message).toContain('绑定');
    expect((await db.query.roles.findFirst({ where: eq(schema.roles.id, TECH_ROLE_ID) }))!.deptId).toBe(TECH_ID);
    expect(await crossDeptBindings()).toHaveLength(0);
  });

  it('无绑定用户的角色可以正常迁移部门（回归）', async () => {
    await seedTestData(td.db, { roles: [roleRow(TECH_ROLE_ID, 'QA_FREE_ROLE', TECH_ID)] });
    state.userId = ADMIN_ID;
    const r: any = await updateRoleAction(TECH_ROLE_ID, { deptId: MKT_ID });
    expect(r.success).toBe(true);
    expect((await db.query.roles.findFirst({ where: eq(schema.roles.id, TECH_ROLE_ID) }))!.deptId).toBe(MKT_ID);
  });
});

// ═══════════════════════════════════════════════════
// H-C-05 查询参数枚举校验（非法值 400，而不是 500）
// ═══════════════════════════════════════════════════
describe('H-C-05 列表过滤参数枚举校验', () => {
  it('/api/roles?status=BOGUS → 400（此前 asEntityStatus 抛错→500）', async () => {
    const res = await listRolesRoute(createTestRequest('/api/roles', { searchParams: { status: 'BOGUS' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
  });

  it('/api/roles?status=ACTIVE → 200（合法值不受影响）', async () => {
    const res = await listRolesRoute(createTestRequest('/api/roles', { searchParams: { status: 'ACTIVE' } }));
    expect(res.status).toBe(200);
  });

  it('/api/permissions?type=BOGUS → 400（此前 asPermissionType 抛错→500）', async () => {
    const res = await listPermissionsRoute(createTestRequest('/api/permissions', { searchParams: { type: 'BOGUS' } }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
  });

  it('/api/permissions?type=API → 200（合法值不受影响）', async () => {
    const res = await listPermissionsRoute(createTestRequest('/api/permissions', { searchParams: { type: 'API' } }));
    expect(res.status).toBe(200);
  });
});

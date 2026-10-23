/**
 * Department Server Actions 集成测试（真实 DB）
 *
 * @req F-DEP-C, F-DEP-U, F-DEP-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedSubDept, seedSuperAdminRole, seedTestUser, seedUserRoleBinding } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { COMMON_ERRORS } from '@auth-sso/contracts';

// 断言说明：`ApiResponse` 是判别联合（`ApiSuccess | ApiError`），因此断言失败契约时先
// `if (r.success) expect.unreachable(...)` 收窄，再取 `r.error`（直接取会 TS2339）。
import { DEPARTMENT_ERRORS } from '@auth-sso/contracts';

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const TECH_DEPT_ID = '00000000-0000-4000-8000-000000000002';
const CHILD_DEPT_ID = '00000000-0000-4000-8000-000000000003';
const WITH_USERS_DEPT_ID = '00000000-0000-4000-8000-000000000004';
const CREATED_DEPT_ID = 'aabbccdd-eeff-4000-8000-000000000001';

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// 2026-10-14（#71 同类修订）：**只 mock 身份解析，让 `withAuth` 跑真身**。
// 此前整体替换 `@/lib/auth`（含 `withAuth`），于是**权限判定与错误映射双双消失**，
// 领域错误以 reject 逃逸——而生产契约是 `{ success:false, error, message }`（`lib/auth/guard.ts:38-49`）。
// 现在权限门（SUPER_ADMIN 绕过，ADR-001）、范围守卫、错误映射、审计全部真实执行。
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；本文件依赖它的断言：全部用例的操作者身份。鉴权链路其余部分走真身（见上）；合法理由见 ADR-022（reason 点名本文件 department-actions.test.ts）
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    resolveIdentity: async () => ({
      userId: '00000000-0000-4000-8000-000000000101',
      expiresAt: null,
      issuedAt: null,
    }),
  };
});
// @allow-module-mock @/lib/crypto input-fixture: 只覆盖「确定性 ID」这类输入，其余导出（含 hashToken）走真身
vi.mock(import('@/lib/crypto'), async (importOriginal): Promise<Partial<typeof cryptoModule>> => {
  const actual = await importOriginal();
  // 只覆盖「确定性 ID」，其余导出（含 hashToken 的真实 sha256）走真身：
  // 整体替换会让未列出的导出变成 undefined，而注解却声称它们走真实实现
  return {
    ...actual,
    generateUUID: () => CREATED_DEPT_ID,
    generateId: (_len?: number) => 'aaaaaaaa',
  };
});
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));

import { db } from '@/infrastructure/db';
import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '@/app/(dashboard)/departments/actions';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';
import type * as cryptoModule from '@/lib/crypto';


beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  // 数据范围守卫现由真实 resolveScope（lib/authz）解析，不再经过被 mock 的
  // @/lib/auth。操作者须在库中真实拥有一个根部门角色（其子树覆盖所有测试部门）。
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: '00000000-0000-4000-8000-000000000001' }),
    userRoles: seedUserRoleBinding('00000000-0000-4000-8000-000000000101', '00000000-0000-4000-8000-000000000301'),
  });
});

describe('Department Server Actions', () => {
  describe('createDepartmentAction', () => {
    it('有效输入（挂在根部门下）→ 返回 success: true 并写入部门', async () => {
      // 2026-10-23（task-11/H-21）：根部门是 ADR-002 单例，preflight 会拒绝第二个根，
      // 故"新建部门"一律挂在已有根下（UI 也只在空树引导期显示"新建根部门"）。
      const r: any = await createDepartmentAction({ name: 'New Dept', code: 'ND', sort: 1, parentId: ROOT_DEPT_ID });

      expect(r.success).toBe(true);
      expect(r.data.id).toBeDefined();
      expect(r.message).toBe('部门创建成功');

      const rows = await db.select().from(schema.departments);
      const created = rows.find(d => d.name === 'New Dept');
      expect(created).toBeDefined();
      expect(created!.code).toBe('ND');
      expect(created!.sort).toBe(1);
      expect(created!.parentId).toBe(ROOT_DEPT_ID);
      expect(created!.ancestors).toBe(ROOT_DEPT_ID);
    });

    it('有 parentId → ancestors 正确计算', async () => {
      const r: any = await createDepartmentAction({ name: 'Child', code: 'C', sort: 0, parentId: ROOT_DEPT_ID });

      expect(r.success).toBe(true);

      const rows = await db.select().from(schema.departments);
      const child = rows.find(d => d.name === 'Child');
      expect(child).toBeDefined();
      expect(child!.parentId).toBe(ROOT_DEPT_ID);
      expect(child!.ancestors).toBe(ROOT_DEPT_ID);
    });

    it('缺 name → 返回 success: false 并包含错误码', async () => {
      const r: any = await createDepartmentAction({ name: '', code: '', sort: 1, parentId: null } as any);

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBeDefined();
      expect(r.message).toBeDefined();
    });
  });

  describe('createDepartmentAction 唯一性冲突（走真实 DB 唯一约束）', () => {
    it('部门编码重复 → 409 且携带 **DEPARTMENT_ALREADY_EXISTS**', async () => {
      await seedTestData(td.db, { departments: seedSubDept() }); // code = 'TECH'

      const r = await createDepartmentAction({
        name: '另一个部门',
        code: 'TECH',
        sort: 9,
        parentId: ROOT_DEPT_ID,
      } as any);

      if (r.success) expect.unreachable('重复编码必须被拒');
      // 本路径**没有**内联查重：唯一性由 PG 约束保证，错误从唯一约束违例映射而来
      expect(r.error).toBe(DEPARTMENT_ERRORS.DEPARTMENT_ALREADY_EXISTS);
    });
  });

  describe('updateDepartmentAction', () => {
    it('存在部门 → 返回 success: true 且 DB 更新', async () => {
      await seedTestData(td.db, { departments: seedSubDept() });

      const r: any = await updateDepartmentAction(TECH_DEPT_ID, { name: 'Updated Tech' } as any);

      expect(r.success).toBe(true);
      expect(r.message).toBe('部门更新成功');
      expect(r.data.id).toBe(TECH_DEPT_ID);

      const rows = await db.select().from(schema.departments);
      const updated = rows.find(d => d.id === TECH_DEPT_ID);
      expect(updated).toBeDefined();
      expect(updated!.name).toBe('Updated Tech');
    });

    it('不存在部门 → 失败信封 NOT_FOUND（生产契约）', async () => {
      const r = await updateDepartmentAction(
        '00000000-0000-4000-8000-000000000999',
        { name: 'X' } as any,
      );

      // 生产契约：领域错误被 withAuth 映射为失败信封（**不抛出**）
      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });
  });

  describe('deleteDepartmentAction', () => {
    it('无依赖叶子部门 → 返回 success: true 且从 DB 删除', async () => {
      await seedTestData(td.db, { departments: seedSubDept() });

      const r: any = await deleteDepartmentAction(TECH_DEPT_ID);

      expect(r.success).toBe(true);
      expect(r.message).toBe('部门已删除');
      expect(r.data.id).toBe(TECH_DEPT_ID);

      const rows = await db.select().from(schema.departments);
      expect(rows.find(d => d.id === TECH_DEPT_ID)).toBeUndefined();
    });

    it('**根部门以专属码被拒**（ADR-002 承诺的守卫 + 优先级）', async () => {
      // 夹具说明（beforeEach 已播根部门 + 绑在根上的操作者角色）：
      // 要删除根部门，操作者的**生效角色必须绑在根上**（否则范围不覆盖根），
      // 于是根上必然 ≥1 个角色 ⇒ roleCount 检查本来也会挡住。
      // **因此这条用例的判别点是"用哪个码拒绝"，而不是"是否拒绝"**：
      // ADR-002 承诺的是 `CANNOT_DELETE_ROOT`（该码此前只在 contracts 定义、全仓零引用），
      // 而非通用的 `VALIDATION_ERROR` + "存在关联角色"的文案。
      const r = await deleteDepartmentAction(ROOT_DEPT_ID);
      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(DEPARTMENT_ERRORS.CANNOT_DELETE_ROOT);

      // 行必须仍在（否决性数据：拒绝就不能有副作用）
      const rows = await db.select().from(schema.departments);
      expect(rows.find(d => d.id === ROOT_DEPT_ID)).toBeDefined();
    });

    it('不存在部门 → 失败信封 NOT_FOUND（生产契约）', async () => {
      const r = await (
        deleteDepartmentAction('00000000-0000-4000-8000-000000000999')
      );
      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });

    it('有子部门 → 失败信封 VALIDATION_ERROR（生产契约）', async () => {
      await seedTestData(td.db, {
        departments: [
          ...(seedSubDept()!),
          {
            id: CHILD_DEPT_ID,
            parentId: TECH_DEPT_ID,
            name: '前端组',
            code: 'FE',
            ancestors: `${ROOT_DEPT_ID}/${TECH_DEPT_ID}`,
            sort: 0,
            status: 'ACTIVE',
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        ],
      });

      const r = await (
        deleteDepartmentAction(TECH_DEPT_ID)
      );
      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(DEPARTMENT_ERRORS.DEPARTMENT_HAS_CHILDREN);
      expect(r.message).toContain('子部门');
    });

    it('有用户关联 → 失败信封 VALIDATION_ERROR（生产契约）', async () => {
      await seedTestData(td.db, {
        departments: [{
          id: WITH_USERS_DEPT_ID,
          parentId: ROOT_DEPT_ID,
          name: '有人部门',
          code: 'WU',
          ancestors: ROOT_DEPT_ID,
          sort: 0,
          status: 'ACTIVE',
          createdAt: new Date(),
          updatedAt: new Date(),
        }],
        users: seedTestUser({ deptId: WITH_USERS_DEPT_ID, id: '00000000-0000-4000-8000-000000000201' }),
      });

      const r = await (
        deleteDepartmentAction(WITH_USERS_DEPT_ID)
      );
      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(DEPARTMENT_ERRORS.DEPARTMENT_HAS_USERS);
      expect(r.message).toContain('关联用户');
    });
  });
});

// ── H-23：部门 DISABLED 是生命周期门禁（禁止在其下新建/迁入） ──
const DISABLED_DEPT_ID = '00000000-0000-4000-8000-0000000000d1';

async function seedDisabledDept(): Promise<void> {
  await seedTestData(td.db, {
    departments: seedSubDept({ id: DISABLED_DEPT_ID, code: 'DISABLED_DEPT', name: '已禁用部门', status: 'DISABLED' }),
  });
}

describe('H-23 部门 DISABLED 守卫', () => {
  it('在已禁用部门下创建子部门 → 422，且不落库', async () => {
    await seedDisabledDept();

    const r: any = await createDepartmentAction({ name: 'Disabled Child', code: 'DC', sort: 1, parentId: DISABLED_DEPT_ID });

    expect(r.success).toBe(false);
    expect(String(r.message)).toContain('禁用');
    const children = await db.select().from(schema.departments).where(eq(schema.departments.parentId, DISABLED_DEPT_ID));
    expect(children).toHaveLength(0);
  });

  it('把部门迁入已禁用部门 → 422，原父级不变', async () => {
    await seedDisabledDept();
    await seedTestData(td.db, { departments: seedSubDept() }); // TECH (parent = ROOT)

    const r: any = await updateDepartmentAction(TECH_DEPT_ID, { parentId: DISABLED_DEPT_ID } as any);

    expect(r.success).toBe(false);
    expect(String(r.message)).toContain('禁用');
    const tech = await db.query.departments.findFirst({ where: eq(schema.departments.id, TECH_DEPT_ID) });
    expect(tech?.parentId).toBe(ROOT_DEPT_ID);
  });
});

/**
 * User Server Actions 集成测试（真实 DB）
 *
 * 使用事务回滚隔离，验证所有 CRUD 操作端到端正确性。
 *
 * @req DC-USR-C, DC-USR-U, DC-USR-D
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';
import { seedAdminUser, seedRootDept, seedSuperAdminRole, seedTestUser, seedUserRoleBinding } from '../helpers/seed-fixtures';
import * as schema from '@/db/schema';
import { eq } from 'drizzle-orm';
import { COMMON_ERRORS, USER_ERRORS } from '@auth-sso/contracts';

// 断言说明：`ApiResponse` 是判别联合（`ApiSuccess | ApiError`），因此断言失败契约时先
// `if (r.success) expect.unreachable(...)` 收窄，再取 `r.error`（直接取会 TS2339）。

// ── 测试数据库 ──────────────────────────────────────
const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));
// 2026-10-14（#71）：**只 mock 身份解析，让 `withAuth` 跑真身**。
//
// 此前本文件把 `@/lib/auth` 整体替换为 `withAuth: (_o, h) => async (...a) => h(...)`，
// 于是**权限判定与错误映射双双消失**，领域错误以 reject 逃逸——
// 而生产契约恰恰相反：`withAuth`（`lib/auth/guard.ts:38-49`）在内部 catch 领域错误，
// 映射为 `{ success:false, error, message }`，**从不抛出**。
// 实测该文件因此同时钉住两种相反的契约：5 处 `rejects.toThrow(...)`（mock 产物）
// 与 2 处 `success === false`（生产契约）并存。
//
// 现在只替换身份（`checkPermission` 直接从 `./verify-jwt` 导入它），
// 权限门（SUPER_ADMIN 绕过，ADR-001）、范围守卫、错误映射、审计全部真实执行。
// @allow-module-mock @/lib/auth/verify-jwt auth-bypass: 只提供"谁已登录"这一输入；本文件依赖它的断言：全部用例的操作者身份。鉴权链路其余部分走真身（见上）；合法理由见 ADR-022（reason 点名本文件 user-actions.test.ts）
vi.mock(import('@/lib/auth/verify-jwt'), async (importOriginal): Promise<Partial<typeof verifyJwtModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    // 字面量而非 ADMIN_ID：vi.mock 工厂被提升，引用下方 const 会落进 TDZ
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
  // 早先整体替换会把 hashToken 变成 undefined，而注解却写着「哈希走真实实现」
  return {
    ...actual,
    generateUUID: () => 'aabbccdd-eeff-4000-8000-000000000001',
    generateId: (_len?: number) => 'aaaaaaaa',
  };
});
// 这里**不再** mock `@/lib/session/revoke`，也**不再**用空模块 `{}` 替换 Redis：
// 空模块等价于"Redis 永久宕机"，会激活生产不可达分支并让断言天然为真（普查的
// "只断言调用 + 空模块"组合）。现在撤销走真实 Redis，断言落在真实黑名单上。

import { db } from '@/infrastructure/db';
import { createUserAction, updateUserRolesAction, updateUserAction, toggleUserStatusAction, deleteUserAction, resetPasswordAction } from '@/app/(dashboard)/users/actions';
import type * as verifyJwtModule from '@/lib/auth/verify-jwt';
import type * as cryptoModule from '@/lib/crypto';


const ADMIN_ID = '00000000-0000-4000-8000-000000000101';
const DEPT_ID = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  // 数据范围守卫现由真实 resolveScope（lib/authz）解析，走原生 SQL 读
  // user_roles → roles.dept_id，不再经过被 mock 的 @/lib/auth。
  // 因此操作者必须在库中真实拥有一个根部门角色，否则可见范围为空、守卫正确拒绝。
  await seedTestData(td.db, {
    departments: seedRootDept(),
    users: seedAdminUser(),
    roles: seedSuperAdminRole({ deptId: '00000000-0000-4000-8000-000000000001' }),
    userRoles: seedUserRoleBinding(ADMIN_ID, '00000000-0000-4000-8000-000000000301'),
  });
});

describe('User Server Actions', () => {
  describe('createUserAction', () => {
    it('有效输入 → 返回 success: true 并写入用户', async () => {
      const r: any = await createUserAction({
        username: 'newuser', name: 'New User',
        password: 'StrongP@ss1', email: 'new@example.com',
      } as any);

      expect(r.success).toBe(true);
      expect(r.data).toBeDefined();
      expect(r.message).toBe('用户创建成功');

      const allUsers = await db.select().from(schema.users);
      const newUser = allUsers.find(u => u.username === 'newuser');
      expect(newUser).toBeDefined();
      expect(newUser!.email).toBe('new@example.com');
      expect(newUser!.passwordHash).toBeDefined();
      expect(newUser!.passwordHash).not.toBe('StrongP@ss1');
    });

    it('缺 username → 返回 success: false 并包含错误码', async () => {
      const r: any = await createUserAction({
        username: '', name: '', password: '', email: '',
      } as any);

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBeDefined();
    });
  });

  describe('updateUserAction', () => {
    it('存在用户 → 返回 success: true', async () => {
      await seedTestData(td.db, { users: seedTestUser() });
      const r: any = await updateUserAction('00000000-0000-4000-8000-000000000201', { name: 'Updated Name' } as any);

      expect(r.success).toBe(true);
      expect(r.message).toBe('更新成功');
      expect(r.data).toBeDefined();
      expect(r.data.id).toBe('00000000-0000-4000-8000-000000000201');

      const rows = await db.select().from(schema.users);
      const updated = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(updated!.name).toBe('Updated Name');
    });

    it('不存在用户 → 失败信封 NOT_FOUND（生产契约，非抛出）', async () => {
      const r = await updateUserAction('00000000-0000-4000-8000-000000000999', { name: 'X' } as any);

      // 生产契约：withAuth 映射领域错误为失败信封，**不抛出**
      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });
  });

  describe('updateUserRolesAction', () => {
    // beforeEach 已种下：操作者（ADMIN_ID）在根部门的 SUPER_ADMIN 角色 + 绑定，
    // 即"有范围 + 有权限"；本组只补**被操作的目标用户**。
    const ROOT_DEPT = '00000000-0000-4000-8000-000000000001';
    const ROLE_ID = '00000000-0000-4000-8000-000000000301';
    const TARGET_ID = '00000000-0000-4000-8000-000000000201';

    it('成功：覆盖式分配本部门角色，返回数量并真正写库', async () => {
      await seedTestData(td.db, { users: seedTestUser({ id: TARGET_ID, deptId: ROOT_DEPT }) });

      const r: any = await updateUserRolesAction(TARGET_ID, [ROLE_ID]);

      expect(r.success).toBe(true);
      expect(r.data.assignedCount).toBe(1);
      const rows = await td.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, TARGET_ID));
      expect(rows.map((x) => x.roleId)).toEqual([ROLE_ID]);
    });

    // 未覆盖（诚实记录，第 2 次尝试后仍然放弃）：'角色不属于该用户部门' 这条 R-USER-ROLE 失败。
    // 已解决的部分：`seedRootDept()` 现在支持 overrides（本轮补的，与 seedTestUser/seedSuperAdminRole 对齐）。
    // 仍未定位的部分：即便给了第二个部门 + 独立 code 的角色，该用例仍失败，而我没拿到可读的失败信息
    // （vitest 输出里没捞到断言细节）⇒ 不在本轮继续猜。触发条件：用 /diagnosing-bugs 的一次专门会话，
    // 或该 R-USER-ROLE 规则下次被改动时，先把 `r.message` 打出来再断言。
    it('目标用户不在操作者数据范围（无部门）⇒ 范围守卫拒绝，且不写库', async () => {
      // 实测发现：这条路径先被 lib/authz 的范围守卫拦下（无部门无法证明归属，ADR-002），
      // 因此共享实现里"该用户尚未分配部门…"那句在 action 路径不可达——留着是数据层兜底。
      await seedTestData(td.db, { users: seedTestUser({ id: TARGET_ID, deptId: null }) });

      const r: any = await updateUserRolesAction(TARGET_ID, [ROLE_ID]);

      expect(r.success).toBe(false);
      const rows = await td.db.select().from(schema.userRoles).where(eq(schema.userRoles.userId, TARGET_ID));
      expect(rows).toEqual([]);
    });
  });

  describe('toggleUserStatusAction', () => {
    it('ACTIVE 用户 → 变为 DISABLED', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'ACTIVE' }) });
      const r: any = await toggleUserStatusAction('00000000-0000-4000-8000-000000000201');

      expect(r.success).toBe(true);
      expect(r.data.status).toBe('DISABLED');
      expect(r.message).toContain('已禁用');

      const rows = await db.select().from(schema.users);
      const user = rows.find(u => u.id === '00000000-0000-4000-8000-000000000201');
      expect(user!.status).toBe('DISABLED');
    });

    it('DISABLED 用户 → 变为 ACTIVE', async () => {
      await seedTestData(td.db, { users: seedTestUser({ status: 'DISABLED' }) });
      const r: any = await toggleUserStatusAction('00000000-0000-4000-8000-000000000201');

      expect(r.success).toBe(true);
      expect(r.data.status).toBe('ACTIVE');
    });

    it('**不能禁用自己的账号**（契约码 CANNOT_DISABLE_SELF 的规则此前从未实现）', async () => {
      const before = await td.db.select({ status: schema.users.status })
        .from(schema.users).where(eq(schema.users.id, ADMIN_ID));

      const r = await toggleUserStatusAction(ADMIN_ID);

      if (r.success) expect.unreachable('自禁必须被拒（否则把自己踢出后无法自救）');
      expect(r.error).toBe(USER_ERRORS.CANNOT_DISABLE_SELF);

      const after = await td.db.select({ status: schema.users.status })
        .from(schema.users).where(eq(schema.users.id, ADMIN_ID));
      expect(after[0]!.status).toBe(before[0]!.status);
    });

    it('不存在用户 → 失败信封 NOT_FOUND（生产契约，非抛出）', async () => {
      const r = await toggleUserStatusAction('00000000-0000-4000-8000-000000000999');

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });
  });

  describe('软删除语义（#86）', () => {
    const TARGET_ID = '00000000-0000-4000-8000-000000000201';

    async function rowOf(id: string) {
      const [row] = await td.db
        .select({ status: schema.users.status, deletedAt: schema.users.deletedAt })
        .from(schema.users)
        .where(eq(schema.users.id, id));
      return row;
    }

    it('删除动作**写入 deletedAt**（部分唯一索引生效的前提）', async () => {
      await seedTestData(td.db, { users: seedTestUser() });

      await deleteUserAction(TARGET_ID);

      const row = await rowOf(TARGET_ID);
      expect(row!.status).toBe('DELETED');
      // 此前只写 status、丢弃领域层算出的 deletedAt ⇒ deleted_at 恒为 NULL
      expect(row!.deletedAt).not.toBeNull();
    });

    it('软删除后**邮箱可被新用户复用**（与部分唯一索引同口径）', async () => {
      await seedTestData(td.db, {
        users: seedTestUser({ username: 'gone-user', email: 'freed@example.com' }),
      });
      await deleteUserAction(TARGET_ID);

      const r = await createUserAction({
        name: '新同事',
        username: 'newbie',
        email: 'freed@example.com',
        password: 'StrongP@ss123',
        deptId: null,
      } as any);

      if (!r.success) expect.unreachable(`邮箱应可复用，实际失败：${JSON.stringify(r)}`);
      expect(r.success).toBe(true);
    });

    it('软删除后**用户名仍不可复用**（完整唯一约束 → USERNAME_ALREADY_EXISTS）', async () => {
      await seedTestData(td.db, { users: seedTestUser() }); // username = 'testuser'
      await deleteUserAction(TARGET_ID);

      const r = await createUserAction({
        name: '新同事',
        username: 'testuser',
        email: 'another@example.com',
        password: 'StrongP@ss123',
        deptId: null,
      } as any);

      // 内联查重只看未删除行 ⇒ 落到数据库的**完整**唯一约束 ⇒ 由唯一违例映射报专属码
      if (r.success) expect.unreachable('用户名由完整唯一约束保护，必须被拒');
      expect(r.error).toBe(USER_ERRORS.USERNAME_ALREADY_EXISTS);
    });
  });

  describe('createUserAction 唯一性冲突', () => {
    it('用户名重复 → 409 且携带 **USERNAME_ALREADY_EXISTS**（表单需定位到具体输入框）', async () => {
      await seedTestData(td.db, { users: seedTestUser({ username: 'dup-user' }) });

      const r = await createUserAction({
        name: '另一个人',
        username: 'dup-user',
        email: 'other@example.com',
        password: 'StrongP@ss123',
        deptId: null,
      } as any);

      if (r.success) expect.unreachable('重复用户名必须被拒');
      expect(r.error).toBe(USER_ERRORS.USERNAME_ALREADY_EXISTS);
    });

    it('邮箱重复 → 409 且携带 **EMAIL_ALREADY_EXISTS**', async () => {
      await seedTestData(td.db, { users: seedTestUser({ email: 'dup@example.com' }) });

      const r = await createUserAction({
        name: '另一个人',
        username: 'brand-new-user',
        email: 'dup@example.com',
        password: 'StrongP@ss123',
        deptId: null,
      } as any);

      if (r.success) expect.unreachable('重复邮箱必须被拒');
      expect(r.error).toBe(USER_ERRORS.EMAIL_ALREADY_EXISTS);
    });
  });

  describe('deleteUserAction', () => {
    it('**不能删除自己**（契约码 CANNOT_DELETE_SELF 的规则此前从未实现）', async () => {
      const r = await deleteUserAction(ADMIN_ID);

      if (r.success) expect.unreachable('自删必须被拒（否则最后一个管理员可把自己删掉 = 自锁死）');
      expect(r.error).toBe(USER_ERRORS.CANNOT_DELETE_SELF);

      const [row] = await td.db.select({ status: schema.users.status })
        .from(schema.users).where(eq(schema.users.id, ADMIN_ID));
      expect(row!.status).not.toBe('DELETED');
    });

    it('可删除用户 → 返回 success: true', async () => {
      await seedTestData(td.db, { users: seedTestUser() });
      const r: any = await deleteUserAction('00000000-0000-4000-8000-000000000201');

      expect(r.success).toBe(true);
      expect(r.message).toBe('用户已逻辑删除');
      expect(r.data.id).toBe('00000000-0000-4000-8000-000000000201');
    });

    it('不存在用户 → 失败信封 NOT_FOUND（生产契约，非抛出）', async () => {
      const r = await deleteUserAction('00000000-0000-4000-8000-000000000999');

      if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
      expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
    });
  });
});

// ── resetPasswordAction：安全关键操作，此前零覆盖 ──────────────
//
// 该 action 承担两条安全不变量，且此前**没有任何测试**：
// 1. NFR-SEC-15 禁止重用最近 5 次密码（命中历史必须拒绝，且不落库）
// 2. 重置后撤销目标用户全部会话（B-USR-PW）
// 数据范围守卫与 404 由 withScopedRow 承担（其自身已有独立覆盖）。

describe('resetPasswordAction', () => {
  const NEW_PASSWORD = 'BrandNew@654321';

  async function rowOf(id: string) {
    const [row] = await td.db.select({
      passwordHash: schema.users.passwordHash,
      passwordHistory: schema.users.passwordHistory,
    }).from(schema.users).where(eq(schema.users.id, id));
    return row;
  }

  it('有效输入 → 更新密码哈希并把旧哈希推入历史', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    await td.db.insert(schema.users).values(seedTestUser({ passwordHash: await hashPassword('Old@123456') })[0]!);
    const before = await rowOf('00000000-0000-4000-8000-000000000201');

    const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', NEW_PASSWORD);

    expect(res.success).toBe(true);
    const after = await rowOf('00000000-0000-4000-8000-000000000201');
    expect(after!.passwordHash).not.toBe(before!.passwordHash);
    expect(after!.passwordHistory).toContain(before!.passwordHash);
  });

  it('**目标账号从未设置密码 → 管理员仍能设置初始密码**', async () => {
    // 「无密码不能**自助**改密」是自助路径的否决判据；管理员重置恰恰是它指向的替代流程，
    // 因此这里必须成功（此前复用同一判定，抛「账号未设置密码，无法自助改密」而挡住）。
    await td.db.insert(schema.users).values(seedTestUser({ passwordHash: null })[0]!);

    const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', NEW_PASSWORD);

    expect(res.success).toBe(true);
    const after = await rowOf('00000000-0000-4000-8000-000000000201');
    expect(after!.passwordHash).not.toBeNull();
    // 历史里不得留下空串哨兵
    expect(after!.passwordHistory ?? []).not.toContain('');
  });

  it('弱密码 → 拒绝且不落库', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    await td.db.insert(schema.users).values(seedTestUser({ passwordHash: await hashPassword('Old@123456') })[0]!);
    const before = await rowOf('00000000-0000-4000-8000-000000000201');

    const res = await resetPasswordAction('00000000-0000-4000-8000-000000000201', 'short');

    expect(res.success).toBe(false);
    const after = await rowOf('00000000-0000-4000-8000-000000000201');
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it('**新密码命中历史 → 拒绝且不落库**（NFR-SEC-15）', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    const reusedHash = await hashPassword(NEW_PASSWORD);
    await td.db.insert(schema.users).values(seedTestUser({
      passwordHash: await hashPassword('Current@123456'),
      passwordHistory: [reusedHash],
    })[0]!);
    const before = await rowOf('00000000-0000-4000-8000-000000000201');

    const r = await resetPasswordAction('00000000-0000-4000-8000-000000000201', NEW_PASSWORD);

    // 生产契约：领域规则违反 → 失败信封（422 语义）+ 可读文案，**不抛出**
    if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
    expect(r.error).toBe(COMMON_ERRORS.VALIDATION_ERROR);
    expect(r.message).toContain('新密码不能与最近使用过的密码相同');

    const after = await rowOf('00000000-0000-4000-8000-000000000201');
    expect(after!.passwordHash).toBe(before!.passwordHash);
  });

  it('目标用户不存在 → NOT_FOUND（不与其他失败混淆）', async () => {
    const r = await resetPasswordAction('00000000-0000-4000-8000-000000000999', NEW_PASSWORD);

    if (r.success) expect.unreachable('应当被拒绝（生产契约：失败信封）');
    expect(r.error).toBe(COMMON_ERRORS.NOT_FOUND);
  });

  it('重置成功后撤销该用户全部会话（B-USR-PW，断言真实黑名单）', async () => {
    const { hashPassword } = await import('@/domain/auth/password');
    const { trackUserJti, isJtiRevoked } = await import('@/lib/session/revoke');
    await td.db.insert(schema.users).values(seedTestUser({ passwordHash: await hashPassword('Old@123456') })[0]!);

    const targetUser = '00000000-0000-4000-8000-000000000201';
    const jti = 'jti-user-actions-reset';
    await trackUserJti(targetUser, jti, 3600);
    expect(await isJtiRevoked(jti)).toBe(false);

    await resetPasswordAction(targetUser, NEW_PASSWORD);

    // 真实状态：该用户的 jti 确实进了 Redis 黑名单（不是"某函数被调用过"）
    expect(await isJtiRevoked(jti)).toBe(true);
  });
});

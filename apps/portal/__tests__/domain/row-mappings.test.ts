/**
 * 行映射直测：`xToInsertRow` / `xToUpdateRow` / `xFromPersistence`
 *
 * ## 为什么单独一个文件，而不是塞进各实体的 domain 测试
 *
 * 这 5 份映射是**同一种**形状（机械的逐列「实体 ↔ 行」翻译），要钉住的也是**同一组**性质：
 * ①列清单完整 ②更新行不含不可变列 ③时间边界可回环。放在一张表里，
 * **新增实体时漏掉映射测试会一眼看出来**。
 *
 * ## 为什么这些测试重要（架构评审 R2 候选 R10 / R11 的实测发现）
 *
 * 这些函数此前**零直接测试**：5 个 domain 模块的 31 条用例全部只断言工厂与状态迁移，
 * 没有任何一例碰过行映射。而它们的失效方式是**静默**的：
 *
 * - **漏一列** ⇒ 用户输入被丢掉，不报错（例如 `userToInsertRow` 少了 `avatarUrl`）；
 * - **更新行多一列不可变列** ⇒ `.set()` 会覆写 PK / 创建时间 / 登录名；
 * - **时间边界写错** ⇒ 存进库的时间偏移（Temporal.Instant ↔ `Date` 是唯一转换点）。
 *
 * 端点测试覆盖不到这些：它们只走"实际用到的那些列"，而**列清单本身**没有断言。
 *
 * @req D-USR-C/U, D-ROLE-C/U, D-DEPT-C/U, D-CLI-C/U, D-PRM-C/U
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { CreateRoleInputSchema } from '@/domain/role/types';
import { CreateClientInputSchema } from '@/domain/client/types';
import { CreatePermissionInputSchema } from '@/domain/permission/types';
import { createUser, userFromPersistence, userToInsertRow, userToUpdateRow } from '@/domain/user/user';
import { createRole, roleFromPersistence, roleToInsertRow, roleToUpdateRow } from '@/domain/role/role';
import {
  createDepartment,
  departmentFromPersistence,
  departmentToInsertRow,
  departmentToUpdateRow,
} from '@/domain/department/department';
import { createClient, clientFromPersistence, clientToInsertRow, clientToUpdateRow } from '@/domain/client/client';
import {
  createPermission,
  permissionFromPersistence,
  permissionToInsertRow,
  permissionToUpdateRow,
} from '@/domain/permission/permission';
import { dateFromInstant } from '@/domain/shared/time';

/** 断言行对象的键**恰好**是这些（多一列少一列都要红） */
function expectExactKeys(row: Record<string, unknown>, keys: readonly string[]): void {
  expect(Object.keys(row).sort()).toEqual([...keys].sort());
}

const ID = '00000000-0000-4000-8000-0000000000ff';
const DEPT_ID = '00000000-0000-4000-8000-00000000000a';
const idGen = () => ID;
const FIXED = 1_700_000_000_000; // 固定 epoch，避免时区/此刻影响

describe('user 行映射', () => {
  const user = createUser(
    { name: '王小二', username: 'wangxiaoer', email: 'wang@example.com', password: 'x'.repeat(12), deptId: DEPT_ID },
    idGen,
  );

  it('insert 行：列清单完整（漏列 = 静默丢输入）', () => {
    const row = userToInsertRow(user);

    expectExactKeys(row, [
      'id', 'username', 'email', 'name', 'avatarUrl', 'status', 'deptId',
      'deletedAt', 'passwordChangedAt', 'createdAt',
    ]);
    expect(row.username).toBe('wangxiaoer');
    expect(row.deptId).toBe(DEPT_ID);
    // 时间边界：实体持 Temporal.Instant，行持 Date，且是同一时刻
    expect(row.createdAt).toBeInstanceOf(Date);
    expect((row.createdAt as Date).getTime()).toBe(user.createdAt.epochMilliseconds);
    // 新建用户没有删除/改密时间
    expect(row.deletedAt).toBeNull();
    expect(row.passwordChangedAt).toBeNull();
  });

  it('update 行：**不含不可变列**（id / username / createdAt 不得被覆写）', () => {
    const row = userToUpdateRow(user);

    expectExactKeys(row, [
      'name', 'email', 'avatarUrl', 'status', 'deptId', 'deletedAt', 'passwordChangedAt',
    ]);
  });

  it('fromPersistence：Date → Temporal.Instant，null 保持 null', () => {
    const restored = userFromPersistence({
      ...user,
      deletedAt: new Date(FIXED),
      passwordChangedAt: null,
      createdAt: new Date(FIXED),
    });

    expect(restored.createdAt.epochMilliseconds).toBe(FIXED);
    expect(restored.deletedAt?.epochMilliseconds).toBe(FIXED);
    expect(restored.passwordChangedAt).toBeNull();
  });
});

describe('role 行映射', () => {
  const role = createRole(
    CreateRoleInputSchema.parse({ name: '管理员', code: 'ADMIN', deptId: DEPT_ID, sort: 0 }),
    idGen,
  );

  it('insert 行：列清单完整', () => {
    const row = roleToInsertRow(role);

    expectExactKeys(row, [
      'id', 'name', 'code', 'description', 'deptId', 'isSystem', 'sort', 'status', 'createdAt',
    ]);
    expect((row.createdAt as Date).getTime()).toBe(role.createdAt.epochMilliseconds);
  });

  it('update 行：不含 id / code / isSystem / createdAt', () => {
    expectExactKeys(roleToUpdateRow(role), ['name', 'description', 'deptId', 'sort', 'status']);
  });

  it('fromPersistence：Date → Instant', () => {
    const restored = roleFromPersistence({ ...role, createdAt: new Date(FIXED) });
    expect(restored.createdAt.epochMilliseconds).toBe(FIXED);
  });
});

describe('department 行映射', () => {
  const dept = createDepartment({ name: '技术部', sort: 1 }, idGen, null);

  it('insert 行：列清单完整（含物化路径 ancestors）', () => {
    const row = departmentToInsertRow(dept);

    expectExactKeys(row, ['id', 'name', 'code', 'parentId', 'ancestors', 'sort', 'status', 'createdAt']);
    expect(row.parentId).toBeNull();
    expect(row.ancestors).toBeNull();
  });

  it('update 行：不含 id / status / createdAt', () => {
    expectExactKeys(departmentToUpdateRow(dept), ['name', 'code', 'parentId', 'ancestors', 'sort', 'status']);
  });

  it('fromPersistence：Date → Instant', () => {
    const restored = departmentFromPersistence({ ...dept, createdAt: new Date(FIXED) });
    expect(restored.createdAt.epochMilliseconds).toBe(FIXED);
  });
});

describe('client 行映射', () => {
  const client = createClient(
    CreateClientInputSchema.parse({ name: '测试应用', redirectUris: ['https://rp.example.com/cb'], scopes: 'openid' }),
    () => 'client-1',
    () => 'secret-hex',
  );

  it('insert 行：列清单完整（含两个 TTL）', () => {
    const row = clientToInsertRow(client);

    expectExactKeys(row, [
      'clientId', 'name', 'redirectUris', 'scopes', 'homepageUrl', 'logoUrl',
      'accessTokenTtl', 'refreshTokenTtl', 'status', 'createdAt',
    ]);
    expect(row.clientId).toBe('client-1');
    expect(row.redirectUris).toEqual(['https://rp.example.com/cb']);
  });

  it('update 行：不含 clientId / createdAt（**client_id 不可改**）', () => {
    expectExactKeys(clientToUpdateRow(client), [
      'name', 'redirectUris', 'scopes', 'homepageUrl', 'logoUrl',
      'accessTokenTtl', 'refreshTokenTtl', 'status',
    ]);
  });

  it('fromPersistence：Date → Instant', () => {
    const restored = clientFromPersistence({ ...client, createdAt: new Date(FIXED) });
    expect(restored.createdAt.epochMilliseconds).toBe(FIXED);
  });
});

describe('permission 行映射', () => {
  const perm = createPermission(
    CreatePermissionInputSchema.parse({ name: '用户列表', code: 'portal:user:list', type: 'API' }),
    idGen,
  );

  it('insert 行：列清单完整', () => {
    const row = permissionToInsertRow(perm);

    expectExactKeys(row, [
      'id', 'name', 'code', 'type', 'description', 'path', 'icon', 'visible',
      'clientId', 'parentId', 'sort', 'status', 'createdAt',
    ]);
    expect(row.code).toBe('portal:user:list');
    // 未指定 visible 时实体持 null（不是 false/true）——映射必须原样带过去
    expect(perm.visible).toBeNull();
    expect(row.visible).toBeNull();

    // 显式指定时透传（证明它不是被硬编码）
    const withVisible = createPermission(
      CreatePermissionInputSchema.parse({ name: '菜单', code: 'portal:menu:view', type: 'DIRECTORY', visible: true }),
      idGen,
    );
    expect(permissionToInsertRow(withVisible).visible).toBe(true);
  });

  it('update 行：不含 id / createdAt', () => {
    expectExactKeys(permissionToUpdateRow(perm), [
      'name', 'code', 'type', 'description', 'path', 'icon', 'visible',
      'clientId', 'parentId', 'sort', 'status',
    ]);
  });

  it('fromPersistence：Date → Instant', () => {
    const restored = permissionFromPersistence({ ...perm, createdAt: new Date(FIXED) });
    expect(restored.createdAt.epochMilliseconds).toBe(FIXED);
  });
});

describe('时间边界（5 个实体共用同一转换）', () => {
  it('dateFromInstant 与实体持有的 Instant 是同一时刻（时区无关）', () => {
    const user = createUser(
      { name: 'A', username: 'a', email: 'a@example.com', password: 'x'.repeat(12), deptId: null },
      idGen,
    );

    expect(dateFromInstant(user.createdAt).getTime()).toBe(user.createdAt.epochMilliseconds);
  });
});

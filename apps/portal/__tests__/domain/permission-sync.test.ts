/**
 * `permission-sync` 领域函数的直测（纯函数）
 *
 * ## 为什么补这个文件（#ADR-019 待修热点）
 *
 * 这些函数此前**没有直测**：`flattenPermissions` / `getHashCode` / `findDuplicateCode`
 * 只被"整条 `/api/permissions/register` 能跑通"间接覆盖。而本轮把路由里内联的
 * 行整形与"是否变更"判定也搬到这里（复杂度 29 → 纯函数）——
 * **搬进来的同时必须带上直测**，否则只是把不可测的代码换了个位置。
 */
import { describe, expect, it } from 'vitest';
import {
  findDuplicateCode,
  flattenPermissions,
  getHashCode,
  permissionRowChanged,
  toPermissionInsertRow,
  toPermissionUpdateRow,
  type ExistingPermissionRow,
  type FlatPermission,
} from '@/domain/permission/permission-sync';

const flat = (over: Partial<FlatPermission> = {}): FlatPermission => ({
  code: 'c',
  name: '名称',
  type: 'API',
  path: undefined,
  icon: undefined,
  visible: undefined,
  sort: 1,
  parentId: null,
  ...over,
});

const existing = (over: Partial<ExistingPermissionRow> = {}): ExistingPermissionRow => ({
  id: 'p-1',
  parentId: null,
  name: '名称',
  type: 'API',
  path: null,
  icon: null,
  visible: null,
  sort: 1,
  status: 'ACTIVE',
  ...over,
});

describe('flattenPermissions', () => {
  it('展平并给出父子关系；sort 缺省为 0', () => {
    const rows = flattenPermissions([
      {
        code: 'dir',
        name: '目录',
        type: 'DIRECTORY',
        children: [{ code: 'child', name: '子项', type: 'API' }],
      },
    ]);

    expect(rows.map((r) => [r.code, r.parentId, r.sort])).toEqual([
      ['dir', null, 0],
      ['child', 'dir', 0],
    ]);
  });

  it('没有 children 时不递归', () => {
    expect(flattenPermissions([{ code: 'a', name: 'a', type: 'PAGE', sort: 3 }])).toHaveLength(1);
  });
});

describe('getHashCode', () => {
  it('确定性 + 非负（供 Advisory Lock 用）', () => {
    expect(getHashCode('client-a')).toBe(getHashCode('client-a'));
    expect(getHashCode('client-a')).toBeGreaterThanOrEqual(0);
    expect(getHashCode('client-a')).not.toBe(getHashCode('client-b'));
  });

  it('相同前缀不同后缀不碰撞（最小验证）', () => {
    expect(getHashCode('abc')).not.toBe(getHashCode('abd'));
  });
});

describe('findDuplicateCode', () => {
  it('返回首个重复项；无重复返回 null', () => {
    expect(findDuplicateCode(['a', 'b', 'a'])).toBe('a');
    expect(findDuplicateCode(['a', 'b'])).toBeNull();
    expect(findDuplicateCode([])).toBeNull();
  });
});

describe('permissionRowChanged', () => {
  it('完全等价（含"上报缺省 vs 库里 null"的归一化）⇒ 不变更', () => {
    expect(permissionRowChanged(existing(), flat(), null)).toBe(false);
  });

  it('逐字段：任一处不同都算变更', () => {
    const cases: Array<[string, ExistingPermissionRow, FlatPermission, string | null]> = [
      ['parentId', existing(), flat(), 'p-parent'],
      ['name', existing({ name: '旧' }), flat({ name: '新' }), null],
      ['type', existing({ type: 'PAGE' }), flat(), null],
      ['path', existing({ path: '/old' }), flat({ path: '/new' }), null],
      ['icon', existing({ icon: 'old' }), flat({ icon: 'new' }), null],
      ['visible', existing({ visible: true }), flat({ visible: false }), null],
      ['sort', existing({ sort: 9 }), flat(), null],
      ['status', existing({ status: 'DISABLED' }), flat(), null],
    ];

    for (const [what, row, incoming, parentId] of cases) {
      expect(permissionRowChanged(row, incoming, parentId), `字段 ${what} 变更未被识别`).toBe(true);
    }
  });
});

describe('toPermissionInsertRow', () => {
  it('缺省字段归一化为 null；补齐 id/clientId/status/createdAt', () => {
    const now = new Date('2026-10-15T00:00:00Z');
    const row = toPermissionInsertRow(flat(), { id: 'new-id', clientId: 'client-a', parentId: 'p-0', now });

    expect(row).toEqual({
      id: 'new-id',
      name: '名称',
      code: 'c',
      type: 'API',
      path: null,
      icon: null,
      visible: null,
      clientId: 'client-a',
      parentId: 'p-0',
      sort: 1,
      status: 'ACTIVE',
      createdAt: now,
    });
  });
});

describe('toPermissionUpdateRow', () => {
  it('parentId 未变时不写该字段（避免无谓写）', () => {
    const row = toPermissionUpdateRow(flat(), { parentId: 'p-1', parentChanged: false });

    expect('parentId' in row).toBe(false);
    expect(row).toEqual({
      name: '名称',
      type: 'API',
      path: null,
      icon: null,
      visible: null,
      sort: 1,
      status: 'ACTIVE',
    });
  });

  it('parentId 变了才写', () => {
    const row = toPermissionUpdateRow(flat(), { parentId: 'p-2', parentChanged: true });

    expect(row.parentId).toBe('p-2');
  });
});

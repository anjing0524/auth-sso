/**
 * @req D-MEN-C, D-MEN-U, D-MEN-D
 */
import { describe, it, expect } from 'vitest';
import {
  createMenu,
  applyMenuUpdate,
  buildMenuTree,
  toDomainMenu,
} from '@/domain/menu/menu';
import { CreateMenuInputSchema } from '@/domain/menu/types';

const mockIdGen = () => 'menu_id_12345';

describe('Menu 领域核心规则', () => {
  it('应通过工厂函数创建默认类型 MENU 的菜单', () => {
    const input = CreateMenuInputSchema.parse({ name: '仪表盘', path: '/dashboard' });
    const menu = createMenu(input, mockIdGen);
    expect(menu.status).toBe('ACTIVE');
    expect(menu.menuType).toBe('MENU');
    expect(menu.visible).toBe(true);
  });

  it('应支持创建 DIRECTORY 类型', () => {
    const input = CreateMenuInputSchema.parse({ name: '系统管理', menuType: 'DIRECTORY' });
    const menu = createMenu(input, mockIdGen);
    expect(menu.menuType).toBe('DIRECTORY');
    expect(menu.path).toBeNull();
  });

  it('applyMenuUpdate 应正确 merge 字段', () => {
    const input = CreateMenuInputSchema.parse({ name: '旧名称', path: '/old' });
    const menu = createMenu(input, mockIdGen);
    const updated = applyMenuUpdate(menu, { name: '新名称', visible: false });
    expect(updated.name).toBe('新名称');
    expect(updated.visible).toBe(false);
    expect(updated.path).toBe('/old');
  });

  it('buildMenuTree 应正确构建树并按 sort 排序', () => {
    const menus = [
      createMenu(CreateMenuInputSchema.parse({ name: '根菜单', sort: 0 }), () => 'root_id'),
      createMenu(CreateMenuInputSchema.parse({ name: '子菜单A', parentId: 'root_id', sort: 2 }), () => 'child_a'),
      createMenu(CreateMenuInputSchema.parse({ name: '子菜单B', parentId: 'root_id', sort: 1 }), () => 'child_b'),
    ];
    const tree = buildMenuTree(menus);
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe('根菜单');
    expect(tree[0].children).toHaveLength(2);
    // 按 sort 排序：B(1) 在前，A(2) 在后
    expect(tree[0].children[0].name).toBe('子菜单B');
    expect(tree[0].children[1].name).toBe('子菜单A');
  });

  it('toDomainMenu 应正确转换 DB 行', () => {
    const row = {
      id: 'id1', publicId: 'pub1', parentId: 'parent1',
      name: '用户管理', path: '/users', permissionCode: 'user:list',
      icon: 'Users', visible: true, sort: 10,
      menuType: 'MENU' as any, status: 'ACTIVE' as any,
      createdAt: new Date('2025-01-01'),
    };
    const menu = toDomainMenu(row);
    expect(menu.name).toBe('用户管理');
    expect(menu.path).toBe('/users');
    expect(menu.menuType).toBe('MENU');
    expect(menu.visible).toBe(true);
  });
});

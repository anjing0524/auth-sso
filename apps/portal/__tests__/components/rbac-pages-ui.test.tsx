/**
 * RBAC 页面级 UI/UX 修复回归（task-15 / F6）
 *
 * 覆盖 `.ui-audit/report.md` 中归属 RBAC 三页的条目（先红后绿）：
 * - U-G02 空态：roles/permissions 搜索/筛选空态 → `EmptyState kind="filtered"` + clearAction；
 *   permissions「目录」页签 0 条不再显示“暂无权限 + 新建权限”。
 * - U-G03 label 关联：角色/权限/部门 新建/编辑对话框 Label htmlFor + 输入 id。
 * - U-ROLES02 / U-G06：对话框 Enter 提交（与用户对话框一致）。
 * - U-ROLES03 / U-DEP05：删除确认展示受影响用户数 / 子部门·用户·角色数量。
 * - U-DEP01：390px 行操作可换行、名称有最小宽度（不被裁切/竖排）。
 * - U-DEP02：搜索态祖先行只作路径展示，隐藏编辑/删除。
 * - U-DEP03：非空树工具栏补“新建部门”入口（默认挂根部门）。
 * - U-PRM03 / U-G11：术语统一（权限/接口/页面/目录）+ 行内 aria-label 区分对象。
 * - U-G09：roles/permissions/departments 页面 metadata title（对齐 /users）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ── 框架替身（非生产业务模块，无需 @allow-module-mock） ──────────
vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn(), message: vi.fn() },
}));

const { mockPermissions } = vi.hoisted(() => ({
  mockPermissions: {
    loading: false,
    hasPermission: () => true,
    hasRole: () => true,
    isAdmin: () => true,
    roles: [] as Array<{ id: string; code: string; name: string }>,
    permissions: [] as string[],
  },
}));
// @allow-module-mock @/hooks/use-permissions infra-boundary: 权限 hook 只提供“已授权”这一输入；真实判定由 permission-enforcement 覆盖（依赖它的断言：rbac-pages-ui.test.tsx 全部用例的按钮可见性）
vi.mock(import('@/hooks/use-permissions'), async (importOriginal): Promise<Partial<typeof usePermissionsModule>> => {
  const actual = await importOriginal();
  return { ...actual, usePermissions: () => mockPermissions };
});

const { roleActions } = vi.hoisted(() => ({
  roleActions: {
    createRoleAction: vi.fn(async (_input: unknown) => ({ success: true as const, data: { id: 'role-new' }, message: '角色创建成功' })),
    updateRoleAction: vi.fn(async () => ({ success: true as const, data: { id: 'role-1' }, message: '角色更新成功' })),
    deleteRoleAction: vi.fn(async () => ({ success: true as const, data: { id: 'role-1' }, message: '角色已删除' })),
  },
}));
// @allow-module-mock @/app/(dashboard)/roles/actions infra-boundary: Server Action 替身为可控返回，断言点在 UI（Enter 提交/影响面/aria）；真实写路径由 role-actions/role-api 测试覆盖
vi.mock(import('@/app/(dashboard)/roles/actions'), async (importOriginal): Promise<Partial<typeof roleActionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    createRoleAction: roleActions.createRoleAction as unknown as typeof roleActionsModule.createRoleAction,
    updateRoleAction: roleActions.updateRoleAction as unknown as typeof roleActionsModule.updateRoleAction,
    deleteRoleAction: roleActions.deleteRoleAction as unknown as typeof roleActionsModule.deleteRoleAction,
  };
});

const { permissionActions } = vi.hoisted(() => ({
  permissionActions: {
    createPermissionAction: vi.fn(async (_input: unknown) => ({ success: true as const, data: { id: 'perm-new' }, message: '权限创建成功' })),
    updatePermissionAction: vi.fn(async () => ({ success: true as const, data: { id: 'perm-1' }, message: '权限更新成功' })),
    deletePermissionAction: vi.fn(async () => ({ success: true as const, data: { id: 'perm-1' }, message: '权限已删除' })),
  },
}));
// @allow-module-mock @/app/(dashboard)/permissions/actions infra-boundary: Server Action 替身为可控返回，断言点在 UI（Enter 提交/术语）；真实写路径由 permission-actions/permission-api 测试覆盖
vi.mock(import('@/app/(dashboard)/permissions/actions'), async (importOriginal): Promise<Partial<typeof permissionActionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    createPermissionAction: permissionActions.createPermissionAction as unknown as typeof permissionActionsModule.createPermissionAction,
    updatePermissionAction: permissionActions.updatePermissionAction as unknown as typeof permissionActionsModule.updatePermissionAction,
    deletePermissionAction: permissionActions.deletePermissionAction as unknown as typeof permissionActionsModule.deletePermissionAction,
  };
});

const { departmentActions } = vi.hoisted(() => ({
  departmentActions: {
    createDepartmentAction: vi.fn(async (_input: unknown) => ({ success: true as const, data: { id: 'dept-new' }, message: '部门创建成功' })),
    updateDepartmentAction: vi.fn(async () => ({ success: true as const, data: { id: 'dept-1' }, message: '部门更新成功' })),
    deleteDepartmentAction: vi.fn(async () => ({ success: true as const, data: { id: 'dept-1' }, message: '部门已删除' })),
  },
}));
// @allow-module-mock @/app/(dashboard)/departments/actions infra-boundary: Server Action 替身为可控返回，断言点在 UI（Enter 提交/影响面/响应式）；真实写路径由 department-actions/department-api 测试覆盖
vi.mock(import('@/app/(dashboard)/departments/actions'), async (importOriginal): Promise<Partial<typeof departmentActionsModule>> => {
  const actual = await importOriginal();
  return {
    ...actual,
    createDepartmentAction: departmentActions.createDepartmentAction as unknown as typeof departmentActionsModule.createDepartmentAction,
    updateDepartmentAction: departmentActions.updateDepartmentAction as unknown as typeof departmentActionsModule.updateDepartmentAction,
    deleteDepartmentAction: departmentActions.deleteDepartmentAction as unknown as typeof departmentActionsModule.deleteDepartmentAction,
  };
});

import RolesTable from '@/app/(dashboard)/roles/components/RolesTable';
import PermissionsTable from '@/app/(dashboard)/permissions/components/PermissionsTable';
import PermissionForm from '@/app/(dashboard)/permissions/permission-form';
import DepartmentTree from '@/app/(dashboard)/departments/components/DepartmentTree';
import type * as usePermissionsModule from '@/hooks/use-permissions';
import type * as roleActionsModule from '@/app/(dashboard)/roles/actions';
import type * as permissionActionsModule from '@/app/(dashboard)/permissions/actions';
import type * as departmentActionsModule from '@/app/(dashboard)/departments/actions';

// ── 夹具 ───────────────────────────────────────────
const DEPT_ROOT = { id: '00000000-0000-4000-8000-000000000001', name: '总公司' };
const DEPARTMENTS = [DEPT_ROOT];

const ROLE = {
  id: '00000000-0000-4000-8000-000000000901',
  name: '研发管理员',
  code: 'RND_ADMIN',
  description: null,
  deptId: DEPT_ROOT.id,
  isSystem: false,
  status: 'ACTIVE',
  sort: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const PERMISSION_API = {
  id: '00000000-0000-4000-8000-000000000911',
  name: '用户列表',
  code: 'portal:user:list',
  type: 'API',
  status: 'ACTIVE',
  description: null,
  path: null,
  icon: null,
  visible: null,
  parentId: null,
  sort: 0,
  createdAt: '2026-10-01T00:00:00.000Z',
};

const PERMISSION_PAGE = {
  ...PERMISSION_API,
  id: '00000000-0000-4000-8000-000000000912',
  name: '用户管理',
  code: 'portal:menu:users',
  type: 'PAGE',
  path: '/users',
  visible: true,
};

const TREE = [
  {
    id: '00000000-0000-4000-8000-000000000001',
    parentId: null,
    name: '总公司',
    code: 'ROOT',
    sort: 0,
    status: 'ACTIVE',
    children: [
      {
        id: '00000000-0000-4000-8000-000000000002',
        parentId: '00000000-0000-4000-8000-000000000001',
        name: '技术部',
        code: 'TECH',
        sort: 0,
        status: 'ACTIVE',
        children: [
          {
            id: '00000000-0000-4000-8000-000000000003',
            parentId: '00000000-0000-4000-8000-000000000002',
            name: '前端组',
            code: 'FE',
            sort: 0,
            status: 'ACTIVE',
            children: [],
          },
        ],
      },
    ],
  },
];

const PAGINATION = (total: number) => ({ page: 1, pageSize: 10, total, totalPages: Math.max(1, Math.ceil(total / 10)) });

function renderRoles(overrides: Partial<React.ComponentProps<typeof RolesTable>> = {}) {
  return render(
    <RolesTable
      roles={[]}
      pagination={PAGINATION(0)}
      initialKeyword=""
      departments={DEPARTMENTS}
      boundUserCounts={{}}
      {...overrides}
    />,
  );
}

function renderPermissions(overrides: Partial<React.ComponentProps<typeof PermissionsTable>> = {}) {
  return render(
    <PermissionsTable
      permissions={[]}
      pagination={PAGINATION(0)}
      activeTab="ALL"
      initialKeyword=""
      menuOptions={[]}
      {...overrides}
    />,
  );
}

function renderDepartments(overrides: Partial<React.ComponentProps<typeof DepartmentTree>> = {}) {
  return render(<DepartmentTree departments={TREE} deletionStats={{}} {...overrides} />);
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════
// U-G02 空态：筛选/搜索无结果 vs 真正无数据
// ═══════════════════════════════════════════════════
describe('U-G02 空态语义', () => {
  it('roles 搜索无结果：filtered 空态 + 清除搜索，不再引导新建', () => {
    const { container } = renderRoles({ roles: [], initialKeyword: 'zzz-no-role' });

    expect(container.querySelector('[data-empty-kind="filtered"]')).toBeTruthy();
    expect(screen.getByText('未找到匹配结果')).toBeInTheDocument();
    const clear = screen.getByRole('link', { name: '清除搜索' });
    expect(clear).toHaveAttribute('href', '/roles');
    expect(screen.queryByText('创建角色以开始管理权限')).not.toBeInTheDocument();
  });

  it('roles 真正无数据：empty 空态 + 新建 CTA', () => {
    const { container } = renderRoles({ roles: [] });
    expect(container.querySelector('[data-empty-kind="empty"]')).toBeTruthy();
    expect(screen.getByText('暂无角色')).toBeInTheDocument();
    expect(screen.getByText('创建角色以开始管理权限')).toBeInTheDocument();
  });

  it('permissions「目录」页签 0 条：filtered 空态 + 查看全部，不再显示“暂无权限+新建权限”', () => {
    const { container } = renderPermissions({ activeTab: 'DIRECTORY', permissions: [] });

    expect(container.querySelector('[data-empty-kind="filtered"]')).toBeTruthy();
    expect(screen.getByText('未找到匹配结果')).toBeInTheDocument();
    const clear = screen.getByRole('link', { name: '查看全部' });
    expect(clear).toHaveAttribute('href', '/permissions');
    expect(screen.queryByText('新增权限点以控制功能访问')).not.toBeInTheDocument();
    expect(screen.queryByText('暂无权限')).not.toBeInTheDocument();
  });

  it('permissions 无筛选且无数据：empty 空态 + 新建权限 CTA（术语统一）', () => {
    const { container } = renderPermissions({ permissions: [] });
    expect(container.querySelector('[data-empty-kind="empty"]')).toBeTruthy();
    expect(screen.getByText('暂无权限')).toBeInTheDocument();
    expect(screen.getAllByText('新建权限').length).toBeGreaterThan(0);
    expect(screen.queryByText('新建权限/菜单')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════
// U-G03 Label 关联
// ═══════════════════════════════════════════════════
describe('U-G03 对话框 Label 关联', () => {
  it('roles 新建/编辑对话框：getByLabelText 可定位名称/编码/部门', async () => {
    const user = userEvent.setup();
    renderRoles({ roles: [ROLE], pagination: PAGINATION(1) });

    await user.click(screen.getByRole('button', { name: '新建角色' }));
    expect(screen.getByLabelText('角色名称')).toBeInTheDocument();
    expect(screen.getByLabelText('角色编码')).toBeInTheDocument();
    expect(screen.getByLabelText('所属部门')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    await user.click(screen.getByRole('button', { name: `编辑角色 ${ROLE.name}` }));
    expect(screen.getByLabelText('角色名称')).toBeInTheDocument();
    expect(screen.getByLabelText('角色编码')).toHaveAttribute('disabled');
    expect(screen.getByLabelText('所属部门')).toBeInTheDocument();
  });

  it('permissions 新建/编辑改为页面：列表不再打开弹窗，入口指向独立路由', () => {
    renderPermissions({ permissions: [PERMISSION_PAGE], pagination: PAGINATION(1), menuOptions: [PERMISSION_PAGE] });

    // 2026-10-23 规则：弹窗不允许滚动；页面/目录类型 8 字段在 600px 视口放不下 → 独立页面
    const newLink = screen.getByRole('link', { name: /新建权限/ });
    expect(newLink).toHaveAttribute('href', '/permissions/new?returnTo=%2Fpermissions');
    const editLink = screen.getByRole('link', { name: `编辑权限 ${PERMISSION_PAGE.name}` });
    expect(editLink.getAttribute('href')).toBe(`/permissions/${PERMISSION_PAGE.id}/edit?returnTo=%2Fpermissions`);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('permissions 表单页：菜单专属字段 label 关联、编辑态编码只读', () => {
    render(
      <PermissionForm
        mode="edit"
        menuOptions={[{ id: PERMISSION_PAGE.id, name: PERMISSION_PAGE.name, type: PERMISSION_PAGE.type, parentId: null }]}
        permission={{ ...PERMISSION_PAGE, code: PERMISSION_PAGE.code }}
      />,
    );
    expect(screen.getByLabelText('权限名称')).toBeInTheDocument();
    expect(screen.getByLabelText('父级权限')).toBeInTheDocument();
    expect(screen.getByLabelText(/路由路径/)).toBeInTheDocument();
    expect(screen.getByLabelText('图标')).toBeInTheDocument();
    expect(screen.getByLabelText('排序')).toBeInTheDocument();
    // H-19：编码创建后不可变更 → 只读 disabled 输入，而不是“不存在”
    expect(screen.getByLabelText(/权限编码/)).toBeDisabled();
  });

  it('departments 新建/编辑对话框：getByLabelText 可定位名称/编码', async () => {
    const user = userEvent.setup();
    renderDepartments();

    await user.click(screen.getByRole('button', { name: '新建部门' }));
    expect(screen.getByLabelText('部门名称')).toBeInTheDocument();
    expect(screen.getByLabelText('部门编码')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '取消' }));

    await user.click(screen.getByRole('button', { name: `编辑部门 ${TREE[0]!.children[0]!.name}` }));
    expect(screen.getByLabelText('部门名称')).toBeInTheDocument();
    expect(screen.getByLabelText('部门编码')).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════
// U-ROLES02 / U-G06 对话框 Enter 提交
// ═══════════════════════════════════════════════════
describe('U-ROLES02/U-G06 对话框 Enter 提交', () => {
  it('roles 新建对话框：输入框内 Enter 触发 createRoleAction（与用户对话框一致）', async () => {
    const user = userEvent.setup();
    renderRoles({ roles: [ROLE], pagination: PAGINATION(1) });

    await user.click(screen.getByRole('button', { name: '新建角色' }));
    await user.type(screen.getByLabelText('角色名称'), '新角色');
    await user.type(screen.getByLabelText('角色编码'), 'NEW_ROLE{Enter}');

    await vi.waitFor(() => expect(roleActions.createRoleAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(roleActions.createRoleAction).mock.calls[0]![0]).toMatchObject({
      name: '新角色', code: 'NEW_ROLE', deptId: DEPT_ROOT.id,
    });
  });

  it('permissions 表单页：输入框内 Enter 触发 createPermissionAction', async () => {
    const user = userEvent.setup();
    render(<PermissionForm mode="create" menuOptions={[]} />);

    await user.type(screen.getByLabelText('权限名称'), '新接口权限');
    await user.type(screen.getByLabelText(/权限编码/), 'portal:qa:new{Enter}');

    await vi.waitFor(() => expect(permissionActions.createPermissionAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(permissionActions.createPermissionAction).mock.calls[0]![0]).toMatchObject({
      name: '新接口权限', code: 'portal:qa:new', type: 'API',
    });
  });

  it('departments 工具栏新建：Enter 触发 createDepartmentAction（默认挂根部门）', async () => {
    const user = userEvent.setup();
    renderDepartments();

    await user.click(screen.getByRole('button', { name: '新建部门' }));
    await user.type(screen.getByLabelText('部门名称'), '新部门{Enter}');

    await vi.waitFor(() => expect(departmentActions.createDepartmentAction).toHaveBeenCalledTimes(1));
    expect(vi.mocked(departmentActions.createDepartmentAction).mock.calls[0]![0]).toMatchObject({
      name: '新部门', parentId: TREE[0]!.id,
    });
  });
});

// ═══════════════════════════════════════════════════
// U-ROLES03 / U-DEP05 危险操作影响面
// ═══════════════════════════════════════════════════
describe('U-ROLES03/U-DEP05 删除确认展示影响面', () => {
  it('roles 删除确认展示受影响用户数', async () => {
    const user = userEvent.setup();
    renderRoles({
      roles: [ROLE],
      pagination: PAGINATION(1),
      boundUserCounts: { [ROLE.id]: 3 },
    });

    await user.click(screen.getByRole('button', { name: `删除角色 ${ROLE.name}` }));
    expect(screen.getByText(/3 个用户/)).toBeInTheDocument();
    expect(screen.getAllByText(/权限绑定/).length).toBeGreaterThan(0);
  });

  it('departments 删除确认展示子部门/用户/角色数量', async () => {
    const user = userEvent.setup();
    const TECH_ID = '00000000-0000-4000-8000-000000000002';
    renderDepartments({
      deletionStats: { [TECH_ID]: { childCount: 1, userCount: 2, roleCount: 1 } },
    });

    await user.click(screen.getByRole('button', { name: '删除部门 技术部' }));
    expect(screen.getByText(/子部门 1 个/)).toBeInTheDocument();
    expect(screen.getByText(/用户 2 人/)).toBeInTheDocument();
    expect(screen.getByText(/角色 1 个/)).toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════
// U-DEP01 390px 行布局
// ═══════════════════════════════════════════════════
describe('U-DEP01 部门行响应式', () => {
  it('行容器允许换行 + 名称最小宽度（390px 不裁切、不逐字竖排）', () => {
    const { container } = renderDepartments();
    const rows = container.querySelectorAll('[data-dept-row]');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.className).toContain('flex-wrap');
      const name = row.querySelector('[data-dept-name]');
      expect(name?.className ?? '').toContain('min-w-');
    }
  });
});

// ═══════════════════════════════════════════════════
// U-DEP02 搜索态祖先行只作路径展示
// ═══════════════════════════════════════════════════
describe('U-DEP02 搜索态危险操作', () => {
  it('搜索命中叶子时，祖先路径行不渲染编辑/删除，只显示“路径”标记', async () => {
    const user = userEvent.setup();
    renderDepartments();

    await user.type(screen.getByPlaceholderText('搜索部门...'), 'FE');

    // 命中的叶子行保留操作
    expect(screen.getByRole('button', { name: '删除部门 前端组' })).toBeInTheDocument();
    // 祖先路径行不渲染危险操作
    expect(screen.queryByRole('button', { name: '删除部门 总公司' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '删除部门 技术部' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '编辑部门 技术部' })).not.toBeInTheDocument();
    expect(screen.getAllByText('路径').length).toBeGreaterThanOrEqual(2);
  });
});

// ═══════════════════════════════════════════════════
// U-DEP03 非空树工具栏新建入口
// ═══════════════════════════════════════════════════
describe('U-DEP03 非空树新建入口', () => {
  it('非空树工具栏提供“新建部门”按钮（默认挂根部门）', () => {
    renderDepartments();
    expect(screen.getByRole('button', { name: '新建部门' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '新建根部门' })).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════
// U-PRM03 / U-G11 术语统一 + aria-label 区分对象
// ═══════════════════════════════════════════════════
describe('U-PRM03/U-G11 术语与 aria-label', () => {
  it('permissions 行内编辑是链接；内置权限无删除，自定义权限有删除', () => {
    const custom = {
      ...PERMISSION_API,
      id: '00000000-0000-4000-8000-000000000913',
      name: '自定义权限',
      code: 'custom:demo:read',
    };
    renderPermissions({ permissions: [PERMISSION_API, custom], pagination: PAGINATION(1) });
    expect(screen.getByRole('link', { name: `编辑权限 ${PERMISSION_API.name}` })).toHaveAttribute(
      'href',
      `/permissions/${PERMISSION_API.id}/edit?returnTo=%2Fpermissions`,
    );
    // 内置权限（ALL_PERMISSIONS）不可删：UI 提前隐藏，不再等服务端拒绝
    expect(screen.queryByRole('button', { name: `删除权限 ${PERMISSION_API.name}` })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: `删除权限 ${custom.name}` })).toBeInTheDocument();
  });

  it('roles 行内操作 aria-label 携带角色名', () => {
    renderRoles({ roles: [ROLE], pagination: PAGINATION(1) });
    expect(screen.getByRole('button', { name: `编辑角色 ${ROLE.name}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: `删除角色 ${ROLE.name}` })).toBeInTheDocument();
  });

  it('permissions 表单页标题使用统一术语（接口/页面/目录 + 权限）', () => {
    render(<PermissionForm mode="create" menuOptions={[]} />);
    // 默认类型 API → 标题「新建接口权限」；不使用旧术语「菜单项」
    expect(screen.getByRole('heading', { name: '新建接口权限' })).toBeInTheDocument();
    expect(screen.queryByText('新建菜单项')).not.toBeInTheDocument();
  });
});

// ═══════════════════════════════════════════════════
// U-G09 页面 metadata title（对齐 /users）
// ═══════════════════════════════════════════════════
describe('U-G09 页面 metadata', () => {
  const cases: Array<[string, string]> = [
    ['roles', '角色管理 | Auth-SSO'],
    ['permissions', '权限管理 | Auth-SSO'],
    ['departments', '部门管理 | Auth-SSO'],
  ];

  it.each(cases)('%s/page.tsx 输出与 /users 一致的 title', (dir, title) => {
    const candidates = [
      resolve(process.cwd(), 'src/app/(dashboard)', dir, 'page.tsx'),
      resolve(process.cwd(), 'apps/portal/src/app/(dashboard)', dir, 'page.tsx'),
    ];
    const file = candidates.find((p) => existsSync(p));
    expect(file, `未找到 ${dir}/page.tsx（cwd=${process.cwd()}）`).toBeTruthy();
    const source = readFileSync(file!, 'utf8');
    expect(source).toMatch(new RegExp(`export const metadata\\s*=\\s*\\{\\s*title:\\s*'${title.replace(/\|/g, '\\|')}'\\s*\\}`));
  });
});

// ═══════════════════════════════════════════════════
// U-DEP04：部门树排序（同级重排、层级不变）
// ═══════════════════════════════════════════════════
describe('U-DEP04 部门排序', () => {
  const SORT_TREE = [{
    id: '00000000-0000-4000-8000-0000000000a1',
    parentId: null,
    name: '总公司',
    code: 'ROOT',
    sort: 0,
    status: 'ACTIVE',
    children: [
      { id: '...b', parentId: '...a1', name: '乙部门', code: 'B', sort: 1, status: 'ACTIVE', children: [] },
      { id: '...a', parentId: '...a1', name: '甲部门', code: 'A', sort: 2, status: 'ACTIVE', children: [] },
    ],
  }];

  const rowNames = (container: HTMLElement) =>
    [...container.querySelectorAll('[data-dept-name]')].map((el) => el.textContent ?? '');

  it('默认顺序保持后端顺序；切换按名称/编码后同级重排', () => {
    const { container } = renderDepartments({ departments: SORT_TREE });

    // 根默认展开 ⇒ 三行可见；顺序 = 总公司、乙、甲（后端 sort 顺序）
    expect(rowNames(container)[1]).toContain('乙部门');
    expect(rowNames(container)[2]).toContain('甲部门');

    const select = screen.getByRole('combobox', { name: '部门排序方式' });
    fireEvent.change(select, { target: { value: 'name' } });
    expect(rowNames(container)[1]).toContain('甲部门');
    expect(rowNames(container)[2]).toContain('乙部门');

    fireEvent.change(select, { target: { value: 'code' } });
    expect(rowNames(container)[1]).toContain('甲部门');
    expect(rowNames(container)[2]).toContain('乙部门');

    // 切回默认恢复后端顺序
    fireEvent.change(select, { target: { value: 'default' } });
    expect(rowNames(container)[1]).toContain('乙部门');
  });
});

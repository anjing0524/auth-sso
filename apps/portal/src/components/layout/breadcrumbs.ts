/**
 * Dashboard 面包屑轨迹（纯函数，便于单测）。
 *
 * UX-07：末级标题统一取自 lib/route-titles.ts 的 PAGE_TITLES，
 * 与对应页面 PageHeader 的 title / metadata.title 同名。
 */
import { PAGE_TITLES } from '@/lib/route-titles';

export interface BreadcrumbCrumb {
  title: string;
  url: string;
}

/** 一级模块名，与侧边栏菜单保持一致 */
const MODULE_TITLES: Record<string, string> = {
  users: '用户管理',
  roles: '角色管理',
  departments: '部门管理',
  clients: '应用管理',
  'audit-logs': '审计日志',
  permissions: '权限管理',
  profile: '个人中心',
  menus: '菜单配置',
};

/**
 * 末级页面名的路由解析表：按模块拆成小函数，避免单个函数圈复杂度超
 * AGENTS.md 的 ≤15 上限；返回 null 表示该路由无需末级面包屑。
 */
type LeafResolver = (second: string, third?: string) => string | null;

const LEAF_TITLES: Record<string, LeafResolver> = {
  roles: (_second, third) => (third === 'permissions' ? PAGE_TITLES.ROLE_PERMISSIONS : null),
  users: (second, third) => {
    if (third === 'roles') return PAGE_TITLES.ASSIGN_ROLE;
    return second === 'new' ? PAGE_TITLES.NEW_USER : PAGE_TITLES.USER_DETAIL;
  },
  clients: (second) => (second === 'new' ? PAGE_TITLES.NEW_CLIENT : PAGE_TITLES.CLIENT_DETAIL),
  'audit-logs': () => PAGE_TITLES.AUDIT_DETAIL,
  permissions: (second, third) => {
    if (second === 'new') return PAGE_TITLES.NEW_PERMISSION;
    return third === 'edit' ? PAGE_TITLES.EDIT_PERMISSION : null;
  },
};

/**
 * 由路径生成面包屑。/dashboard 自身只有「工作台」一级。
 * 其余模块一律为「工作台 / 模块 / 末级页面」，末级 url 指向当前路径。
 */
export function buildBreadcrumbTrail(pathname: string): BreadcrumbCrumb[] {
  const segments = pathname.split('/').filter(Boolean);
  const crumbs: BreadcrumbCrumb[] = [{ title: '工作台', url: '/dashboard' }];
  const root = segments[0];
  if (!root || root === 'dashboard') return crumbs;

  crumbs.push({ title: MODULE_TITLES[root] ?? root, url: `/${root}` });
  const second = segments[1];
  if (!second) return crumbs;

  const leaf = LEAF_TITLES[root]?.(second, segments[2]);
  if (leaf) crumbs.push({ title: leaf, url: pathname });

  return crumbs;
}

/**
 * F7（task-16）页面级修复的机械守卫（纯 fs 扫描 + 纯函数）
 *
 * 这些点位无法用 jsdom 行为测试覆盖（Server Component 布局类、metadata、HTTP 404 分支、
 * 对话框确认文案等），用源码扫描钉住"修复后的形状"，防止回退。
 *
 * @req U-U02, U-USERS01, U-UD01, U-DASH01, U-SEA01, U-LOG02, U-CLIENT01, U-CLIENT02,
 *       U-PF02, U-G09, U-LOGIN01, U-G07
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { USER_ERRORS } from '@auth-sso/contracts';
import { userFacingMessage } from '@/app/(dashboard)/users/components/user-error-copy';

/** __tests__/components → apps/portal */
const portalRoot = join(__dirname, '..', '..');
const read = (rel: string) => readFileSync(join(portalRoot, rel), 'utf8');

describe('U-U02/U-G02 — users 越界页与筛选空态', () => {
  it('users/page.tsx 把 ?page=999 钳制到最后一个有效页（保留筛选）', () => {
    const source = read('src/app/(dashboard)/users/page.tsx');
    expect(source).toContain('pagination.totalPages');
    expect(source).toContain('redirect(`/users?');
    expect(source).toContain('const isFiltered');
    expect(source).toContain('isFiltered={isFiltered}');
  });

  it('UserTable 筛选空态使用共享 EmptyState kind=filtered + clearAction', () => {
    const source = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(source).toContain('kind="filtered"');
    expect(source).toContain('clearAction={{ label: \'清除筛选\'');
  });

  it('ClientsTable 同样接入 filtered 空态', () => {
    const source = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(source).toContain('kind="filtered"');
    expect(source).toContain('clearAction={{ label: \'清除筛选\'');
  });
});

describe('U-USERS01 — 行内详情入口按 user:read', () => {
  it('UserTable 的详情链接由 READ 权限守卫（不再由 UPDATE 守卫）', () => {
    const source = read('src/app/(dashboard)/users/components/UserTable.tsx');
    const detailBlock = source.slice(source.indexOf('/users/${user.id}') - 400, source.indexOf('/users/${user.id}'));
    expect(detailBlock).toContain('USER_PERMISSIONS.READ');
    expect(source).not.toContain('aria-label="详情/编辑"');
  });
});

describe('U-UD01 — 用户详情 390px 响应式', () => {
  const source = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
  it('移动端纵向堆叠、lg 才分栏', () => {
    expect(source).toContain('grid-cols-1');
    expect(source).toContain('lg:grid-cols-12');
    expect(source).toContain('lg:col-span-8');
    expect(source).toContain('lg:col-span-4');
    expect(source).toContain('sm:grid-cols-2');
  });
  it('页头操作换行 + 移动端底部固定保存条（保存不被裁出视口）', () => {
    expect(source).toContain('flex flex-wrap');
    expect(source).toContain('sticky bottom-0');
    expect(source).toContain('lg:hidden');
  });
});

describe('U-DASH01 — dashboard 快捷入口按 CREATE 权限裁剪', () => {
  it('新建用户/应用接入使用 CREATE 权限，而非 LIST', () => {
    const source = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(source).toContain('USER_PERMISSIONS.CREATE');
    expect(source).toContain('CLIENT_PERMISSIONS.CREATE');
    expect(source).toContain('show={canUserCreate}');
    expect(source).toContain('show={canClientCreate}');
  });
});

describe('U-SEA01/U-LOG02 — 审计页提示与页签语义', () => {
  const source = read('src/app/(dashboard)/audit-logs/page.tsx');
  it('滚动提示由 OverflowHint 按真实溢出渲染（不再静态常显）', () => {
    expect(source).toContain('<OverflowHint>');
    expect(source).not.toContain('data-scroll-hint');
    const hint = read('src/app/(dashboard)/audit-logs/components/overflow-hint.tsx');
    expect(hint).toContain('lg:hidden');
    expect(hint).toContain('scrollWidth > scroller.clientWidth');
  });
  it('页签具备 role=tab / aria-selected / tabpanel + roving tabindex', () => {
    // 2026-10-23（本轮 U-DEP04/U-LOG02 补全）：页签从 page 内联抽出为
    // `audit-logs/components/audit-tabs.tsx`（客户端组件，补 WAI-ARIA 键盘语义）。
    const tabsSource = read('src/app/(dashboard)/audit-logs/components/audit-tabs.tsx');
    expect(source).toContain('role="tabpanel"');
    expect(source).toContain('<AuditTabs');
    expect(tabsSource).toContain('role="tablist"');
    expect(tabsSource).toContain('role="tab"');
    expect(tabsSource).toContain('aria-selected={selected}');
    expect(tabsSource).toContain('tabIndex={focused === value ? 0 : -1}');
    expect(tabsSource).toContain("case 'ArrowRight':");
  });
});

describe('U-CLIENT01/02 — 应用页 404 与注册校验', () => {
  it('不存在的 Client 走 notFound()（与全站 404 一致）', () => {
    const source = read('src/app/(dashboard)/clients/[id]/page.tsx');
    expect(source).toContain('notFound()');
    expect(source).not.toContain('Client 不存在');
  });
  it('注册页前端校验 + 名称 maxLength', () => {
    const source = read('src/app/(dashboard)/clients/new/page.tsx');
    expect(source).toContain('maxLength={100}');
    expect(source).toContain('isHttpUrl');
    expect(source).toContain('role="alert"');
  });
});

describe('U-PF02 / U-G09 — 退出确认与 metadata', () => {
  it('profile 退出当前会话有二次确认', () => {
    const source = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(source).toContain('退出当前会话？');
    expect(source).toContain('setLogoutConfirmOpen');
  });

  it('五个列表/首页 metadata title 齐全', () => {
    const expectations: Array<[string, string]> = [
      ['src/app/(dashboard)/users/page.tsx', '用户管理 | Auth-SSO'],
      ['src/app/(dashboard)/clients/page.tsx', '应用管理 | Auth-SSO'],
      ['src/app/(dashboard)/dashboard/page.tsx', '工作台 | Auth-SSO'],
      ['src/app/(dashboard)/profile/page.tsx', '个人中心 | Auth-SSO'],
      ['src/app/(dashboard)/audit-logs/page.tsx', '审计日志 | Auth-SSO'],
    ];
    for (const [file, title] of expectations) {
      expect(read(file)).toContain(`metadata = { title: '${title}' }`);
    }
  });
});

describe('U-LOGIN01 — 登录输入 autocomplete', () => {
  it('邮箱/密码输入具备自动填充语义', () => {
    const source = read('src/app/login/login-form.tsx');
    expect(source).toContain('autoComplete="username"');
    expect(source).toContain('autoComplete="current-password"');
  });
});

describe('U-G07 — 用户域错误文案中文化', () => {
  it('重复邮箱/用户名按错误码映射中文（不再直出 "User 的 email 已存在"）', () => {
    expect(userFacingMessage({ error: USER_ERRORS.EMAIL_ALREADY_EXISTS, message: 'User 的 email 已存在' }))
      .toBe('该邮箱已被使用，请换一个');
    expect(userFacingMessage({ error: USER_ERRORS.USERNAME_ALREADY_EXISTS, message: 'User 的 username 已存在' }))
      .toBe('该用户名已被使用，请换一个');
    // 未映射的码保留服务端消息（可诊断）
    expect(userFacingMessage({ error: 'AUTH_SSO_1005', message: '姓名为空' })).toBe('姓名为空');
  });
});

/**
 * 2026-10-23 UI 重做：主表格的滚动 / 吸顶 / 密度契约（用户实测反馈"表格滑动表头不见了"）。
 *
 * 根因：Table 内层默认 `overflow-x-auto` 会自成滚动上下文，`TableHeader sticky` 相对它定位，
 * 外层滚动时表头随内容滚走（实测滚动 205px 后表头从容器顶 219px 变到 14px）。
 * 现在列表页只保留**一个**滚动容器，Sticky 落在 `th` 上。
 */
describe('表格滚动与吸顶契约（2026-10-23 UI 重做）', () => {
  it('DataTable 只用外层滚动容器，表头 sticky 挂在 th 上', () => {
    const dataTable = read('src/components/shared/data-table.tsx');
    expect(dataTable).toContain('containerClassName="overflow-visible"');
    expect(dataTable).toContain('[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card');
    // 卡片不再 flex-1 撑满（1 行数据不应出现整屏空白卡片）
    expect(dataTable).not.toContain('flex min-h-0 flex-1 flex-col');
  });

  it('审计页三张裸表同样使用 overflow-visible + sticky th', () => {
    const auditPage = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(auditPage.match(/containerClassName="overflow-visible"/g)?.length).toBe(3);
    expect(auditPage.match(/\[&_th\]:sticky \[&_th\]:top-0/g)?.length).toBe(3);
  });

  it('表头不再用 uppercase + tracking-widest（中文会被拆散）', () => {
    const table = read('src/components/ui/table.tsx');
    expect(table).toContain('type-table-head');
    expect(table).not.toContain('uppercase tracking-widest');
  });

  it('工具条控件统一 32px、页头标题 17px（列表页标题并入工具条）', () => {
    expect(read('src/components/shared/table-toolbar.tsx')).toContain('[&_button]:h-8');
    expect(read('src/components/shared/search-input.tsx')).toContain('md:w-64');
    expect(read('src/components/shared/search-input.tsx')).toContain('h-8 pl-8 pr-8');
    expect(read('src/components/shared/page-header.tsx')).toContain('type-page-title');
  });

  it('重内容不再用弹窗：角色权限 / 用户角色已页面化，旧弹窗文件不得回归', () => {
    // 判据（2026-10-23）：内容 > 1 屏、需要搜索/分页/多分组 → 页面；仅轻确认/短表单用弹窗。
    expect(existsSync(join(portalRoot, 'src/app/(dashboard)/roles/components/RolePermissionsDialog.tsx'))).toBe(false);
    expect(existsSync(join(portalRoot, 'src/app/(dashboard)/users/components/AssignRoleDialog.tsx'))).toBe(false);
    const rolePerm = read('src/app/(dashboard)/roles/[id]/permissions/page.tsx');
    expect(rolePerm).toContain('ASSIGN_PERMISSION');
    expect(rolePerm).toContain('RolePermissionsPage');
    const userRoles = read('src/app/(dashboard)/users/[id]/roles/page.tsx');
    expect(userRoles).toContain('ASSIGN_ROLE');
    expect(userRoles).toContain('UserRolesPage');
  });
});

describe('产品化页面结构（2026-10-23，UX-GUIDELINES §3）', () => {
  it('注册应用按任务分三块，并给 scope/TTL 预设（减少输入）', () => {
    const src = read('src/app/(dashboard)/clients/new/page.tsx');
    for (const t of ['应用身份', '登录与回调', '安全与令牌']) expect(src).toContain(t);
    expect(src).toContain('SCOPE_PRESETS');
    expect(src).toContain('aria-pressed={active}');
    expect(src).toContain('确认注册');
  });

  it('用户详情按 section 分组（基本/安全/部门角色/系统信息），危险操作带影响说明', () => {
    const src = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    for (const t of ['基本资料', '账号安全', '部门与角色', '系统信息']) expect(src).toContain(t);
    expect(src).toContain('重置后该用户所有活跃会话会被撤销');
    expect(src).toContain('不可撤销');
    expect(src).toContain('复制用户 ID');
  });

  it('权限分配作用域树带分组与状态过滤（产品方案而非逐项点选）', () => {
    const src = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(src).toContain('接口应用');
    expect(src).toContain('菜单目录');
    expect(src).toContain('全选本域');
    expect(src).toContain('仅看已选');
    expect(src).toContain('已禁用');
  });
});

describe('审计调查筛选（2026-10-26，UX-GUIDELINES §3.5）', () => {
  it('时间范围走白名单 + 数据层过滤 + 导出沿用筛选', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain("const TIME_RANGES = ['24h', '7d', '30d']");
    expect(page).toContain('startDate');
    expect(page).toContain('endDate');
    expect(page).toContain('&startDate=');
    expect(page).toContain('range');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('时间范围筛选');
    expect(filters).toContain('近 7 天');
    expect(filters).toContain("params.set('range'");
  });
});

describe('应用详情分区（2026-10-26，UX-GUIDELINES §3.2）', () => {
  it('按 资料/回调/令牌/凭证/状态 分区，并提供 scope/TTL 预设', () => {
    const src = read('src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    for (const t of ['应用资料', '登录与回调', '令牌有效期', '客户端凭证', '状态与时间']) expect(src).toContain(t);
    expect(src).toContain('SCOPE_PRESETS');
    expect(src).toContain('aria-pressed={active}');
    expect(src).toContain('formatTTL');
  });
});

describe('产品级批量授权与审计搜索（2026-10-26，第三轮）', () => {
  it('权限分配有变更差异（待新增/待移除/确认弹窗/仅看变更）', () => {
    const src = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(src).toContain('待新增');
    expect(src).toContain('待移除');
    expect(src).toContain('仅看变更');
    expect(src).toContain('确认保存权限变更？');
    expect(src).toContain('savedIds');
  });

  it('审计关键词搜索：inet 列需 ::text，导出沿用 keyword', () => {
    const data = read('src/app/audit/data.ts');
    expect(data).toContain('::text ilike');
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('keyword');
    expect(page).toContain('&keyword=');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('搜索用户 / IP');
  });
});

describe('工作台与用户筛选（2026-10-26，第四轮）', () => {
  it('工作台指标可点、近 7 日登录为真实聚合、无假状态卡', () => {
    const src = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(src).toContain('getLoginSummary7d');
    expect(src).toContain('MetricCard');
    expect(src).toContain('最近操作');
    expect(src).toContain('快捷操作');
    expect(src).not.toContain('服务节点正常');
  });

  it('用户列表支持部门筛选（URL deptId + 数据层 deptId）', () => {
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('deptId');
    expect(page).toContain('isUuid');
    const filters = read('src/app/(dashboard)/users/components/UserFilters.tsx');
    expect(filters).toContain('过滤部门');
    expect(filters).toContain('全部部门');
  });
});

describe('全站视觉一致性守卫（2026-10-26）', () => {
  it('后台/认证页不得再出现旧视觉 token（ring-border 描边、大写表头、font-black）', () => {
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const abs = join(dir, entry.name);
        if (entry.isDirectory()) out.push(...walk(abs));
        else if (entry.name.endsWith('.tsx')) out.push(abs);
      }
      return out;
    };
    const files = walk(join(portalRoot, 'src/app'));
    const offenders: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      if (/ring-1 ring-border/.test(text)) offenders.push(`${file}: ring-border`);
      if (/uppercase tracking-(wider|widest)/.test(text)) offenders.push(`${file}: uppercase tracking`);
      if (/font-black/.test(text)) offenders.push(`${file}: font-black`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('四个列表页有与模板一致的 loading 骨架（不再白屏等待）', () => {
    for (const route of ['roles', 'users', 'clients', 'permissions']) {
      const src = read(`src/app/(dashboard)/${route}/loading.tsx`);
      expect(src).toContain('Skeleton');
      expect(src).toContain('rounded-lg border border-border/70');
    }
  });
});

describe('个人中心信息架构（2026-10-26）', () => {
  it('分区为 账户资料/权限摘要/登录会话，会话默认折叠', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    for (const t of ['账户资料', '权限摘要', '登录会话']) expect(src).toContain(t);
    expect(src).toContain('visibleSessions');
    expect(src).toContain('查看全部');
    expect(src).toContain('shrink-0');
    expect(src).not.toContain('权限矩阵');
  });
});

describe('审计自定义时间区间（2026-10-26，第八轮）', () => {
  it('自定义 startDate/endDate 走校验、URL、导出与分页', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('resolveDateFilters');
    expect(page).toContain('startDate');
    expect(page).toContain('endDate');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('自定义日期');
    expect(filters).toContain('开始日期');
    expect(filters).toContain('结束日期');
  });
});

describe('用户批量状态操作（2026-10-26，第九轮）', () => {
  it('列表有全选/多选 + 批量禁用/恢复确认 + 独立 action', () => {
    const table = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(table).toContain('全选本页用户');
    expect(table).toContain('批量禁用');
    expect(table).toContain('批量恢复');
    expect(table).toContain('已选');
    expect(table).toContain('selectedIds');
    const action = read('src/app/(dashboard)/users/bulk-actions.ts');
    expect(action).toContain('bulkUpdateUserStatusAction');
    expect(action).toContain('withScopedRow');
    expect(action).toContain('CANNOT_DISABLE_SELF');
    expect(action).toContain('revokeUserAccessByUserId');
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('canUpdate');
    expect(page).toContain('USER_PERMISSIONS.UPDATE');
  });
});

describe('权限模板（2026-10-26，第十轮）', () => {
  it('模板只列真实权限码、套用后进入差异确认', () => {
    const src = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(src).toContain('PERMISSION_TEMPLATES');
    expect(src).toContain('审计调查员');
    expect(src).toContain('用户管理员');
    expect(src).toContain('应用管理员');
    expect(src).toContain('权限模板');
    expect(src).toContain('setAssignedIds(new Set(t.ids))');
    expect(src).toContain('已套用');
  });
});

describe('个人中心会话逐个撤销（2026-10-26，第十一轮）', () => {
  it('撤销需归属校验 + 二次确认 + 诚实文案', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src).toContain('撤销会话');
    expect(src).toContain('revokeOwnSessionAction');
    expect(src).toContain('已签发的访问令牌最长 1 小时后失效');
    const action = read('src/app/(dashboard)/profile/session-actions.ts');
    expect(action).toContain('revokeRefreshTokenById');
    expect(action).toContain('schema.refreshTokens.userId');
    expect(action).toContain('withAuth');
  });
});

describe('用户详情"看人"完整性（2026-10-26，第十二轮）', () => {
  it('直接展示角色、未分配语义、最近登录与邮箱验证', () => {
    const src = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(src).toContain('角色（');
    expect(src).toContain('未分配角色');
    expect(src).toContain('最近登录');
    expect(src).toContain('邮箱验证');
    expect(src).toContain('serverUser.roles');
  });
});

describe('审计筛选可解释 + 失败登录入口（2026-10-26，第十三轮）', () => {
  it('筛选 chips 可单个移除/清空，预置范围不重复日期', () => {
    const src = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(src).toContain('filterChips');
    expect(src).toContain('当前筛选');
    expect(src).toContain('清除全部');
    expect(src).toContain('chipStartDate');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('自定义日期');
  });

  it('工作台失败数直达“登录失败”筛选', () => {
    const src = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(src).toContain('查看近 7 日登录失败');
    expect(src).toContain('eventType=LOGIN_FAILED');
  });
});

describe('用户分配角色批量/差异（2026-10-26，第十四轮）', () => {
  it('支持搜索+全选筛选/清空/仅看已选，保存前确认差异', () => {
    const src = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(src).toContain('全选当前筛选');
    expect(src).toContain('清空全部');
    expect(src).toContain('仅看已选');
    expect(src).toContain('待新增');
    expect(src).toContain('待移除');
    expect(src).toContain('确认保存角色变更？');
    expect(src).toContain('savedRoleIds');
  });
});

describe('角色列表权限数（2026-10-26，第十五轮）', () => {
  it('角色行展示权限数并可进入配置，空壳角色可识别', () => {
    const table = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(table).toContain("header: '权限数'");
    expect(table).toContain('permissionCounts');
    expect(table).toContain('配置权限（当前');
    const data = read('src/app/(dashboard)/roles/data.ts');
    expect(data).toContain('getRolePermissionCounts');
    expect(data).toContain('schema.rolePermissions');
  });
});

describe('部门批量移动（2026-10-26，第十六轮）', () => {
  it('多选非根部门 + 选择父级 + 复用单条移动校验/失败计数', () => {
    const tree = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(tree).toContain('选择部门');
    expect(tree).toContain('移动到…');
    expect(tree).toContain('全选可移动');
    expect(tree).toContain('bulkMoveDepartmentsAction');
    const action = read('src/app/(dashboard)/departments/bulk-actions.ts');
    expect(action).toContain('updateDepartmentAction');
    expect(action).toContain('isUuid');
    expect(action).toContain('MAX_BULK');
  });
});

describe('建号/登录语义一致（2026-10-26，第十七轮）', () => {
  it('登录明确“登录邮箱”，建号用户名说明用途，成功提示登录邮箱', () => {
    const login = read('src/app/login/login-form.tsx');
    expect(login).toContain('登录邮箱');
    expect(login).not.toContain('账号（邮箱）');
    const create = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(create).toContain('用户名（唯一标识）');
    expect(create).toContain('创建后请把');
    expect(create).toContain('登录邮箱');
    expect(create).toContain('登录邮箱：');
    const detail = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(detail).toContain('用户名');
    const roles = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(roles).toContain('至少有一个含权限的角色');
  });
});

describe('角色分配权限数/零权限警告（2026-10-26，第十八轮）', () => {
  it('角色行显示权限数，全零权限组合在保存前警告', () => {
    const page = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(page).toContain('permissionCount');
    expect(page).toContain('0 权限');
    expect(page).toContain('所选角色均没有任何权限');
    expect(page).toContain('所选角色均无权限');
    const data = read('src/app/(dashboard)/roles/data.ts');
    expect(data).toContain('permissionCounts');
    expect(data).toContain('permissionCount');
  });
});

describe('应用列表状态筛选（2026-10-26，第十九轮）', () => {
  it('状态白名单 + URL 持久化 + 空态纳入筛选', () => {
    const page = read('src/app/(dashboard)/clients/page.tsx');
    expect(page).toContain("params.status === 'ACTIVE'");
    expect(page).toContain('status,');
    expect(page).toContain('status !==');
    const table = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(table).toContain('过滤应用状态');
    expect(table).toContain('applyStatus');
    expect(table).toContain('全部状态');
  });
});

describe('用户详情审计追溯（2026-10-26，第二十轮）', () => {
  it('入口按 audit:read 渲染，关键词=目标用户 ID，文案诚实说明匹配范围', () => {
    const src = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(src).toContain('查看变更审计');
    expect(src).toContain('tab=operation&keyword=');
    expect(src).toContain('AUDIT_PERMISSIONS.READ');
    expect(src).toContain('创建与角色/部门/状态等变更记录');
  });
});

describe('权限点批量删除（2026-10-26，第二十一轮）', () => {
  it('多选+确认+复用单条删除校验，失败计数', () => {
    const table = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(table).toContain('全选本页权限');
    expect(table).toContain('批量删除');
    expect(table).toContain('确认批量删除');
    expect(table).toContain('级联删除其子菜单');
    const action = read('src/app/(dashboard)/permissions/bulk-actions.ts');
    expect(action).toContain('bulkDeletePermissionsAction');
    expect(action).toContain('deletePermissionAction');
    expect(action).toContain('MAX_BULK');
  });
});

describe('应用最近使用/排序（2026-10-26，第二十二轮）', () => {
  it('列表聚合 token 最近签发时间，支持最近创建/更新/名称排序', () => {
    const data = read('src/app/(dashboard)/clients/data.ts');
    expect(data).toContain('lastUsedAt');
    expect(data).toContain('schema.refreshTokens.createdAt');
    expect(data).toContain("params.sort === 'name'");
    const table = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(table).toContain('最近使用');
    expect(table).toContain('应用排序');
    expect(table).toContain('按名称');
    const page = read('src/app/(dashboard)/clients/page.tsx');
    expect(page).toContain("['recent', 'updated', 'name']");
  });
});

describe('角色按权限数排序（2026-10-26，第二十七/二十八轮）', () => {
  it('SQL 聚合排序 + URL 白名单 + 空壳角色优先', () => {
    const data = read('src/app/(dashboard)/roles/data.ts');
    expect(data).toContain("permissions-asc");
    expect(data).toContain('getTableColumns');
    expect(data).toContain('schema.rolePermissions.permissionId');
    const table = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(table).toContain('角色排序');
    expect(table).toContain('权限数最少');
    const page = read('src/app/(dashboard)/roles/page.tsx');
    expect(page).toContain("permissions-asc");
  });
});

describe('产品审计二：操作与布局修复（2026-10-26）', () => {
  it('部门成员数/删除守卫排除软删除用户', () => {
    const data = read('src/app/(dashboard)/departments/data.ts');
    expect(data).toContain('isNull(schema.users.deletedAt)');
    const actions = read('src/app/(dashboard)/departments/actions.ts');
    expect(actions).toContain('isNull(schema.users.deletedAt)');
  });
  it('顶栏命令面板是真实可点击按钮（不是死 kbd）', () => {
    const trigger = read('src/components/layout/command-palette-trigger.tsx');
    expect(trigger).toContain('open-command-palette');
    expect(trigger).toContain('aria-label');
    const layout = read('src/components/layout/DashboardLayout.tsx');
    expect(layout).toContain('CommandPaletteTrigger');
    const palette = read('src/components/shared/command-palette.tsx');
    expect(palette).toContain("addEventListener('open-command-palette'");
  });
  it('客户端回调 URI 去协议显示 host+path，完整值进 title', () => {
    const table = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(table).toContain('formatRedirectUri');
    expect(table).toContain('u.host');
    expect(table).toContain('title={uri}');
  });
  it('角色/权限有状态筛选，且 URL 保留其它条件', () => {
    expect(read('src/app/(dashboard)/roles/page.tsx')).toContain('initialStatus');
    expect(read('src/app/(dashboard)/roles/components/RolesTable.tsx')).toContain('过滤角色状态');
    expect(read('src/app/(dashboard)/permissions/page.tsx')).toContain('initialStatus');
    expect(read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx')).toContain('过滤权限状态');
  });
  it('系统角色可查看权限（只读入口），Dashboard 卡片不再被拉伸', () => {
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('查看权限（系统角色只读）');
    expect(read('src/app/(dashboard)/dashboard/page.tsx')).toContain('items-start');
  });
  it('登录密码可见性切换且测试选择器用 exact 避免歧义', () => {
    const login = read('src/app/login/login-form.tsx');
    expect(login).toContain('显示密码');
    expect(login).toContain('隐藏密码');
    const spec = read('../../tests/e2e/user-lifecycle.spec.ts');
    expect(spec).toContain("getByLabel('密码', { exact: true })");
  });
});

describe('审计详情独立页（2026-10-26，续一百三十七）', () => {
  it('详情页存在、列表用 Link 进入、无弹窗内滚动', () => {
    const page = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(page).toContain('getAuditLogById');
    expect(page).toContain('变更参数');
    expect(page).toContain('返回审计日志');
    const list = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(list).toContain('/audit-logs/${loginLog.id}?tab=login');
    expect(list).toContain('/audit-logs/${opLog.id}?tab=operation');
    expect(list).not.toContain('AuditLogDetailDialog');
  });
});

describe('弹窗不滚动（续一百三十八）', () => {
  it('确认/成员弹窗不再使用 max-h + overflow-y-auto（内容过长改为摘要+页面入口）', () => {
    const files = [
      'src/app/(dashboard)/users/components/UserTable.tsx',
      'src/app/(dashboard)/permissions/components/PermissionsTable.tsx',
      'src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx',
      'src/app/(dashboard)/users/[id]/roles/roles-client.tsx',
    ];
    for (const file of files) {
      expect(read(file), file).not.toMatch(/max-h-(?:\d+|\[[^\]]+\])[^"\n]*overflow-y-auto/);
    }
  });
  it('部门成员入口进入用户管理部门筛选（不再用可滚动成员弹窗）', () => {
    const tree = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(tree).toContain('/users?deptId=');
    expect(tree).not.toContain('DepartmentMembersDialog');
    const data = read('src/app/(dashboard)/departments/data.ts');
    expect(data).toContain('isNull(schema.users.deletedAt)');
  });
  it('用户详情有未保存状态与放弃修改，避免无改动保存', () => {
    const src = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(src).toContain('isDirty');
    expect(src).toContain('未保存的修改');
    expect(src).toContain('放弃修改');
    expect(src).toContain('disabled={saving || !isDirty}');
  });
  it('角色权限页操作栏固定在底部，作用域操作与筛选分离', () => {
    const src = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(src).toContain('待新增');
    expect(src).toContain('权限模板');
    expect(src).toContain('border-t bg-card');
  });
});

describe('工作台风险与角色筛选（续一百三十九）', () => {
  it('工作台风险条使用真实聚合，且每项带筛选链接', () => {
    const data = read('src/app/(dashboard)/dashboard/data.ts');
    expect(data).toContain('usersWithoutRoles');
    expect(data).toContain('rolesWithoutPermissions');
    expect(data).toContain('disabledClients');
    const page = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(page).toContain('/users?noRole=1');
    expect(page).toContain('/roles?sort=permissions-asc');
    expect(page).toContain('/clients?status=DISABLED');
    expect(page).toContain("variant=\"warning\""); // 风险数字对比度（text-warning 不达标）
  });
  it('用户列表支持未分配角色筛选（URL + SQL + UI）', () => {
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain("params.noRole === '1'");
    const data = read('src/app/(dashboard)/users/data.ts');
    expect(data).toContain('notExists');
    const filters = read('src/app/(dashboard)/users/components/UserFilters.tsx');
    expect(filters).toContain('过滤角色分配');
    expect(filters).toContain('未分配角色');
  });
  it('measure 脚本检测主内容区滚动（不再只查 document）', () => {
    const measure = read('../../scripts/ux/measure.mjs');
    expect(measure).toContain('contentScroll');
    expect(measure).toContain('main?.firstElementChild');
  });
});

describe('移动端列表（续一百四十）', () => {
  it('横向滚动提示按真实溢出显示（不再始终显示）', () => {
    const src = read('src/components/shared/data-table.tsx');
    expect(src).toContain('overflowing');
    expect(src).toContain('scrollWidth > el.clientWidth');
  });
  it('用户列表移动端隐藏次级列，操作收进更多菜单', () => {
    const src = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(src).toContain('hidden md:table-cell');
    expect(src).toContain('更多操作');
    expect(src).toContain('md:hidden');
  });
  it('应用列表移动端隐藏 Client ID/回调/最近使用列', () => {
    const src = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(src).toContain('hidden md:table-cell');
    expect(src).toContain("className: 'hidden md:table-cell'");
  });
  it('用户工具栏移动端两列（搜索跨列、筛选不压缩）', () => {
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('grid w-full grid-cols-2');
    const filters = read('src/app/(dashboard)/users/components/UserFilters.tsx');
    expect(filters).toContain('col-span-2 md:w-64');
  });
});

describe('移动端权限/审计 + 审计取证（续一百四十二）', () => {
  it('权限表移动端隐藏编码/类型列，编码并入名称行', () => {
    const src = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(src).toContain("key: 'code', header: '权限编码', className: 'hidden md:table-cell'");
    expect(src).toContain("TYPE_LABELS[p.type] ?? p.type} · {p.code}");
  });
  it('审计表用真实溢出提示，登录事件列移动端并入用户行', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('OverflowHint');
    expect(page).not.toContain('data-scroll-hint');
    const hint = read('src/app/(dashboard)/audit-logs/components/overflow-hint.tsx');
    expect(hint).toContain('scrollWidth > scroller.clientWidth');
  });
  it('审计详情参数支持复制/下载', () => {
    const actions = read('src/app/(dashboard)/audit-logs/[id]/params-actions.tsx');
    expect(actions).toContain('复制变更参数');
    expect(actions).toContain('下载变更参数');
    expect(actions).toContain('URL.createObjectURL');
  });
});

describe('访问日志第三页签（续一百四十三）', () => {
  it('访问日志有页签/列表/详情/导出完整链路', () => {
    const tabs = read('src/app/(dashboard)/audit-logs/components/audit-tabs.tsx');
    expect(tabs).toContain("access: '访问日志'");
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('getAccessLogs');
    expect(page).toContain("tab === 'access'");
    expect(page).toContain('type=access');
    const detail = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(detail).toContain('getAccessLogById');
    expect(detail).toContain('访问日志详情');
    const exportRoute = read('src/app/api/audit/export/route.ts');
    expect(exportRoute).toContain('getAccessLogs');
    expect(exportRoute).toContain('type === \'operation\'');
  });
});

describe('访问日志用户名质量（续一百四十四）', () => {
  it('写入用真实 username；历史 userId 行读时回退', () => {
    const writer = read('src/lib/auth/server-logger.ts');
    expect(writer).toContain('schema.users.username');
    expect(writer).not.toContain('username: identity.userId');
    const data = read('src/app/audit/data.ts');
    expect(data).toContain('l.username === l.userId');
    expect(data).toContain('byId.get(l.userId)');
    expect(data).toContain('getAccessLogById');
  });
});

describe('用户列表角色信号（续一百四十五）', () => {
  it('列表聚合当前页角色数，0 角色显式警示（状态正常也可能登不进）', () => {
    const data = read('src/app/(dashboard)/users/data.ts');
    expect(data).toContain('roleCount');
    expect(data).toContain('schema.userRoles');
    const table = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(table).toContain("header: '角色'");
    expect(table).toContain('未分配角色');
    expect(table).toContain('roleCount === 0');
  });
});

describe('创建后下一步与 24h 失败入口（续一百四十六）', () => {
  it('创建用户成功 toast 提供分配角色行动（有权限时）', () => {
    const dialog = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(dialog).toContain('canAssignRole');
    expect(dialog).toContain("label: '分配角色'");
    expect(dialog).toContain('router.push(`/users/${createdId}/roles`)');
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('canAssignRole={canAssignRole}');
  });
  it('工作台风险条含近 24h 登录失败直达链接', () => {
    const page = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(page).toContain('getFailedLogins24h');
    expect(page).toContain('近 24h 登录失败');
    expect(page).toContain('eventType=LOGIN_FAILED&range=24h');
  });
});

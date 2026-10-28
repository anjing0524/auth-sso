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
    expect(filters).toContain('col-span-2 md:w-[12.5rem] xl:w-56');
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

describe('应用注册 TTL 选中态（续一百四十七）', () => {
  it('TTL 预设按钮有 aria-pressed 选中态，不再是无法辨认的等宽按钮', () => {
    const src = read('src/app/(dashboard)/clients/new/page.tsx');
    expect(src).toContain('aria-pressed={active}');
    expect(src).toContain("variant={active ? 'default' : 'outline'}");
    expect(src).toContain("formData.accessTokenTtl === p.v");
    expect(src).toContain("formData.refreshTokenTtl === p.v");
  });
});

describe('个人中心会话可辨识（续一百四十八）', () => {
  it('会话行显示登录时间，撤销按钮 aria-label 唯一', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src).toContain('登录于');
    expect(src).toContain('撤销会话 ${formatDateTime(item.createdAt)}');
    expect(src).toContain('item.id.slice(0, 8)');
    expect(src).toContain('sessions.find((s) => s.id === revokeTarget)');
  });
});

describe('访问日志状态/资源筛选（续一百五十）', () => {
  it('列表/筛选/导出三处同口径', () => {
    const data = read('src/app/audit/data.ts');
    expect(data).toContain("params.status === 'SUCCESS'");
    expect(data).toContain('getAccessLogResourceTypes');
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('validAccessResourceType');
    expect(page).toContain('状态：成功');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('访问状态筛选');
    expect(filters).toContain('资源类型筛选');
    const route = read('src/app/api/audit/export/route.ts');
    expect(route).toContain('accessStatus');
    expect(route).toContain('resourceType');
  });
});

describe('个人中心移动端布局（续一百五十一）', () => {
  it('列容器 min-w-0，身份头动作移动端整行，资料值可截断', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src.match(/min-w-0 space-y-3/g)?.length).toBe(2);
    expect(src).toContain('w-full flex-wrap items-center gap-2 sm:w-auto');
    expect(src).toContain('min-w-0 flex-1 truncate text-right');
  });
});

describe('移动端工具条换行（续一百五十二）', () => {
  it('TableToolbar 右槽可换行；部门排序控件移动端整行', () => {
    const toolbar = read('src/components/shared/table-toolbar.tsx');
    expect(toolbar).toContain('flex-wrap');
    expect(toolbar).toContain('md:flex-nowrap');
    const tree = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(tree).toContain('max-md:w-full');
    expect(tree).toContain('max-md:flex-1');
  });
});

describe('只读用户工作台门禁（续一百五十三）', () => {
  it('风险条按可操作权限显示；无快捷动作时显示只读说明而非空卡', () => {
    const src = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(src).toContain('canUsersAction');
    expect(src).toContain('hasActionableRisks');
    expect(src).toContain('hasQuickActions');
    expect(src).toContain('只读视图：当前账号可查看工作台与已授权列表');
    expect(src).not.toContain('当前账号无创建类操作权限。');
  });
});

describe('应用详情 dirty 状态（续一百五十四）', () => {
  it('无改动保存禁用、未保存提示、放弃修改', () => {
    const src = read('src/app/(dashboard)/clients/[id]/ClientDetailClient.tsx');
    expect(src).toContain('savedForm');
    expect(src).toContain('JSON.stringify(formData) !== JSON.stringify(savedForm)');
    expect(src).toContain('未保存的修改');
    expect(src).toContain('放弃修改');
    expect(src).toContain("!isDirty ? '无修改' : '保存修改'");
  });
});

describe('审计状态对比度与 a11y 覆盖（续一百五十五）', () => {
  it('审计状态码用语义徽章（success/destructive），不用 text-success', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain("variant={opLog.status === 200 ? 'success' : 'destructive'}");
    expect(page).toContain("variant={accessLog.status === 200 ? 'success' : 'destructive'}");
    expect(page).not.toContain('text-success}`}>{opLog.status');
  });
  it('a11y 脚本覆盖 roles/clients/departments/访问与操作页签/表单页', () => {
    const script = read('../../scripts/ux/a11y.mjs');
    for (const path of ["'/roles'", "'/clients'", "'/departments'", "'/audit-logs?tab=access'", "'/clients/new'"]) {
      expect(script).toContain(path);
    }
  });
});

describe('重复实体错误中文化（续一百五十六）', () => {
  it('领域模板去空格；角色/权限/用户传中文实体字段', () => {
    const errors = read('src/domain/shared/errors.ts');
    expect(errors).toContain('`${entity}${field}已存在`');
    const roles = read('src/app/(dashboard)/roles/actions.ts');
    expect(roles).toContain("DuplicateEntityError('角色', '编码'");
    const perms = read('src/app/(dashboard)/permissions/actions.ts');
    expect(perms).toContain("DuplicateEntityError('权限', '编码'");
    const users = read('src/app/(dashboard)/users/actions.ts');
    expect(users).toContain("'用户'");
  });
});

describe('部门批量移动顶层优先（续一百五十七）', () => {
  it('服务端过滤被选中祖先覆盖的子部门；UI 只计顶层数量', () => {
    const action = read('src/app/(dashboard)/departments/bulk-actions.ts');
    expect(action).toContain('roots = unique.filter');
    expect(action).toContain('ancestors');
    expect(action).toContain('skipped');
    const tree = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(tree).toContain('selectedRootIds');
    expect(tree).toContain('moveCount');
  });
});

describe('错误页统一出口（续一百五十八）', () => {
  it('7 个路由错误边界复用 RouteError；404 不再对已登录用户显示去登录', () => {
    const files = [
      'src/app/(dashboard)/error.tsx',
      'src/app/(dashboard)/users/error.tsx',
      'src/app/(dashboard)/roles/error.tsx',
      'src/app/(dashboard)/permissions/error.tsx',
      'src/app/(dashboard)/audit-logs/error.tsx',
      'src/app/(dashboard)/clients/error.tsx',
      'src/app/(dashboard)/dashboard/error.tsx',
    ];
    for (const f of files) {
      expect(read(f)).toContain("from '@/components/shared/route-error'");
    }
    const notFound = read('src/app/not-found.tsx');
    expect(notFound).not.toContain('去登录');
    expect(notFound).toContain('返回工作台');
    const shared = read('src/components/shared/route-error.tsx');
    expect(shared).toContain('复制 Error ID');
    expect(shared).toContain('返回工作台');
  });
});

describe('角色工具栏（续一百五十九/二百二十八）', () => {
  it('title/search 首行，排序/状态/部门第二行；≥1100 恢复单行', () => {
    const src = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(src).toContain('flex w-full min-w-0 flex-wrap items-center gap-2');
    expect(src).toContain('w-full sm:w-auto md:w-56');
    expect(src).toContain('order-3 flex w-full flex-wrap items-center gap-2 min-[1100px]:order-2');
    expect(src).toContain('md:w-32');
    expect(src).toContain('aria-label="过滤角色部门"');
  });
});

describe('Dialog 页脚与内容内边距一致（续一百六十）', () => {
  it('DialogContent p-5 与 DialogFooter -mx-5/-mb-5/p-5 对齐，不产生 4px 溢出', () => {
    const src = read('src/components/ui/dialog.tsx');
    expect(src).toContain('rounded-2xl bg-popover p-5');
    expect(src).toContain('-mx-5 -mb-5 sticky bottom-0 flex flex-col-reverse gap-2 rounded-b-2xl border-t bg-muted/50 p-5');
    expect(src).not.toContain('-mx-6 -mb-6');
  });
});

describe('短视口弹窗不裁切（续一百六十一）', () => {
  it('DialogContent 限制 100dvh 并可滚动；页脚 sticky 保持主操作可见', () => {
    const src = read('src/components/ui/dialog.tsx');
    expect(src).toContain('max-h-[calc(100dvh-2rem)]');
    expect(src).toContain('overflow-y-auto');
    expect(src).toContain('sticky bottom-0');
  });
});

describe('当前设备识别（续一百六十二）', () => {
  it('AT 写 sid；会话行按 id 标记 isCurrent；当前设备禁用撤销', () => {
    const token = read('src/lib/auth/token.ts');
    expect(token).toContain('sessionId?: string');
    expect(token).toContain('...(sessionId ? { sid: sessionId } : {})');
    const sessions = read('src/app/(dashboard)/profile/sessions.ts');
    expect(sessions).toContain('currentSessionId');
    expect(sessions).toContain('row.id === currentSessionId');
    const profile = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(profile).toContain('当前设备请使用下方');
  });
});

describe('审计导出一致性/客户端唯一 id（续一百六十三）', () => {
  it('移动端导出整行；创建/详情表单 id 不重复', () => {
    const audit = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(audit).toContain('max-md:ml-0 max-md:w-full');
    expect(audit).toContain('导出 CSV');
    const create = read('src/app/(dashboard)/clients/new/page.tsx');
    expect(create).toContain('id="client-create-name"');
    expect(create).not.toContain('id="client-name"');
    const detail = read('src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    expect(detail).toContain('id="client-detail-name"');
    expect(detail).not.toContain('id="client-name"');
  });
});

describe('跨路由表单 id 唯一（续一百六十四）', () => {
  it('登录/创建用户/客户端创建与详情使用页面前缀 id', () => {
    const login = read('src/app/login/login-form.tsx');
    expect(login).toContain('id="login-email"');
    expect(login).toContain('id="login-password"');
    const createUser = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(createUser).toContain('id="create-user-email"');
    expect(createUser).toContain('id="create-user-deptId"');
    const clientCreate = read('src/app/(dashboard)/clients/new/page.tsx');
    const clientDetail = read('src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    for (const f of ['homepage', 'redirect-uris', 'scopes', 'at-ttl', 'rt-ttl']) {
      expect(clientCreate).toContain(`id="client-create-${f}"`);
      expect(clientDetail).toContain(`id="client-detail-${f}"`);
    }
  });
});

describe('登录失败交互（续一百六十五）', () => {
  it('失败清空密码、保留邮箱、loading 结束后聚焦密码框', () => {
    const src = read('src/app/login/login-form.tsx');
    expect(src).toContain('focusPasswordAfterError');
    expect(src).toContain("setFormData((prev) => ({ ...prev, password: '' }))");
    expect(src).toContain("if (!isLoading && error && focusPasswordAfterError.current)");
  });
});

describe('destructive 语义 token（续一百六十六）', () => {
  it('destructive-foreground 在亮/暗主题均有定义并映射到 color token', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('--destructive-foreground: oklch(0.985 0 0)');
    expect(css).toContain('--destructive-foreground: oklch(0.205 0 0)');
    expect(css).toContain('--color-destructive-foreground: var(--destructive-foreground)');
  });
});

describe('暗色模式对比度（续一百六十七）', () => {
  it('a11y 支持 dark；暗色主色/浅色底文字有可读 token', () => {
    const script = read('../../scripts/ux/a11y.mjs');
    expect(script).toContain("E2E_COLOR_SCHEME === 'dark'");
    const css = read('src/app/globals.css');
    expect(css).toContain('--color-primary: oklch(0.53 0.21 257)');
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain('bg-primary/10 text-foreground');
  });
});

describe('移动端侧栏导航收起（续一百六十八）', () => {
  it('SidebarProvider 监听 pathname 关闭 openMobile', () => {
    const src = read('src/components/ui/sidebar.tsx');
    expect(src).toContain('usePathname');
    expect(src).toContain('setOpenMobile(false)');
    expect(src).toContain('[pathname]');
  });
});

describe('会话当前设备提示不重复（续一百六十九）', () => {
  it('当前行只保留徽章 + 锁图标，不重复“当前设备”文字', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src).toContain('aria-label="当前设备不可单独撤销"');
    expect(src).toContain('<Lock className="h-3 w-3" />');
    expect(src).not.toMatch(/当前设备请使用下方「退出当前会话」">\s*当前设备/);
  });
});

describe('未保存离开守卫（续一百七十）', () => {
  it('三个编辑页接入；确认使用整页导航卸载旧 portal', () => {
    for (const f of [
      'src/app/(dashboard)/users/[id]/UserDetailForm.tsx',
      'src/app/(dashboard)/clients/[id]/ClientDetailClient.tsx',
      'src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx',
    ]) expect(read(f)).toContain('useUnsavedChangesGuard');
    const hook = read('src/hooks/use-unsaved-changes-guard.tsx');
    expect(hook).toContain('window.location.assign(href)');
    expect(hook).toContain('beforeunload');
    expect(hook).toContain('离开并放弃未保存的修改？');
  });
});

describe('长表单未保存守卫（续一百七十一）', () => {
  it('新建应用/权限表单接入离开守卫', () => {
    expect(read('src/app/(dashboard)/clients/new/page.tsx')).toContain('useUnsavedChangesGuard(isDirty)');
    expect(read('src/app/(dashboard)/permissions/permission-form.tsx')).toContain('useUnsavedChangesGuard(isDirty)');
  });
});

describe('命令面板导航守卫（续一百七十二）', () => {
  it('面板先派发可取消导航事件；守卫监听并可阻止', () => {
    const palette = read('src/components/shared/command-palette.tsx');
    expect(palette).toContain('UNSAVED_NAVIGATION_EVENT');
    expect(palette).toContain('request.defaultPrevented');
    const hook = read('src/hooks/use-unsaved-changes-guard.tsx');
    expect(hook).toContain('UNSAVED_NAVIGATION_EVENT');
    expect(hook).toContain('event.preventDefault()');
  });
});

describe('移动侧栏无障碍语义（续一百七十三）', () => {
  it('SheetContent 有可访问名称与 aria-modal', () => {
    const src = read('src/components/ui/sidebar.tsx');
    expect(src).toContain('aria-label="主导航"');
    expect(src).toContain('aria-modal="true"');
  });
});

describe('客户端详情 tabs 语义（续一百七十四）', () => {
  it('tabpanel/aria-controls/方向键', () => {
    const src = read('src/app/(dashboard)/clients/[id]/ClientDetailClient.tsx');
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain('aria-controls="client-panel-info"');
    expect(src).toContain('handleTabKeyDown');
  });
});

describe('用户角色分配守卫（续一百七十五）', () => {
  it('分配角色页按 changeCount 接入守卫', () => {
    const src = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(src).toContain('useUnsavedChangesGuard(changeCount > 0)');
    expect(src).toContain('{leaveGuard}');
  });
});

describe('浏览器后退历史哨兵（续一百七十六）', () => {
  it('脏时 push __dirtyGuard，popstate 弹确认，保存后移除', () => {
    const src = read('src/hooks/use-unsaved-changes-guard.tsx');
    expect(src).toContain('__dirtyGuard');
    expect(src).toContain("addEventListener('popstate'");
    expect(src).toContain('window.history.back()');
  });
});

describe('批量恢复锁定用户语义（续一百七十七）', () => {
  it('LOCKED→ACTIVE 清计数；LOCKED→DISABLED 拒绝', () => {
    const src = read('src/app/(dashboard)/users/bulk-actions.ts');
    expect(src).toContain('USER_LOCKED');
    expect(src).toContain('clearUserBruteForceCounters');
    expect(src).toContain('已锁定的用户请先解锁');
  });
});

describe('批量操作锁定提示（续一百七十八）', () => {
  it('禁用提示跳过锁定用户，恢复提示解锁并清计数；无有效禁用时按钮禁用', () => {
    const src = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(src).toContain('lockedSelectedCount');
    expect(src).toContain('无法直接禁用，将被跳过');
    expect(src).toContain('将同时解锁，并清除登录失败计数');
    expect(src).toContain('无可禁用用户');
  });
});

describe('自我账号保护（续一百七十九）', () => {
  it('详情页传 isSelf；禁用/锁定选项禁用；删除入口隐藏', () => {
    const page = read('src/app/(dashboard)/users/[id]/page.tsx');
    expect(page).toContain('isSelf={identity?.userId === id}');
    const form = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(form).toContain('isSelf = false');
    expect(form).toContain('disabled={isSelf}');
    expect(form).toContain('不能禁用或锁定自己的账号');
    expect(form).toContain('{!isSelf && (');
  });
});

describe('用户列表自我保护（续一百八十）', () => {
  it('当前账号不可勾选/禁用；全选排除自己', () => {
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('currentUserId={userId}');
    const table = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(table).toContain('selectableUsers');
    expect(table).toContain('disabled={user.id === currentUserId}');
    expect(table).toContain('当前账号');
    expect(table).toContain('user.id !== currentUserId');
    expect(table).toContain('selectableUsers.length === 0');
  });
});

describe('禁止修改自己的角色（续一百八十一）', () => {
  it('服务端拒绝 self 角色变更；自己的角色页只读', () => {
    const actions = read('src/app/(dashboard)/users/actions.ts');
    expect(actions).toContain("ctx.userId === targetUserId");
    expect(actions).toContain('不能修改自己的角色');
    const page = read('src/app/(dashboard)/users/[id]/roles/page.tsx');
    expect(page).toContain('isSelf={identity?.userId === id}');
    const client = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(client).toContain('const readOnly = isSelf');
    expect(client).toContain('不能修改自己的角色');
  });
});

describe('部门移动目标过滤（续一百八十二）', () => {
  it('排除选中部门后代与禁用部门', () => {
    const src = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(src).toContain('isDescendantOfSelectedRoot');
    expect(src).toContain("statusById.get(d.id) === 'ACTIVE'");
    expect(src).toContain('目标列表已排除选中部门及其子部门');
  });
});

describe('越界分页回退末页（续一百八十三）', () => {
  it('roles/clients/permissions/audit 在 page>totalPages 时 redirect 保留筛选', () => {
    for (const f of [
      'src/app/(dashboard)/roles/page.tsx',
      'src/app/(dashboard)/clients/page.tsx',
      'src/app/(dashboard)/permissions/page.tsx',
      'src/app/(dashboard)/audit-logs/page.tsx',
    ]) {
      const src = read(f);
      expect(src).toContain('page > pagination.totalPages');
      expect(src).toContain('redirect(');
    }
  });
});

describe('内置权限删除保护（续一百八十四）', () => {
  it('ALL_PERMISSIONS 内的权限隐藏删除并禁用勾选；全选只选可删项', () => {
    const src = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(src).toContain('ALL_PERMISSIONS');
    expect(src).toContain('isBuiltinPermission');
    expect(src).toContain('deletablePermissions');
    expect(src).toContain('内置权限不可删除');
  });
});

describe('角色页对比度 token（续一百八十五）', () => {
  it('a11y 覆盖角色分配/权限页；警告条与待新增用 badge 语义对', () => {
    const script = read('../../scripts/ux/a11y.mjs');
    expect(script).toContain('/users/00000000-0000-0000-0000-000000000001/roles');
    expect(script).toContain('/roles/ed11e8cd-0261-4985-a201-006c05a19f20/permissions');
    const roles = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(roles).toContain('text-badge-warning-fg');
    expect(roles).toContain('bg-badge-success-bg');
    const perms = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(perms).not.toContain('text-muted-foreground/70');
    expect(perms).toContain('text-badge-success-fg');
  });
});

describe('详情页对比度 token（续一百八十六）', () => {
  it('a11y 覆盖 16 路由；warning 软底统一 badge token；scope 选中不透明', () => {
    const script = read('../../scripts/ux/a11y.mjs');
    expect(script).toContain("'/clients/portal'");
    expect(script).toContain("'/users/00000000-0000-0000-0000-000000000001'");
    const detail = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(detail).not.toContain('text-warning/90');
    expect(detail).toContain('text-badge-warning-fg');
    const client = read('src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    expect(client).toContain('disabled:opacity-100');
    expect(client).toContain('font-medium text-foreground');
  });
});

describe('链接对比度 token（续一百八十七）', () => {
  it('--link 亮/暗有定义并映射；审计详情链接使用 text-link；a11y 含动态详情', () => {
    const css = read('src/app/globals.css');
    expect(css).toContain('--link: oklch(0.52 0.23 257)');
    expect(css).toContain('--link: oklch(0.78 0.14 257)');
    expect(css).toContain('--color-link: var(--link)');
    const detail = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(detail).toContain('text-link');
    const script = read('../../scripts/ux/a11y.mjs');
    expect(script).toContain('查看日志详情');
  });
});

describe('登录页对比度（续一百八十八）', () => {
  it('a11y 独立上下文测 /login；页脚白字不低于 /60', () => {
    const script = read('../../scripts/ux/a11y.mjs');
    expect(script).toContain("report.contrast['/login']");
    expect(script).toContain("measureContrast(loginPage");
    const login = read('src/app/login/login-form.tsx');
    expect(login).not.toContain('text-white/45');
    expect(login).toContain('text-white/60');
  });
});

describe('系统角色只读一致性（续一百八十九）', () => {
  it('权限模板菜单项对系统角色 disabled，并在 onClick 防御', () => {
    const src = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(src).toContain('disabled={role.isSystem || t.ids.length === 0}');
    expect(src).toContain('if (role.isSystem) return;');
  });
});

describe('系统角色只读说明（续一百九十）', () => {
  it('系统角色权限页显示只读原因 banner', () => {
    const src = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(src).toContain('系统角色由平台维护');
    expect(src).toContain('{role.isSystem && (');
  });
});

describe('a11y 弹窗覆盖（续一百九十一）', () => {
  it('脚本打开用户/角色/权限/改密/重置弹窗并测量 dialog 对比度', () => {
    const script = read('../../scripts/ux/a11y.mjs');
    expect(script).toContain('DIALOG_CASES');
    expect(script).toContain("dialog:${item.name}");
    expect(script).toContain('users-create');
    expect(script).toContain('user-reset-password');
  });
});

describe('桌面侧栏宽度（续一百九十四）', () => {
  it('默认侧栏 14rem，把宽度让给数据区', () => {
    const src = read('src/components/ui/sidebar.tsx');
    expect(src).toContain('const SIDEBAR_WIDTH = "14rem"');
  });
});

describe('桌面工具栏层级（续一百九十五）', () => {
  it('审计头部紧凑类；应用计数用全局数据源', () => {
    const audit = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(audit).toContain('gap-1.5 xl:gap-3');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('md:w-56 xl:w-64');
    const page = read('src/app/(dashboard)/clients/page.tsx');
    expect(page).toContain('getClientStatusCounts');
    expect(page).toContain('statusCounts={statusCounts}');
    const table = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(table).toContain('statusCounts?.active');
  });
});

describe('内置权限类型锁定（续一百九十六）', () => {
  it('UI 禁用类型 + 服务端拒绝内置 type 变更', () => {
    const form = read('src/app/(dashboard)/permissions/permission-form.tsx');
    expect(form).toContain('disabled={isBuiltin}');
    expect(form).toContain('内置权限：编码被服务端代码引用');
    const actions = read('src/app/(dashboard)/permissions/actions.ts');
    expect(actions).toContain('内置权限不可修改类型');
    const table = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(table).toContain('内置');
  });
});

describe('空权限角色警告（续一百九十七）', () => {
  it('权限数为 0 时显示无权限警告并可进入配置', () => {
    const table = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(table).toContain('无权限');
    expect(table).toContain('variant="warning"');
    expect(table).toContain('绑定用户将无法登录门户');
  });
});

describe('用户部门迁移（续一百九十八）', () => {
  it('详情页可改部门；自己不可改；服务端兜底', () => {
    const page = read('src/app/(dashboard)/users/[id]/page.tsx');
    expect(page).toContain('getDepartmentOptions');
    expect(page).toContain('departments={departments}');
    const form = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(form).toContain('aria-label="所属部门"');
    expect(form).toContain('不能修改自己的部门');
    expect(form).toContain('迁移部门前需确保');
    const actions = read('src/app/(dashboard)/users/actions.ts');
    expect(actions).toContain('不能修改自己的部门');
  });
});

describe('角色描述可编辑（续一百九十九）', () => {
  it('新建/编辑都有描述输入；绑定用户时提示迁移约束', () => {
    const src = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(src).toContain('id="role-description"');
    expect(src).toContain('id="role-edit-description"');
    expect(src).toContain('迁移部门前需先解除绑定');
  });
});

describe('部门排序/状态入口（续二百）', () => {
  it('编辑可改排序/状态；根部门不可停用；停用有影响提示', () => {
    const tree = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(tree).toContain('id="dept-sort"');
    expect(tree).toContain('id="dept-edit-sort"');
    expect(tree).toContain('id="dept-edit-status"');
    expect(tree).toContain('根部门为组织树单例');
    expect(tree).toContain('停用后不能再向该部门新增');
    const actions = read('src/app/(dashboard)/departments/actions.ts');
    expect(actions).toContain('根部门不可停用');
  });
});

describe('权限状态/归属应用入口（续二百〇一）', () => {
  it('编辑可改状态；API 可选归属应用；内置两者锁定', () => {
    const form = read('src/app/(dashboard)/permissions/permission-form.tsx');
    expect(form).toContain('id="perm-status"');
    expect(form).toContain('id="perm-client"');
    expect(form).toContain('disabled={isBuiltin}');
    const actions = read('src/app/(dashboard)/permissions/actions.ts');
    expect(actions).toContain('内置权限不可修改归属应用');
    const edit = read('src/app/(dashboard)/permissions/[id]/edit/page.tsx');
    expect(edit).toContain('status: permission.status');
    expect(edit).toContain('clientId: permission.clientId');
  });
});

describe('应用 Logo 入口（续二百〇二）', () => {
  it('新建/详情都有 Logo URL 输入并提交 logoUrl', () => {
    const create = read('src/app/(dashboard)/clients/new/page.tsx');
    expect(create).toContain('id="client-create-logo"');
    expect(create).toContain('Logo 地址必须是合法的');
    const detail = read('src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    expect(detail).toContain('id="client-detail-logo"');
  });
});

describe('角色排序/状态入口（续二百〇三）', () => {
  it('新建有排序；编辑有排序/状态；停用有影响提示', () => {
    const src = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(src).toContain('id="role-sort"');
    expect(src).toContain('id="role-edit-sort"');
    expect(src).toContain('id="role-edit-status"');
    expect(src).toContain('停用后绑定用户立即失去该角色权限');
  });
});

describe('个人资料头像/刷新（续二百〇四）', () => {
  it('编辑资料有头像 URL；保存后刷新页面数据', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src).toContain('id="profile-avatar"');
    expect(src).toContain('avatarUrl: form.avatarUrl.trim() || null');
    expect(src).toContain('router.refresh()');
  });
});

describe('创建用户/角色保存后刷新（续二百〇五）', () => {
  it('创建用户成功与角色保存成功后 router.refresh', () => {
    const create = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(create).toContain('router.refresh()');
    const roles = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(roles).toContain('router.refresh()');
  });
});

describe('权限返回上下文/批量失败保留（续二百〇六）', () => {
  it('列表带 returnTo；表单保存/返回用它；用户批量失败不丢选择', () => {
    const table = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(table).toContain('returnTo=${encodeURIComponent(returnTo)}');
    expect(table).toContain('createReturnTo');
    const form = read('src/app/(dashboard)/permissions/permission-form.tsx');
    expect(form).toContain('router.push(returnHref)');
    expect(form).toContain('backHref={returnHref}');
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain('// 失败时保留选择与确认框');
    expect(users).toContain('return;');
  });
});

describe('用户单条禁用确认（续二百〇七）', () => {
  it('ACTIVE 禁用先确认；启用/解锁直接执行', () => {
    const src = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(src).toContain('禁用用户「');
    expect(src).toContain('确认禁用');
    expect(src).toContain('if (user.status === \'ACTIVE\')');
  });
});

describe('删除失败保留确认框（续二百〇八）', () => {
  it('角色/部门仅在成功时关闭确认框', () => {
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    const roleBlock = roles.slice(roles.indexOf('const handleDelete'), roles.indexOf('const getDeptName'));
    expect(roleBlock.indexOf('setDeleteTarget(null)')).toBeGreaterThan(roleBlock.indexOf('if (res.success)'));
    const dept = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    const deptBlock = dept.slice(dept.indexOf('const handleDelete'), dept.indexOf('const sortedTree'));
    expect(deptBlock.indexOf('setDeleteTarget(null)')).toBeGreaterThan(deptBlock.indexOf('if (r.success)'));
  });
});

describe('创建用户默认部门（续二百〇九）', () => {
  it('重新打开弹窗时回填默认部门，不要求每次重选', () => {
    const src = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(src).toContain('setDeptId(defaultDeptId)');
  });
});

describe('管理员用户头像入口（续二百一十一）', () => {
  it('详情可编辑 avatarUrl 并计入 dirty/提交', () => {
    const src = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(src).toContain('id="user-avatar"');
    expect(src).toContain('form.avatarUrl !== savedForm.avatarUrl');
    expect(src).toContain('avatarUrl: form.avatarUrl.trim() || null');
  });
});

describe('审计详情返回上下文（续二百一十二）', () => {
  it('详情链接带 returnTo；详情返回仅接受站内 /audit-logs', () => {
    const list = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(list).toContain('returnTo=${encodeURIComponent(currentListHref)}');
    const detail = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(detail).toContain("rawReturn.startsWith('/audit-logs')");
    expect(detail).toContain('returnHref={returnHref}');
  });
});

describe('列表下钻返回上下文（续二百一十三）', () => {
  it('用户/应用/角色权限详情链接带 returnTo，详情用安全返回', () => {
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain('returnTo=${encodeURIComponent(currentListHref)}');
    const userPage = read('src/app/(dashboard)/users/[id]/page.tsx');
    expect(userPage).toContain('safeReturnPath');
    const clients = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(clients).toContain('returnTo=${encodeURIComponent(currentListHref)}');
    const clientPage = read('src/app/(dashboard)/clients/[id]/page.tsx');
    expect(clientPage).toContain('safeReturnPath');
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('returnTo=${encodeURIComponent(currentListHref)}');
    const rolePage = read('src/app/(dashboard)/roles/[id]/permissions/page.tsx');
    expect(rolePage).toContain('safeReturnPath');
  });
});

describe('用户角色页二级返回（续二百一十四）', () => {
  it('详情→角色分配→详情→列表的嵌套 returnTo 链完整', () => {
    const detail = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(detail).toContain('/users/${id}/roles?returnTo=');
    const route = read('src/app/(dashboard)/users/[id]/roles/page.tsx');
    expect(route).toContain('safeReturnPath');
    expect(route).toContain('returnHref={returnHref}');
    const client = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(client).toContain('backHref={returnHref ??');
    const list = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(list).toContain('/users/${user.id}/roles?returnTo=');
  });
});

describe('角色绑定用户口径（续二百一十五）', () => {
  it('计数排除逻辑删除用户；角色列表展示用户数', () => {
    const data = read('src/app/(dashboard)/roles/data.ts');
    expect(data).toContain('isNull(schema.users.deletedAt)');
    const table = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(table).toContain('{boundUserCounts[r.id] ?? 0} 用户');
  });
});

describe('权限影响面用户口径（续二百一十六）', () => {
  it('受影响用户 SQL 排除逻辑删除用户', () => {
    const data = read('src/app/(dashboard)/permissions/data.ts');
    expect(data).toContain('u.deleted_at IS NULL');
  });
});

describe('授权 Token 总数可见性（续二百一十七）', () => {
  it('详情传总数；卡片显示有效授权总数与截断说明', () => {
    const page = read('src/app/(dashboard)/clients/[id]/page.tsx');
    expect(page).toContain('initialTokenTotal={tokens.pagination.total}');
    const section = read('src/app/(dashboard)/clients/[id]/components/ClientTokensSection.tsx');
    expect(section).toContain('有效授权 Token');
    expect(section).toContain('total > tokens.length');
    expect(section).toContain('仅显示最近');
  });
});

describe('角色弹窗 600px 不滚动（续二百一十八）', () => {
  it('新建/编辑表单使用两列网格压缩高度', () => {
    const src = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(src).toContain('grid gap-3 py-4 sm:grid-cols-2');
  });
});

describe('新建用户弹窗 600px 不滚动（续二百一十九）', () => {
  it('表单与字段网格使用 2.5 间距', () => {
    const src = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(src).toContain('space-y-2.5');
    expect(src).toContain('grid gap-2.5');
  });
});

describe('1024 桌面列表不裁切（续二百二十）', () => {
  it('用户创建时间/应用回调列延后到 xl，最近使用到 lg', () => {
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain("key: 'createdAt'");
    expect(users).toContain('hidden xl:table-cell');
    const clients = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(clients).toContain('hidden xl:table-cell');
    expect(clients).toContain('hidden w-[110px] min-[1100px]:table-cell');
  });
});

describe('1024 权限/应用表操作列（续二百二十一）', () => {
  it('权限类型/应用最近使用在 <1100 隐藏，操作列不裁切', () => {
    const perm = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perm).toContain('hidden min-[1100px]:table-cell');
    const client = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(client).toContain('hidden w-[110px] min-[1100px]:table-cell');
  });
});

describe('空态出口/UA 完整值（续二百二十二）', () => {
  it('无可用角色提供角色管理出口；UA 提供 title', () => {
    const roles = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(roles).toContain('前往角色管理');
    const profile = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(profile).toContain('title={session.userAgent ??');
  });
});

describe('1024 工具栏占位/计数（续二百二十三）', () => {
  it('搜索占位缩短；应用计数 <1100 隐藏', () => {
    const users = read('src/app/(dashboard)/users/components/UserFilters.tsx');
    expect(users).toContain('搜索姓名/邮箱/用户名');
    const clients = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(clients).toContain('搜索应用或 Client ID');
    expect(clients).toContain('hidden items-center gap-2 min-[1100px]:flex');
  });
});

describe('1024 权限工具栏一行（续二百二十四）', () => {
  it('搜索收窄到 190 并缩短占位，状态筛选不再掉行', () => {
    const src = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(src).toContain('md:w-[190px] xl:w-64');
    expect(src).toContain('搜索名称或编码');
  });
});

describe('1024 审计工具栏两行（续二百二十五）', () => {
  it('<1100 首行标题/页签/导出，次行筛选；占位缩短', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('order-2 ml-auto');
    expect(page).toContain('order-3 w-full');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('搜索用户 / IP');
    expect(filters).not.toContain('搜索用户 / IP...');
  });
});

describe('1024 用户工具栏顶部对齐（续二百二十六）', () => {
  it('TableToolbar 与左侧标题组均 items-start', () => {
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('className="md:items-start"');
    expect(page).toContain('md:items-start md:gap-3');
  });
});

describe('角色部门筛选（续二百二十八）', () => {
  it('数据过滤、页面解析、工具栏选择与顶部对齐', () => {
    const data = read('src/app/(dashboard)/roles/data.ts');
    expect(data).toContain('deptId?: string');
    expect(data).toContain('eq(schema.roles.deptId, deptId)');
    const page = read('src/app/(dashboard)/roles/page.tsx');
    expect(page).toContain('isUuid(params.deptId)');
    expect(page).toContain('initialDeptId={deptId}');
    const table = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(table).toContain('aria-label="过滤角色部门"');
    expect(table).toContain('className="md:items-start"');
  });
});

describe('权限归属应用筛选（续二百二十九）', () => {
  it('数据支持 clientId/NONE；页面传 clients；工具栏两行/单行', () => {
    const data = read('src/app/(dashboard)/permissions/data.ts');
    expect(data).toContain("clientId === 'NONE'");
    expect(data).toContain('getClientOptions');
    const page = read('src/app/(dashboard)/permissions/page.tsx');
    expect(page).toContain('clients={clients}');
    const table = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(table).toContain('aria-label="过滤归属应用"');
    expect(table).toContain('order-3 flex w-full');
  });
});

describe('权限归属应用仅接口 tab（续二百三十）', () => {
  it('页面忽略非 API 的 clientId；工具栏条件渲染；URL 不保留', () => {
    const page = read('src/app/(dashboard)/permissions/page.tsx');
    expect(page).toContain("activeTab === 'API' ? (params.clientId");
    const table = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(table).toContain("if (nextClientId && nextType === 'API')");
    expect(table).toContain("{activeTab === 'API' ? (");
  });
});

describe('授权 Token 单条撤销（续二百三十一）', () => {
  it('行操作传入 tokenId，二次确认后调用撤销', () => {
    const section = read('src/app/(dashboard)/clients/[id]/components/ClientTokensSection.tsx');
    expect(section).toContain('onRevokeToken');
    expect(section).toContain('撤销 ${token.username');
    const client = read('src/app/(dashboard)/clients/[id]/ClientDetailClient.tsx');
    expect(client).toContain("'revoke-token'");
    expect(client).toContain('revokeClientTokensAction(client.clientId, [revokeTokenTarget.id], false)');
  });
});

describe('管理员强制下线入口（续二百三十二）', () => {
  it('共享实现 + Server Action + 详情确认框；自己隐藏', () => {
    const lib = read('src/lib/auth/force-logout.ts');
    expect(lib).toContain('forceLogoutUser');
    const actions = read('src/app/(dashboard)/users/actions.ts');
    expect(actions).toContain('forceLogoutUserAction');
    const detail = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(detail).toContain('确认强制下线');
    expect(detail).toContain('{!isSelf && (');
  });
});

describe('强制下线影响面计数（续二百三十三）', () => {
  it('详情读活跃会话数并显示在系统信息/确认框', () => {
    const data = read('src/app/(dashboard)/users/data.ts');
    expect(data).toContain('getUserActiveSessionCount');
    expect(data).toContain('isNull(schema.refreshTokens.revoked)');
    const page = read('src/app/(dashboard)/users/[id]/page.tsx');
    expect(page).toContain('activeSessionCount={activeSessionCount}');
    const form = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(form).toContain('活跃会话');
    expect(form).toContain('当前 ${activeSessionCount} 个活跃会话');
  });
});

describe('危险操作影响面文案（续二百三十四）', () => {
  it('重置/删除在 0 会话时不显示 0 个；有会话时显示数量', () => {
    const reset = read('src/app/(dashboard)/users/[id]/ResetPasswordDialog.tsx');
    expect(reset).toContain('activeSessionCount > 0');
    const form = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(form).toContain('activeSessionCount > 0 ?');
    expect(form).toContain('移除 {roles.length} 个角色绑定');
  });
});

describe('删除影响面 0 文案（续二百三十五）', () => {
  it('角色/权限在 0 影响时不堆 0', () => {
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('暂无绑定用户');
    expect(roles).toContain('该角色无权限绑定');
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('暂未被角色或用户使用');
  });
});

describe('部门删除 0 影响文案（续二百三十六）', () => {
  it('只列非零依赖；无依赖时说明可直接删除', () => {
    const src = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(src).toContain("parts.length > 0 ? parts.join('、') : '无子部门、直属用户或角色'");
    expect(src).toContain('可直接删除');
  });
});

describe('部门批量移动长列表（续二百三十七）', () => {
  it('已选名称只显示前 5 个，其余给数量，title 含全量', () => {
    const src = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(src).toContain('selectedMoveNames.slice(0, 5)');
    expect(src).toContain('等 ${selectedMoveNames.length} 个部门');
    expect(src).toContain('title={selectedMoveNames.join');
  });
});

describe('批量选择随上下文清空（续二百三十九）', () => {
  it('用户/权限选择在 URL 变化时清空，并标注当前页', () => {
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain('useEffect(() => { setSelected(new Set()); }, [listQueryKey])');
    expect(users).toContain('（当前页）');
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('useEffect(() => { setCheckedIds(new Set()); }, [listQueryKey])');
    expect(perms).toContain('个权限（当前页）');
  });
});

describe('可空字段清空语义（续二百四十一）', () => {
  it('角色描述/部门编码清空提交 null', () => {
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('description: form.description.trim() || null');
    const depts = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(depts).toContain('code: form.code.trim() || null');
  });
});

describe('权限路径清空语义（续二百四十二）', () => {
  it('更新模式路径清空写 null，创建仍 undefined', () => {
    const form = read('src/app/(dashboard)/permissions/permission-form.tsx');
    expect(form).toContain("path: form.path || (mode === 'update' ? null : undefined)");
    expect(form).toContain("menuPayload('update')");
    expect(form).toContain("menuPayload('create')");
  });
});

describe('工作台最近操作跳转（续二百四十三）', () => {
  it('查看全部落到操作日志 tab', () => {
    const page = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(page).toContain('href="/audit-logs?tab=operation"');
  });
});

describe('工作台快捷新建用户（续二百四十四）', () => {
  it('链接带 create=1，页面自动打开，取消清理 URL', () => {
    const dash = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(dash).toContain('href="/users?create=1"');
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain("autoOpen={canCreateUser && params.create === '1'}");
    const dialog = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(dialog).toContain('useState(autoOpen)');
    expect(dialog).toContain("params.delete('create')");
  });
});

describe('新手引导四步直达动作（续二百四十五）', () => {
  it('组织/用户/角色/应用分别到创建态或新建页', () => {
    const dash = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(dash).toContain("href: '/departments?create=1'");
    expect(dash).toContain("href: '/users?create=1'");
    expect(dash).toContain("href: '/roles?create=1'");
    expect(dash).toContain("href: '/clients/new'");
    const roles = read('src/app/(dashboard)/roles/page.tsx');
    expect(roles).toContain('autoOpenCreate={canCreateRole && params.create');
    const depts = read('src/app/(dashboard)/departments/page.tsx');
    expect(depts).toContain('autoOpenCreate={canCreateDept && params.create');
  });
});

describe('用户空态创建入口（续二百四十六）', () => {
  it('无用户时有新建入口且受 create 权限控制', () => {
    const table = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(table).toContain("label: '新建用户', href: '/users?create=1'");
    expect(table).toContain('canCreate ?');
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('canCreate={canCreateUser}');
  });
});

describe('部门搜索空态清除（续二百四十七）', () => {
  it('空态提供清除搜索并清空 keyword', () => {
    const src = read('src/app/(dashboard)/departments/components/DepartmentTree.tsx');
    expect(src).toContain("label: '清除搜索', onClick: () => setKeyword('')");
  });
});

describe('审计筛选空态覆盖全部筛选（续二百四十八）', () => {
  it('登录/操作/访问 tab 均按全部生效筛选判断', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('eventType || keyword || startDate');
    expect(page).toContain('operation || keyword || startDate');
    expect(page).toContain('keyword || accessStatus || validAccessResourceType || startDate');
  });
});

describe('权限选择/用户角色搜索空态（续二百四十九）', () => {
  it('区分作用域无权限/搜索无匹配，并提供清除搜索', () => {
    const rp = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(rp).toContain("'当前作用域没有可选权限'");
    expect(rp).toContain('清除搜索');
    expect(rp).toContain("onClick={() => setKeyword('')}");
    const ur = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(ur).toContain("setKeyword('')");
  });
});

describe('筛选加载反馈（续二百五十一）', () => {
  it('角色筛选/分页、审计筛选走 transition；权限/审计搜索显示 busy', () => {
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('startTransition(() => router.push(`/roles?${params.toString()}`))');
    expect(roles).toContain('startTransition(() => router.push(`/roles?${p.toString()}`))');
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('busy={isPending}');
    const audit = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(audit).toContain('useTransition');
    expect(audit).toContain('busy={isPending}');
  });
});

describe('分页 pending 禁用（续二百五十二）', () => {
  it('分页支持 disabled；用户/应用分页走 transition 并禁用', () => {
    const pg = read('src/components/shared/table-pagination.tsx');
    expect(pg).toContain('disabled?: boolean');
    expect(pg).toContain('disabled || page <= 1');
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain('startTransition(() => router.push(`${pathname}?${params.toString()}`))');
    expect(users).toContain('disabled={isPending}');
    const clients = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(clients).toContain('startTransition(() => router.push(`/clients');
    expect(clients).toContain('disabled={isPending}');
  });
});

describe('审计跳页保留访问筛选（续二百五十三）', () => {
  it('jumpParams 含 status/resourceType', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('...(accessStatus ? { status: accessStatus } : {})');
    expect(page).toContain('...(validAccessResourceType ? { resourceType: validAccessResourceType } : {})');
  });
});

describe('自动打开创建态权限门禁（续二百五十四）', () => {
  it('角色/部门 autoOpen 受 create 权限控制', () => {
    const roles = read('src/app/(dashboard)/roles/page.tsx');
    expect(roles).toContain('ROLE_PERMISSIONS.CREATE');
    const depts = read('src/app/(dashboard)/departments/page.tsx');
    expect(depts).toContain('DEPARTMENT_PERMISSIONS.CREATE');
  });
});

describe('搜索框随 URL 后退同步（续二百五十五）', () => {
  it('五个列表的搜索状态跟随 initialKeyword', () => {
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('useEffect(() => { setKeyword(initialKeyword); }, [initialKeyword]);');
    const clients = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(clients).toContain('useEffect(() => { setKeyword(initialKeyword); }, [initialKeyword]);');
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('useEffect(() => { setKeyword(initialKeyword); }, [initialKeyword]);');
    const users = read('src/app/(dashboard)/users/components/UserFilters.tsx');
    expect(users).toContain('useEffect(() => { setKeyword(initialKeyword); }, [initialKeyword]);');
    const audit = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(audit).toContain("useEffect(() => { setKw(keyword ?? ''); }, [keyword]);");
  });
});

describe('审计自定义日期随 URL 同步（续二百五十六）', () => {
  it('customMode 跟随 range/startDate/endDate', () => {
    const src = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(src).toContain('useEffect(() => { setCustomMode(!range && Boolean(startDate || endDate)); }, [range, startDate, endDate]);');
  });
});

describe('删除确认 pending（续二百五十七）', () => {
  it('权限/用户单条删除禁用重复提交', () => {
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('const [deleting, setDeleting] = useState(false)');
    expect(perms).toContain("{deleting ? '删除中...' : '确认删除'}");
    const user = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(user).toContain('const [deletingUser, setDeletingUser] = useState(false)');
    expect(user).toContain("{deletingUser ? '删除中...' : '确认删除'}");
  });
});

describe('分页跳页 pending（续二百五十八）', () => {
  it('PaginationJump 接收 disabled 并禁用输入/按钮', () => {
    const jump = read('src/components/shared/pagination-jump.tsx');
    expect(jump).toContain('disabled?: boolean');
    expect(jump).toContain('disabled={disabled}');
    const pg = read('src/components/shared/table-pagination.tsx');
    expect(pg).toContain('disabled={disabled}');
  });
});

describe('筛选控件 pending 禁用（续二百五十九）', () => {
  it('角色/权限下拉与审计下拉/日期绑定 isPending', () => {
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('onValueChange={applySort} disabled={isPending}');
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('disabled={isPending}');
    const audit = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(audit).toContain("aria-label=\"开始日期\" value={startDate ?? ''} disabled={isPending}");
  });
});

describe('审计日期顺序校验（续二百六十）', () => {
  it('开始晚于结束时提示并阻止写 URL', () => {
    const src = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(src).toContain("toast.error('开始日期不能晚于结束日期')");
    expect(src).toContain("toast.error('结束日期不能早于开始日期')");
  });
});

describe('最近操作详情链路（续二百六十一）', () => {
  it('行为列链接到操作日志详情', () => {
    const page = read('src/app/(dashboard)/dashboard/page.tsx');
    expect(page).toContain('`/audit-logs/${log.id}?tab=operation`');
  });
});

describe('用户删除返回筛选上下文（续二百六十三）', () => {
  it('删除成功后跳 returnHref 而非固定 /users', () => {
    const src = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(src).toContain('router.push(returnHref)');
    expect(src).not.toContain("router.push('/users')");
  });
});

describe('创建/编辑取消返回上下文（续二百六十四）', () => {
  it('权限表单/角色权限取消用 returnHref；应用新建携带并校验 returnTo', () => {
    const perm = read('src/app/(dashboard)/permissions/permission-form.tsx');
    expect(perm).toContain('<Link href={returnHref}>取消</Link>');
    const rp = read('src/app/(dashboard)/roles/[id]/permissions/permissions-client.tsx');
    expect(rp).toContain('<Link href={returnHref}>取消</Link>');
    const newPage = read('src/app/(dashboard)/clients/new/page.tsx');
    expect(newPage).toContain("safeReturnPath(searchParams.get('returnTo'), '/clients', '/clients')");
    const list = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(list).toContain('/clients/new?returnTo=');
  });
});

describe('用户行状态操作 pending（续二百六十五）', () => {
  it('禁用/解锁/恢复按钮随 transition 禁用', () => {
    const src = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(src).toContain('disabled={isPending}');
    expect(src).toContain('onClick={() => handleToggleStatus(user)}');
  });
});

describe('权限非 API 状态筛选 pending（续二百六十六）', () => {
  it('目录/页面/全部 tab 的状态下拉也禁用', () => {
    const src = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(src).toContain("v === 'ALL' ? '' : v, '')))} disabled={isPending}");
  });
});

describe('权限 tab pending 禁用（续二百六十七）', () => {
  it('TabsTrigger 绑定 isPending', () => {
    const src = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(src).toContain('value={tab.value} disabled={isPending}');
  });
});

describe('审计每页条数（续二百六十八）', () => {
  it('分页支持 pageSizeOptions；审计查询/链接/筛选保留 pageSize', () => {
    const pg = read('src/components/shared/table-pagination.tsx');
    expect(pg).toContain('pageSizeOptions?: Array<{ value: number; href: string }>');
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('PAGE_SIZE_OPTIONS');
    expect(page).toContain('pageSizeOptions={PAGE_SIZE_OPTIONS.map');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain("if (pageSize !== 20) params.set('pageSize'");
  });
});

describe('权限每页条数（续二百六十九）', () => {
  it('权限查询/链接保留 pageSize；分页单页仍显示页大小', () => {
    const page = read('src/app/(dashboard)/permissions/page.tsx');
    expect(page).toContain('pageSize,');
    expect(page).toContain("pageSize !== 20");
    const table = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(table).toContain('pageSizeOptions={[20, 50, 100].map');
    const pg = read('src/components/shared/table-pagination.tsx');
    expect(pg).toContain('{pageSizeNode}');
  });
});

describe('用户每页条数（续二百七十）', () => {
  it('用户查询/分页保留 pageSize，页大小链接保留筛选', () => {
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('[20, 50, 100].includes(Number(params.pageSize))');
    expect(page).toContain('pageSize={pageSize}');
    const table = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(table).toContain('pageSizeOptions={[20, 50, 100].map');
    expect(table).toContain("next.delete('page')");
  });
});

describe('用户清空筛选保留页大小（续二百七十一）', () => {
  it('clearHref 保留 pageSize', () => {
    const src = read('src/app/(dashboard)/users/page.tsx');
    expect(src).toContain("clearHref={pageSize !== 20 ? `/users?pageSize=${pageSize}` : '/users'}");
  });
});

describe('每页条数无障碍组（续二百七十二）', () => {
  it('pageSize 容器 role=group + aria-label', () => {
    const src = read('src/components/shared/table-pagination.tsx');
    expect(src).toContain('role="group"');
    expect(src).toContain('aria-label="每页条数"');
  });
});

describe('批量操作栏无障碍语义（续二百七十三）', () => {
  it('用户/权限批量栏 region + live 状态', () => {
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain('role="region" aria-label="批量操作"');
    expect(users).toContain('role="status" aria-live="polite"');
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('role="region" aria-label="批量操作"');
    expect(perms).toContain('role="status" aria-live="polite"');
  });
});

describe('动态加载无障碍（续二百七十四）', () => {
  it('表格 aria-busy；影响面统计 role=status', () => {
    const table = read('src/components/shared/data-table.tsx');
    expect(table).toContain('aria-busy={loading || undefined}');
    const perms = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(perms).toContain('role="status" aria-live="polite"');
  });
});

describe('每页条数当前值语义（续二百七十五）', () => {
  it('当前值 aria-current，链接有明确名称', () => {
    const src = read('src/components/shared/table-pagination.tsx');
    expect(src).toContain('aria-current="true"');
    expect(src).toContain('aria-label={`每页 ${option.value} 条`}');
  });
});

describe('空态装饰图标（续二百七十六）', () => {
  it('DynamicIcon aria-hidden', () => {
    const src = read('src/components/shared/empty-state.tsx');
    expect(src).toContain('aria-hidden="true"');
  });
});

describe('头像装饰语义（续二百七十七）', () => {
  it('行内/资料头像 alt 为空', () => {
    for (const f of [
      'src/app/(dashboard)/clients/components/ClientsTable.tsx',
      'src/app/(dashboard)/profile/ProfileClient.tsx',
      'src/app/(dashboard)/users/components/UserTable.tsx',
      'src/components/layout/app-sidebar.tsx',
    ]) {
      expect(read(f)).toContain('<AvatarImage');
      expect(read(f)).toContain('alt=""');
    }
  });
});

describe('清空筛选保留排序（续二百七十九）', () => {
  it('客户端/角色 clearHref 带 sort', () => {
    const clients = read('src/app/(dashboard)/clients/page.tsx');
    expect(clients).toContain("sort !== 'recent' ? `/clients?sort=${sort}`");
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain("initialSort !== 'default' ? `/roles?sort=${initialSort}`");
  });
});

describe('自动弹窗关闭保留查询（续二百八十）', () => {
  it('关闭只删除 create，保留其他筛选', () => {
    for (const f of [
      'src/app/(dashboard)/users/components/CreateUserDialog.tsx',
      'src/app/(dashboard)/roles/components/RolesTable.tsx',
      'src/app/(dashboard)/departments/components/DepartmentTree.tsx',
    ]) {
      expect(read(f)).toContain("params.delete('create')");
    }
  });
});

describe('用户角色筛选文案（续二百八十一）', () => {
  it('仅“全部/未分配角色”，不再写全部角色', () => {
    const src = read('src/app/(dashboard)/users/components/UserFilters.tsx');
    expect(src).toContain("'未分配角色' : '全部'");
    expect(src).not.toContain('全部角色');
  });
});

describe('每页条数视觉分隔（续二百八十二）', () => {
  it('选项间有分隔符且当前项高亮', () => {
    const src = read('src/components/shared/table-pagination.tsx');
    expect(src).toContain('index < pageSizeOptions.length - 1');
    expect(src).toContain('>/</span>');
  });
});

describe('审计访问表 1024 列宽（续二百八十四）', () => {
  it('方法列 ≥1100；路径 1024 限宽；搜索框 224', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('<TableHead className="hidden min-[1100px]:table-cell">方法</TableHead>');
    expect(page).toContain('max-w-[200px]');
    const filters = read('src/app/(dashboard)/audit-logs/components/audit-filters.tsx');
    expect(filters).toContain('md:w-56 xl:w-64');
  });
});

describe('审计操作表 1024 列宽（续二百八十五）', () => {
  it('IP 列 ≥1100；请求地址限宽', () => {
    const page = read('src/app/(dashboard)/audit-logs/page.tsx');
    expect(page).toContain('{opLog.ip ||');
    expect(page).toContain('min-[1100px]:max-w-xs');
  });
});

describe('审计详情 1024 堆叠（续二百八十六）', () => {
  it('两栏延后到 xl，避免窄来源栏拆 UA', () => {
    const src = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(src).toContain('xl:grid-cols-3');
    expect(src).not.toContain('lg:grid-cols-3');
  });
});

describe('用户详情 1024 排版（续二百八十七）', () => {
  it('部门标签不折行、选择框 150；强制下线文案缩短', () => {
    const src = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(src).toContain('shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">所属部门');
    expect(src).toContain('className="h-8 w-[150px]"');
    expect(src).toContain('将撤销全部 Token 并让所有设备退出');
  });
});

describe('用户角色空态部门筛选（续二百八十八）', () => {
  it('前往角色管理携带 deptId', () => {
    const src = read('src/app/(dashboard)/users/[id]/roles/roles-client.tsx');
    expect(src).toContain('/roles?deptId=${user.deptId}');
  });
});

describe('部门名筛选入口（续二百八十九）', () => {
  it('用户/角色行部门名链接到对应 deptId', () => {
    const users = read('src/app/(dashboard)/users/components/UserTable.tsx');
    expect(users).toContain('/users?deptId=${encodeURIComponent(user.deptId)}');
    const roles = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(roles).toContain('/roles?deptId=${encodeURIComponent(r.deptId)}');
  });
});

describe('授权 Token 表 1024 列宽（续二百九十一）', () => {
  it('Scopes 限宽并带 title，操作列完整', () => {
    const src = read('src/app/(dashboard)/clients/[id]/components/ClientTokensSection.tsx');
    expect(src).toContain('max-w-[260px] truncate');
    expect(src).toContain('title={token.scopes.join');
  });
});

describe('角色创建默认部门（续二百九十二）', () => {
  it('默认部门优先使用当前 deptId 筛选', () => {
    const src = read('src/app/(dashboard)/roles/components/RolesTable.tsx');
    expect(src).toContain('const getDefaultDeptId = () => initialDeptId || departments[0]?.id');
  });
});

describe('用户创建默认部门（续二百九十三）', () => {
  it('创建用户继承当前 deptId 筛选', () => {
    const dialog = read('src/app/(dashboard)/users/components/CreateUserDialog.tsx');
    expect(dialog).toContain('initialDeptId');
    const page = read('src/app/(dashboard)/users/page.tsx');
    expect(page).toContain('initialDeptId={deptId && departments.some');
  });
});

describe('权限创建继承筛选（续二百九十四）', () => {
  it('新建链接带 type/clientId，表单接收初始值', () => {
    const table = read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx');
    expect(table).toContain("createParams.set('type', activeTab)");
    expect(table).toContain('const createNewHref');
    const page = read('src/app/(dashboard)/permissions/new/page.tsx');
    expect(page).toContain('initialType={initialType}');
    const form = read('src/app/(dashboard)/permissions/permission-form.tsx');
    expect(form).toContain("permission?.type ?? initialType ?? 'API'");
  });
});

describe('Portal 客户端禁用说明（续二百九十五）', () => {
  it('禁用/只读/轮换禁用态都有 title 原因', () => {
    const detail = read('src/app/(dashboard)/clients/[id]/ClientDetailClient.tsx');
    expect(detail).toContain('Portal 自身登录客户端不可禁用');
    expect(detail).toContain('Portal 自身登录客户端为只读');
    const info = read('src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    expect(info).toContain('Portal 自身登录客户端不可轮换 Secret');
  });
});

describe('会话 ID 完整值（续二百九十六）', () => {
  it('截断展示带 title 完整会话 ID', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src).toContain('title={`会话 ID：${item.id}`}');
  });
});

describe('技术标识完整 title（续二百九十七）', () => {
  it('用户 ID/角色编码/权限编码都有 title', () => {
    expect(read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx')).toContain('title={String(serverUser.id ?? id)}');
    expect(read('src/app/(dashboard)/roles/components/RolesTable.tsx')).toContain('title={r.code}');
    expect(read('src/app/(dashboard)/permissions/components/PermissionsTable.tsx')).toContain('title={p.code}');
  });
});

describe('会话 scopes 完整值（续二百九十八）', () => {
  it('截断 scopes 带 title', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src).toContain('title={`scope：${item.scopes}`}');
  });
});

describe('回调 URI +N 完整值（续二百九十九）', () => {
  it('+N 徽章 title 列出其余回调', () => {
    const src = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(src).toContain('client.redirectUris.slice(1).join');
  });
});

describe('Scopes/回调复制入口（续三百）', () => {
  it('应用详情提供复制按钮', () => {
    const src = read('src/app/(dashboard)/clients/[id]/components/ClientInfoSection.tsx');
    expect(src).toContain('aria-label="复制 Scopes"');
    expect(src).toContain('aria-label="复制回调地址"');
  });
});

describe('审计日志 ID 复制（续三百零一）', () => {
  it('详情页头复用 CopyTextButton', () => {
    const src = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(src).toContain('CopyTextButton text={id} label="复制日志 ID"');
    expect(read('src/components/shared/copy-text-button.tsx')).toContain('toast.success(successMessage)');
  });
});

describe('会话 ID 一键复制（续三百零二）', () => {
  it('会话行复用 CopyTextButton', () => {
    const src = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(src).toContain('<CopyTextButton text={item.id} label="复制会话 ID" />');
  });
});

describe('编码复制入口（续三百零三）', () => {
  it('权限/角色编辑态可复制编码', () => {
    expect(read('src/app/(dashboard)/permissions/permission-form.tsx')).toContain('复制权限编码');
    expect(read('src/app/(dashboard)/roles/components/RolesTable.tsx')).toContain('复制角色编码');
  });
});

describe('审计详情技术字段复制（续三百零四）', () => {
  it('IP/UA/路径/请求地址可复制', () => {
    const src = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(src).toContain('copy?: boolean');
    expect(src).toContain('label={`复制${label}`}');
    expect(src).toContain('value={row.url || \'-\'} mono copy');
  });
});

describe('Client ID 复制反馈（续三百零五）', () => {
  it('成功 toast + 动态 aria-label', () => {
    const src = read('src/app/(dashboard)/clients/components/ClientsTable.tsx');
    expect(src).toContain("toast.success('已复制 Client ID')");
    expect(src).toContain("'Client ID 已复制'");
  });
});

describe('复制按钮动态名称（续三百零六）', () => {
  it('CopyTextButton 成功态 aria-label 为已复制', () => {
    const src = read('src/components/shared/copy-text-button.tsx');
    expect(src).toContain("aria-label={copied ? '已复制' : label}");
  });
});

describe('用户/主体 ID 复制统一（续三百零七）', () => {
  it('两处复用 CopyTextButton 并保留专属成功文案', () => {
    const user = read('src/app/(dashboard)/users/[id]/UserDetailForm.tsx');
    expect(user).toContain('successMessage="已复制用户 ID"');
    const profile = read('src/app/(dashboard)/profile/ProfileClient.tsx');
    expect(profile).toContain('successMessage="已复制主体 ID"');
  });
});

describe('共享复制组件回退（续三百零八）', () => {
  it('clipboard 失败时 execCommand 回退', () => {
    const src = read('src/components/shared/copy-text-button.tsx');
    expect(src).toContain("document.execCommand('copy')");
    expect(src).toContain('if (!copied)');
  });
});

describe('审计详情 UUID 校验（续三百一十/三百一十二）', () => {
  it('复用共享 isUuid，不维护本地正则', () => {
    const src = read('src/app/(dashboard)/audit-logs/[id]/page.tsx');
    expect(src).toContain("import { isUuid } from '@/lib/uuid'");
    expect(src).toContain('if (!isUuid(id)) notFound()');
    expect(src).not.toContain('UUID_RE');
  });
});

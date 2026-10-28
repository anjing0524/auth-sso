'use client';

/**
 * 用户管理数据表格与分页组件
 * 采用 React 19 useTransition 绑定 Server Action Controller，安全下沉领域逻辑
 */

import { useEffect, useOptimistic, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useFieldFailure } from '@/hooks/use-field-failure';
import {
  Eye,
  UserMinus,
  UserCheck,
  Shield,
  Building,
  MoreHorizontal,
} from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { USER_PERMISSIONS, type UserStatus } from '@auth-sso/contracts';
import { toggleUserStatusAction, unlockUserAction } from '../actions';
import { bulkUpdateUserStatusAction } from '../bulk-actions';

import { formatDate } from '@/lib/format-date';
import { accountStatus } from '@/lib/status-label';
/**
 * 用户类型定义 (对齐领域 UserProps)
 */
/** 头像兜底文案：中文取首字，拉丁名取前两位（"系统管理员"→"系"，"Auth-SSO Portal"→"AU"） */
function avatarFallback(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  return /[\u4e00-\u9fa5]/.test(trimmed) ? trimmed.charAt(0) : trimmed.substring(0, 2).toUpperCase();
}

interface User {
  id: string;

  username: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  status: UserStatus;
  deptId: string | null;
  deptName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  /** 已分配角色数；0 = 无法登录门户（状态正常也进不去） */
  roleCount: number;
}

/**
 * 分页类型定义
 */
interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface UserTableProps {
  /** 用户列表数据 */
  users: User[];
  /** 分页信息 */
  pagination: Pagination;
  /** 筛选栏区域（传入 DataTable cardHeader） */
  filters?: React.ReactNode;
  /** 是否处于搜索/筛选态（U-G02：空态文案与「清除筛选」出口据此区分） */
  isFiltered?: boolean;
  /** 「清除筛选」目标地址（回第 1 页、清空 keyword/status） */
  clearHref?: string;
  /** 是否有 user:update（无权限时不显示多选与批量操作） */
  canUpdate?: boolean;
  /** 是否有 user:create（空态显示新建入口） */
  canCreate?: boolean;
  /** 每页条数 */
  pageSize?: number;
  /** 当前登录用户 id（禁止勾选/禁用自己） */
  currentUserId?: string;
}

/**
 * 局部骨架屏组件
 */
export function UserTableSkeleton() {
  return (
    <div className="border border-border rounded-xl overflow-hidden bg-card">
      <Table>
        <TableHeader className="bg-muted/50">
          <TableRow className="border-b">
            <TableHead className="w-[300px]">用户信息</TableHead>
            <TableHead>部门</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>创建时间</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell>
                <div className="flex gap-3">
                  <Skeleton className="h-10 w-10 rounded-full" />
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </TableCell>
              <TableCell><Skeleton className="h-4 w-20" /></TableCell>
              <TableCell><Skeleton className="h-5 w-14 rounded-lg" /></TableCell>
              <TableCell><Skeleton className="h-4 w-24" /></TableCell>
              <TableCell className="text-right">
                <Skeleton className="ml-auto h-8 w-8 rounded-lg" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function UserTable({ users, pagination, filters, isFiltered = false, clearHref = '/users', canUpdate = false, canCreate = false, pageSize = 20, currentUserId }: UserTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const listQueryKey = searchParams.toString();
  const currentListHref = `${pathname}${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;

  // 角色分配对话框状态
  const { reportFailure } = useFieldFailure();

  // useOptimistic: 状态切换立即反映在 UI，失败自动回退
  const [optimisticUsers, setOptimisticUser] = useOptimistic(
    users,
    (state, toggledId: string) =>
      state.map((u) => {
        if (u.id !== toggledId) return u;
        // LOCKED 走解锁 → ACTIVE；其余 ACTIVE ⇄ DISABLED（H-C-02）
        const next: User['status'] = u.status === 'LOCKED'
          ? 'ACTIVE'
          : (u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE');
        return { ...u, status: next };
      }),
  );

  const [isPending, startTransition] = useTransition();

  // 多选：仅当有 user:update 时启用；翻页/筛选后清空，避免"选了第一页却批量改了不可见的人"
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTarget, setBulkTarget] = useState<'DISABLED' | 'ACTIVE' | null>(null);
  const [bulking, setBulking] = useState(false);
  // 选择仅对当前列表上下文生效：翻页/筛选后清空，避免返回原页时旧选择“复活”
  useEffect(() => { setSelected(new Set()); }, [listQueryKey]);
  /** 单条禁用确认（禁用会立即撤销会话，必须二次确认） */
  const [statusConfirmTarget, setStatusConfirmTarget] = useState<User | null>(null);
  // 只对"当前页可见"的选中项生效：翻页/筛选后旧选择自然失效，避免改到看不见的人
  const selectedIds = canUpdate ? users.filter((u) => selected.has(u.id)).map((u) => u.id) : [];
  const selectedCount = selectedIds.length;
  const selectedUsers = users.filter((u) => selected.has(u.id));
  const lockedSelectedCount = selectedUsers.filter((u) => u.status === 'LOCKED').length;
  const disableEffectiveCount = selectedCount - lockedSelectedCount;
  const selectableUsers = users.filter((u) => u.id !== currentUserId);
  const allSelected = canUpdate && selectableUsers.length > 0 && selectableUsers.every((u) => selected.has(u.id));
  const toggleSelect = (id: string, checked: boolean) => {
    if (id === currentUserId) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };
  const toggleSelectAll = (checked: boolean) => {
    setSelected(checked ? new Set(selectableUsers.map((u) => u.id)) : new Set());
  };
  const runBulk = async () => {
    if (!bulkTarget) return;
    setBulking(true);
    try {
      const res = await bulkUpdateUserStatusAction(selectedIds, bulkTarget);
      if (!res.success) {
        // 失败时保留选择与确认框，用户可直接重试，不必重新逐行勾选
        reportFailure(res, '批量操作失败');
        return;
      }
      toast.success(res.message ?? '批量操作完成');
      setSelected(new Set());
      setBulkTarget(null);
      router.refresh();
    } finally {
      setBulking(false);
    }
  };

  /** 真正执行状态切换（仅启用/解锁；禁用由确认框触发） */
  const performToggleStatus = (user: User) => {
    startTransition(async () => {
      setOptimisticUser(user.id); // 即时翻转 UI
      // H-C-02：LOCKED 用户必须走解锁动作（toggle 对 LOCKED 会被域层拒绝，
      // 此前「恢复」按钮对锁定用户是死路——unlockUserAction 没有任何 UI 入口）。
      const res = user.status === 'LOCKED'
        ? await unlockUserAction(user.id)
        : await toggleUserStatusAction(user.id);
      if (!res.success) {
        reportFailure(res, '操作失败');
      } else {
        toast.success(user.status === 'LOCKED' ? '用户已解锁' : '用户状态已更新');
        router.refresh();
      }
    });
  };

  const handleToggleStatus = (user: User) => {
    // 禁用会立即撤销全部会话，必须先确认；启用/解锁是恢复性操作，直接执行
    if (user.status === 'ACTIVE') {
      setStatusConfirmTarget(user);
      return;
    }
    performToggleStatus(user);
  };

  /**
   * 翻页更改 URL 参数
   */
  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', newPage.toString());
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  };

  const columns = [
    ...(canUpdate ? [{
      key: 'select',
      className: 'w-8',
      header: (
        <Checkbox
          aria-label="全选本页用户"
          checked={allSelected}
          disabled={selectableUsers.length === 0}
          title={selectableUsers.length === 0 ? '当前页没有可选择的用户' : undefined}
          onCheckedChange={(checked) => toggleSelectAll(checked === true)}
        />
      ),
    }] : []),
    { key: 'user', header: '用户信息', className: 'w-[190px] md:w-[300px]' },
    { key: 'dept', header: '部门', className: 'hidden md:table-cell' },
    { key: 'roles', header: '角色', className: 'hidden md:table-cell' },
    { key: 'status', header: '状态', className: 'hidden md:table-cell' },
    { key: 'createdAt', header: '创建时间', className: 'hidden xl:table-cell' },
    { key: 'actions', header: '操作', className: 'text-right' },
  ];

  const renderRow = (user: User) => (
    <TableRow key={user.id} className={`group hover:bg-muted/50 transition-colors border-b last:border-none ${selected.has(user.id) ? 'bg-primary/[0.03]' : ''}`}>
      {canUpdate && (
        <TableCell className="w-8 pr-0">
          <Checkbox
            aria-label={`选择用户 ${user.name}`}
            checked={selected.has(user.id)}
            disabled={user.id === currentUserId}
            title={user.id === currentUserId ? '不能选择当前登录账号' : undefined}
            onCheckedChange={(checked) => toggleSelect(user.id, checked === true)}
          />
        </TableCell>
      )}
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-7 w-7 shrink-0 shadow-sm">
            <AvatarImage src={user.avatarUrl || ''} alt="" />
            <AvatarFallback className="bg-primary/10 text-foreground text-[10px] font-semibold">
              {avatarFallback(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="flex items-center gap-1.5">
              <span className="block max-w-[220px] truncate text-[12px] font-medium leading-4 text-foreground" title={user.name}>{user.name}</span>
              {user.id === currentUserId && <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px]">当前账号</Badge>}
            </span>
            <span className="block max-w-[240px] truncate text-[10px] leading-3 text-muted-foreground" title={`${user.username} • ${user.email}`}>
              {user.username} • {user.email}
            </span>
            <span className="mt-0.5 flex flex-wrap items-center gap-1 md:hidden">
              <Badge variant={accountStatus(user.status).variant}>{accountStatus(user.status).label}</Badge>
              {user.roleCount === 0 && <Badge variant="warning">未分配角色</Badge>}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex items-center gap-1.5 text-sm text-foreground/80">
          <Building className="h-3.5 w-3.5 text-muted-foreground" />
          {user.deptId && user.deptName ? (
            <Link
              href={`/users?deptId=${encodeURIComponent(user.deptId)}${pageSize !== 20 ? `&pageSize=${pageSize}` : ''}`}
              className="hover:text-primary hover:underline"
              aria-label={`查看 ${user.name} 所在的 ${user.deptName} 成员`}
              title="按该部门筛选用户"
            >
              {user.deptName}
            </Link>
          ) : (
            <span className="italic text-muted-foreground">未分配</span>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        {user.roleCount === 0 ? (
          <Badge variant="warning" title="未分配角色：即使状态正常也无法登录门户">未分配</Badge>
        ) : (
          <span className="text-[12px] text-muted-foreground"><span className="tabular-nums text-foreground">{user.roleCount}</span> 个角色</span>
        )}
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <Badge variant={accountStatus(user.status).variant}>
          {accountStatus(user.status).label}
        </Badge>
      </TableCell>
      <TableCell className="hidden font-mono text-xs text-muted-foreground xl:table-cell">
        {formatDate(user.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <div className="hidden items-center justify-end gap-0.5 md:flex">
          {/* U-USERS01：详情入口按 user:read 渲染——此前包在 user:update 里，只有 read 的
              只读角色在列表行没有任何入口（而详情页本身已支持只读模式）。是否有编辑权限
              由详情页内部 canUpdate 决定（只读横幅 + fieldset 禁用）。 */}
          <PermissionGuard permission={USER_PERMISSIONS.READ}>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label={`查看详情 ${user.name}`} title={`查看详情 ${user.name}`}>
              <Link href={`/users/${user.id}?returnTo=${encodeURIComponent(currentListHref)}`}><Eye className="h-4 w-4" /><span className="hidden md:inline">详情</span></Link>
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={USER_PERMISSIONS.ASSIGN_ROLE}>
            <Button
              asChild
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              aria-label={`分配角色 ${user.name}`}
              title="分配角色"
            >
              <Link href={`/users/${user.id}/roles?returnTo=${encodeURIComponent(currentListHref)}`}><Shield className="h-4 w-4" /><span className="hidden md:inline">分配角色</span></Link>
            </Button>
          </PermissionGuard>
          {user.id !== currentUserId && (
          <PermissionGuard permission={USER_PERMISSIONS.UPDATE}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={user.status === 'ACTIVE' ? `禁用账号 ${user.name}` : user.status === 'LOCKED' ? `解锁账号 ${user.name}` : `恢复账号 ${user.name}`}
              title={user.status === 'ACTIVE' ? `禁用账号 ${user.name}` : user.status === 'LOCKED' ? `解锁账号 ${user.name}` : `恢复账号 ${user.name}`}
              className={`h-8 gap-1.5 px-2 ${user.status === 'ACTIVE' ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : 'text-success hover:bg-success/10 hover:text-success'}`}
              disabled={isPending}
              onClick={() => handleToggleStatus(user)}
            >
              {user.status === 'ACTIVE' ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              <span className="hidden md:inline">{user.status === 'ACTIVE' ? '禁用' : user.status === 'LOCKED' ? '解锁' : '恢复'}</span>
            </Button>
          </PermissionGuard>
          )}
        </div>
        {/* 移动端：操作收进菜单，避免第三颗图标被裁切 */}
        <div className="flex justify-end md:hidden">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`更多操作 ${user.name}`} title="更多操作">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
              <PermissionGuard permission={USER_PERMISSIONS.READ}>
                <DropdownMenuItem asChild>
                  <Link href={`/users/${user.id}?returnTo=${encodeURIComponent(currentListHref)}`}><Eye className="mr-2 h-4 w-4" />详情</Link>
                </DropdownMenuItem>
              </PermissionGuard>
              <PermissionGuard permission={USER_PERMISSIONS.ASSIGN_ROLE}>
                <DropdownMenuItem asChild>
                  <Link href={`/users/${user.id}/roles?returnTo=${encodeURIComponent(currentListHref)}`}><Shield className="mr-2 h-4 w-4" />分配角色</Link>
                </DropdownMenuItem>
              </PermissionGuard>
              {user.id !== currentUserId && (
              <PermissionGuard permission={USER_PERMISSIONS.UPDATE}>
                <DropdownMenuItem onSelect={() => handleToggleStatus(user)}>
                  {user.status === 'ACTIVE' ? <UserMinus className="mr-2 h-4 w-4 text-destructive" /> : <UserCheck className="mr-2 h-4 w-4 text-success" />}
                  {user.status === 'ACTIVE' ? '禁用' : user.status === 'LOCKED' ? '解锁' : '恢复'}
                </DropdownMenuItem>
              </PermissionGuard>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </TableCell>
    </TableRow>
  );

  return (<>
    <div className="flex min-h-0 flex-1 flex-col">
    <DataTable
      tableLabel="用户列表"
      columns={columns}
      data={optimisticUsers}
      loading={isPending}
      emptyState={
        isFiltered ? (
          <EmptyState
            variant="simple"
            kind="filtered"
            icon="Inbox"
            clearAction={{ label: '清除筛选', href: clearHref }}
          />
        ) : (
          <EmptyState
            variant="simple"
            icon="UserPlus"
            title="暂无用户"
            description="系统中还没有用户账号"
            action={canCreate ? { label: '新建用户', href: '/users?create=1' } : undefined}
          />
        )
      }
      renderRow={renderRow}
      cardHeader={<>
        {filters}
        {canUpdate && selectedCount > 0 && (
          <div role="region" aria-label="批量操作" className="flex flex-wrap items-center gap-2 border-b bg-primary/[0.04] px-3 py-1.5">
            <span role="status" aria-live="polite" className="text-[12px] font-medium">已选 {selectedCount} 人（当前页）</span>
            <Button size="sm" className="h-7 bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={() => setBulkTarget('DISABLED')}>
              批量禁用
            </Button>
            <Button size="sm" variant="outline" className="h-7" onClick={() => setBulkTarget('ACTIVE')}>
              批量恢复
            </Button>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => setSelected(new Set())}>取消选择</Button>
          </div>
        )}
      </>}
    />

    <TablePagination
      page={pagination.page}
      totalPages={pagination.totalPages}
      total={pagination.total}
      onPageChange={handlePageChange}
      disabled={isPending}
      pageSize={pageSize}
      pageSizeOptions={[20, 50, 100].map((size) => {
        const next = new URLSearchParams(searchParams.toString());
        next.delete('page');
        if (size === 20) next.delete('pageSize'); else next.set('pageSize', String(size));
        const qs = next.toString();
        return { value: size, href: `${pathname}${qs ? `?${qs}` : ''}` };
      })}
    />

    {/* 单条禁用确认：与批量同语义，禁用立即撤销会话 */}
    <Dialog open={!!statusConfirmTarget} onOpenChange={(open) => { if (!open) setStatusConfirmTarget(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>禁用用户「{statusConfirmTarget?.name}」？</DialogTitle>
          <DialogDescription>
            禁用后立即撤销该用户在所有接入子系统中的活跃会话，用户将无法登录；账号与角色配置保留，可随时恢复。
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => setStatusConfirmTarget(null)}>取消</Button>
          <Button
            variant="destructive"
            onClick={() => {
              const target = statusConfirmTarget;
              if (!target) return;
              setStatusConfirmTarget(null);
              performToggleStatus(target);
            }}
          >
            确认禁用
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    {/* 批量启用/禁用确认：明确人数与影响（禁用会立即撤销活跃会话） */}
    <Dialog open={bulkTarget !== null} onOpenChange={(open) => { if (!open) setBulkTarget(null); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{bulkTarget === 'DISABLED' ? '批量禁用用户？' : '批量恢复用户？'}</DialogTitle>
          <DialogDescription>
            将对已选的 {selectedCount} 个用户执行{bulkTarget === 'DISABLED' ? '禁用' : '恢复'}
            {bulkTarget === 'DISABLED' ? '：禁用会立即撤销其所有活跃会话，无法登录' : '：恢复后用户可正常登录并保留原有角色'}。
          </DialogDescription>
          {lockedSelectedCount > 0 && (
            <p className="rounded-md bg-badge-warning-bg px-2 py-1.5 text-[11px] text-badge-warning-fg">
              {bulkTarget === 'DISABLED'
                ? `其中 ${lockedSelectedCount} 个已锁定用户无法直接禁用，将被跳过。`
                : `其中 ${lockedSelectedCount} 个已锁定用户将同时解锁，并清除登录失败计数。`}
            </p>
          )}
        </DialogHeader>
        <ul className="space-y-0.5 text-[12px] text-muted-foreground">
          {users.filter((u) => selected.has(u.id)).slice(0, 8).map((u) => (
            <li key={u.id} className="truncate">{u.name} <span className="font-mono text-[11px]">({u.username})</span></li>
          ))}
          {selectedCount > 8 && <li>… 其余 {selectedCount - 8} 人</li>}
        </ul>
        <DialogFooter>
          <Button variant="outline" onClick={() => setBulkTarget(null)} disabled={bulking}>取消</Button>
          <Button
            variant={bulkTarget === 'DISABLED' ? 'destructive' : 'default'}
            onClick={runBulk}
            disabled={bulking || (bulkTarget === 'DISABLED' && disableEffectiveCount === 0)}
          >
            {bulking
              ? '处理中...'
              : bulkTarget === 'DISABLED' && disableEffectiveCount === 0
                ? '无可禁用用户'
                : `确认${bulkTarget === 'DISABLED' ? '禁用' : '恢复'} ${bulkTarget === 'DISABLED' ? disableEffectiveCount : selectedCount} 人`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </div>
  </>);
}

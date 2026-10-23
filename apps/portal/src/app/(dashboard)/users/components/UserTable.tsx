'use client';

/**
 * 用户管理数据表格与分页组件
 * 采用 React 19 useTransition 绑定 Server Action Controller，安全下沉领域逻辑
 */

import { useState, useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { useFieldFailure } from '@/hooks/use-field-failure';
import {
  Eye,
  UserMinus,
  UserCheck,
  Shield,
  Building
} from 'lucide-react';
import AssignRoleDialog from './AssignRoleDialog';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { USER_PERMISSIONS, type UserStatus } from '@auth-sso/contracts';
import { toggleUserStatusAction, unlockUserAction } from '../actions';

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

export default function UserTable({ users, pagination, filters, isFiltered = false, clearHref = '/users' }: UserTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 角色分配对话框状态
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const { reportFailure } = useFieldFailure();
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

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

  const [, startTransition] = useTransition();

  const handleToggleStatus = (user: User) => {
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
      }
    });
  };

  /**
   * 翻页更改 URL 参数
   */
  const handlePageChange = (newPage: number) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set('page', newPage.toString());
    router.push(`${pathname}?${params.toString()}`);
  };

  const columns = [
    { key: 'user', header: '用户信息', className: 'w-[300px]' },
    { key: 'dept', header: '部门' },
    { key: 'status', header: '状态' },
    { key: 'createdAt', header: '创建时间' },
    { key: 'actions', header: '操作', className: 'text-right' },
  ];

  const renderRow = (user: User) => (
    <TableRow key={user.id} className="group hover:bg-muted/50 transition-colors border-b last:border-none">
      <TableCell>
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 ring-2 ring-background transition-transform duration-300 group-hover:scale-110 shadow-sm">
            <AvatarImage src={user.avatarUrl || ''} />
            <AvatarFallback className="bg-primary/5 text-primary text-[10px] font-black uppercase">
              {avatarFallback(user.name)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="block max-w-[240px] truncate text-sm font-medium leading-tight text-foreground" title={user.name}>{user.name}</span>
            <span className="block max-w-[240px] truncate text-xs text-muted-foreground" title={`${user.username} • ${user.email}`}>
              {user.username} • {user.email}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 text-sm text-foreground/80">
          <Building className="h-3.5 w-3.5 text-muted-foreground" />
          {user.deptName || <span className="italic text-muted-foreground">未分配</span>}
        </div>
      </TableCell>
      <TableCell>
        <Badge variant={accountStatus(user.status).variant}>
          {accountStatus(user.status).label}
        </Badge>
      </TableCell>
      <TableCell className="font-mono text-xs text-muted-foreground">
        {formatDate(user.createdAt)}
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          {/* U-USERS01：详情入口按 user:read 渲染——此前包在 user:update 里，只有 read 的
              只读角色在列表行没有任何入口（而详情页本身已支持只读模式）。是否有编辑权限
              由详情页内部 canUpdate 决定（只读横幅 + fieldset 禁用）。 */}
          <PermissionGuard permission={USER_PERMISSIONS.READ}>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label="查看详情" title="查看详情">
              <Link href={`/users/${user.id}`}><Eye className="h-4 w-4" /><span>详情</span></Link>
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={USER_PERMISSIONS.ASSIGN_ROLE}>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 gap-1.5 px-2"
              aria-label="分配角色"
              title="分配角色"
              onClick={() => { setSelectedUser(user); setRoleDialogOpen(true); }}
            >
              <Shield className="h-4 w-4" /><span>分配角色</span>
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={USER_PERMISSIONS.UPDATE}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={user.status === 'ACTIVE' ? '禁用账号' : user.status === 'LOCKED' ? '解锁账号' : '恢复账号'}
              title={user.status === 'ACTIVE' ? '禁用账号' : user.status === 'LOCKED' ? '解锁账号' : '恢复账号'}
              className={`h-8 gap-1.5 px-2 ${user.status === 'ACTIVE' ? 'text-destructive hover:bg-destructive/10 hover:text-destructive' : 'text-success hover:bg-success/10 hover:text-success'}`}
              onClick={() => handleToggleStatus(user)}
            >
              {user.status === 'ACTIVE' ? <UserMinus className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
              <span>{user.status === 'ACTIVE' ? '禁用' : user.status === 'LOCKED' ? '解锁' : '恢复'}</span>
            </Button>
          </PermissionGuard>
        </div>
      </TableCell>
    </TableRow>
  );

  return (<>
    <div className="flex min-h-0 flex-1 flex-col">
    <DataTable
      columns={columns}
      data={optimisticUsers}
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
          />
        )
      }
      renderRow={renderRow}
      cardHeader={filters}
    />

    <TablePagination
      page={pagination.page}
      totalPages={pagination.totalPages}
      total={pagination.total}
      onPageChange={handlePageChange}
    />
    </div>

    {/* 角色分配对话框 */}
    {selectedUser && (
      <AssignRoleDialog
        open={roleDialogOpen}
        onOpenChange={(open) => { setRoleDialogOpen(open); if (!open) setSelectedUser(null); }}
        user={{
          id: selectedUser.id,
          name: selectedUser.name,
          deptId: selectedUser.deptId,
          deptName: selectedUser.deptName,
        }}
      />
    )}
  </>);
}

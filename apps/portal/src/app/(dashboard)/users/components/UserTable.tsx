'use client';

/**
 * 用户管理数据表格与分页组件
 * 采用 React 19 useTransition 绑定 Server Action Controller，安全下沉领域逻辑
 */

import { useState, useOptimistic, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  UserPlus,
  MoreHorizontal,
  Edit,
  UserMinus,
  UserCheck,
  Shield,
  Building,
  ChevronRight
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { toggleUserStatusAction } from '../actions';

/**
 * 用户类型定义 (对齐领域 UserProps)
 */
interface User {
  id: string;
  
  username: string;
  email: string | null;
  name: string;
  avatarUrl: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED' | 'DELETED';
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
}

/**
 * 局部骨架屏组件
 */
export function UserTableSkeleton() {
  return (
    <div className="border border-slate-100 rounded-xl overflow-hidden bg-white">
      <Table>
        <TableHeader className="bg-slate-50/30">
          <TableRow className="border-b">
            <TableHead className="pl-6 w-[300px] text-[10px] font-black uppercase tracking-widest text-slate-400">用户信息</TableHead>
            <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">部门</TableHead>
            <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">状态</TableHead>
            <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">创建时间</TableHead>
            <TableHead className="text-right pr-6 text-[10px] font-black uppercase tracking-widest text-slate-400">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 6 }).map((_, i) => (
            <TableRow key={i}>
              <TableCell className="pl-6 py-4">
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
              <TableCell className="text-right pr-6">
                <Skeleton className="ml-auto h-8 w-8 rounded-lg" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export default function UserTable({ users, pagination, filters }: UserTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // 角色分配对话框状态
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);

  // useOptimistic: 状态切换立即反映在 UI，失败自动回退
  const [optimisticUsers, setOptimisticUser] = useOptimistic(
    users,
    (state, toggledId: string) =>
      state.map((u) =>
        u.id === toggledId
          ? { ...u, status: (u.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE') as User['status'] }
          : u,
      ),
  );

  const [, startTransition] = useTransition();

  const handleToggleStatus = (user: User) => {
    startTransition(async () => {
      setOptimisticUser(user.id); // 即时翻转 UI
      const res = await toggleUserStatusAction(user.id);
      if (!res.success) {
        toast.error(res.message || '操作失败');
      } else {
        toast.success('用户状态已更新');
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
    { key: 'user', header: '用户信息', className: 'pl-6 w-[300px]' },
    { key: 'dept', header: '部门' },
    { key: 'status', header: '状态' },
    { key: 'createdAt', header: '创建时间' },
    { key: 'actions', header: '操作', className: 'text-right pr-6' },
  ];

  const renderRow = (user: User) => (
    <TableRow key={user.id} className="group hover:bg-slate-50/50 transition-colors border-b last:border-none">
      <TableCell className="pl-6 py-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 ring-2 ring-background transition-transform duration-300 group-hover:scale-110 shadow-sm">
            <AvatarImage src={user.avatarUrl || ''} />
            <AvatarFallback className="bg-primary/5 text-primary text-[10px] font-black uppercase">
              {user.name.substring(0, 2)}
            </AvatarFallback>
          </Avatar>
          <div className="flex flex-col">
            <span className="font-bold text-sm leading-tight text-slate-800">{user.name}</span>
            <span className="text-[10px] text-muted-foreground font-bold tracking-tight">
              {user.username} • {user.email}
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-1.5 text-xs font-bold text-slate-600">
          <Building className="h-3.5 w-3.5 text-slate-300" />
          {user.deptName || <span className="text-muted-foreground italic text-[10px] font-medium">未分配</span>}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant={user.status === 'ACTIVE' ? 'default' : user.status === 'LOCKED' ? 'destructive' : 'secondary'}
          className={`px-2 py-0 h-5 text-[10px] font-black rounded-md ${user.status === 'ACTIVE' ? 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100 border-none' : ''}`}
        >
          {user.status === 'ACTIVE' ? '正常' : user.status === 'LOCKED' ? '已锁定' : '已禁用'}
        </Badge>
      </TableCell>
      <TableCell className="text-[10px] text-muted-foreground font-mono font-black">
        {new Date(user.createdAt).toLocaleDateString()}
      </TableCell>
      <TableCell className="text-right pr-6">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-slate-100 transition-colors">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-2xl p-1 shadow-2xl ring-1 ring-black/5 border-none">
            <DropdownMenuLabel className="text-[9px] font-black text-slate-400 uppercase tracking-widest px-3 py-2">用户控制</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="cursor-pointer rounded-xl mb-1 focus:bg-slate-50">
              <Link href={`/users/${user.id}`}>
                <Edit className="mr-2 h-4 w-4 opacity-50" /> 详情/编辑
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer rounded-xl mb-1 focus:bg-slate-50"
              onClick={() => { setSelectedUser(user); setRoleDialogOpen(true); }}
            >
              <Shield className="mr-2 h-4 w-4 opacity-50" /> 分配角色
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={`cursor-pointer rounded-xl ${user.status === 'ACTIVE' ? 'text-rose-500 hover:bg-rose-50' : 'text-emerald-500 hover:bg-emerald-50'}`}
              onClick={() => handleToggleStatus(user)}
            >
              {user.status === 'ACTIVE' ? (
                <><UserMinus className="mr-2 h-4 w-4" /> 禁用账号</>
              ) : (
                <><UserCheck className="mr-2 h-4 w-4" /> 恢复账号</>
              )}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );

  return (<>
    <DataTable
      columns={columns}
      data={optimisticUsers}
      emptyState={
        <EmptyState
          variant="simple"
          icon={UserPlus}
          title="暂无用户"
          description="系统中还没有用户账号"
        />
      }
      renderRow={renderRow}
      cardHeader={filters}
    />

    {/* 统一分页器 UI */}
    <div className="flex items-center justify-between px-6 py-4 bg-muted/50 border-t mt-4 rounded-b-xl">
      <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">
        TOTAL RECORDS: <span className="text-slate-900">{pagination.total}</span>
      </p>
      <div className="flex gap-1.5">
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-xl shadow-sm hover:bg-white bg-white border-slate-200"
          disabled={pagination.page === 1}
          onClick={() => handlePageChange(pagination.page - 1)}
        >
          <ChevronRight className="h-3.5 w-3.5 rotate-180" />
        </Button>
        <div className="flex items-center justify-center text-[10px] font-black px-4 bg-white border border-slate-200 rounded-xl shadow-sm min-w-[60px]">
          {pagination.page} / {pagination.totalPages || 1}
        </div>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8 rounded-xl shadow-sm hover:bg-white bg-white border-slate-200"
          disabled={pagination.page >= pagination.totalPages}
          onClick={() => handlePageChange(pagination.page + 1)}
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
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

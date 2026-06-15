'use client';

/**
 * 用户管理数据表格与分页组件
 * 采用 React 19 useTransition 绑定 Server Action Controller，安全下沉领域逻辑
 */

import { useOptimistic, useTransition } from 'react';
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
import { toggleUserStatusAction } from '../actions';

/**
 * 用户类型定义 (对齐领域 UserProps)
 */
interface User {
  id: string;
  publicId: string;
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
}

/**
 * 局部骨架屏组件
 */
export function UserTableSkeleton() {
  return (
    <div className="border border-slate-100 rounded-[1.5rem] overflow-hidden bg-white">
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

export default function UserTable({ users, pagination }: UserTableProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

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
      if (!res.success) toast.error(res.message || '操作失败');
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

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      <div className="flex-1 overflow-auto bg-white border border-slate-100 rounded-[1.5rem] shadow-sm">
        <Table>
          <TableHeader className="bg-slate-50/30 sticky top-0 z-10 backdrop-blur-md">
            <TableRow className="border-b">
              <TableHead className="pl-6 w-[300px] text-[10px] font-black uppercase tracking-widest text-slate-400">用户信息</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">部门</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">状态</TableHead>
              <TableHead className="text-[10px] font-black uppercase tracking-widest text-slate-400">创建时间</TableHead>
              <TableHead className="text-right pr-6 text-[10px] font-black uppercase tracking-widest text-slate-400">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {optimisticUsers.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-64 text-center">
                  <div className="flex flex-col items-center justify-center space-y-2 opacity-40">
                    <div className="h-12 w-12 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">
                      <UserPlus className="h-6 w-6" />
                    </div>
                    <p className="text-sm font-bold text-slate-500 italic">未找到匹配的用户</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              optimisticUsers.map((user) => (
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
                        <DropdownMenuItem className="cursor-pointer rounded-xl mb-1 focus:bg-slate-50">
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
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* 统一分页器 UI */}
      <div className="flex items-center justify-between px-6 py-4 bg-slate-50/50 border-t mt-4 rounded-b-[1.5rem]">
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
    </div>
  );
}

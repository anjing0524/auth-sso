/**
 * 用户管理页面 - 现代化重构版
 * 基于 shadcn/ui 提升数据密度与交互感
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { 
  Search, 
  UserPlus, 
  MoreHorizontal, 
  Edit, 
  UserMinus, 
  UserCheck,
  Shield,
  Building,
  ChevronRight,
  X
} from 'lucide-react';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { PermissionGuard } from '@/components/ui/permission-guard';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { Label } from '@/components/ui/label';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from '@/components/ui/select';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet';

interface User {
  id: string;
  publicId: string;
  username: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  deptId: string | null;
  deptName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
}

interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [pagination, setPagination] = useState<Pagination>({
    page: 1, pageSize: 15, total: 0, totalPages: 0,
  });
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // 新增用户状态 (Drawer)
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [newUser, setNewUser] = useState({ 
    name: '', 
    username: '', 
    email: '', 
    password: 'password123',
    deptId: '' 
  });

  const fetchUsers = useCallback(async (page = pagination.page) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pagination.pageSize.toString(),
      });
      if (keyword) params.append('keyword', keyword);
      if (statusFilter !== 'ALL') params.append('status', statusFilter);

      const response = await fetch(`/api/users?${params.toString()}`);
      const data = await response.json();

      if (response.ok) {
        setUsers(data.data);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Failed to fetch users:', error);
      toast.error('获取用户列表失败');
    } finally {
      setLoading(false);
    }
  }, [pagination.pageSize, keyword, statusFilter]);

  const handleCreateUser = async () => {
    if (!newUser.name || !newUser.username || !newUser.email) {
      return toast.error('请填写完整信息');
    }
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      });
      if (response.ok) {
        toast.success('用户创建成功');
        setIsSheetOpen(false);
        setNewUser({ name: '', username: '', email: '', password: 'password123', deptId: '' });
        fetchUsers(1);
      } else {
        const err = await response.json();
        toast.error(err.message || '创建失败');
      }
    } catch (error) {
      toast.error('请求失败');
    }
  };

  useEffect(() => {
    fetchUsers(1);
  }, [keyword, statusFilter]);

  const handleToggleStatus = async (user: User) => {
    const newStatus = user.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
    try {
      const response = await fetch(`/api/users/${user.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus }),
      });

      if (response.ok) {
        toast.success(`用户状态已更新为 ${newStatus}`);
        fetchUsers();
      }
    } catch (error) {
      console.error('Failed to toggle status:', error);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">用户管理</h1>
          <p className="text-muted-foreground text-sm font-medium text-slate-500 mt-1">
            查看和管理系统内的所有用户账户及权限。
          </p>
        </div>
        <PermissionGuard permission="user:create">
          <Button className="rounded-xl h-11 px-6 shadow-lg shadow-primary/20" onClick={() => setIsSheetOpen(true)}>
            <UserPlus className="mr-2 h-4 w-4" /> 新增用户
          </Button>
        </PermissionGuard>
      </div>

      {/* 新建用户抽屉 (Sheet) */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="sm:max-w-[500px]">
          <SheetHeader className="pb-6 border-b">
            <SheetTitle className="text-2xl font-black text-slate-900">创建新用户</SheetTitle>
            <SheetDescription className="text-slate-500 font-medium">输入用户的基本信息以创建新的系统账号。</SheetDescription>
          </SheetHeader>
          <div className="grid gap-6 py-8">
            <div className="space-y-2">
              <Label className="font-bold text-slate-700">显示名称</Label>
              <Input 
                className="h-11 rounded-xl focus:ring-2 focus:ring-primary/10 transition-all"
                placeholder="例如：张三" 
                value={newUser.name} 
                onChange={e => setNewUser({...newUser, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-700">登录账号 (Username)</Label>
              <Input 
                className="h-11 rounded-xl font-mono"
                placeholder="例如：zhangsan" 
                value={newUser.username} 
                onChange={e => setNewUser({...newUser, username: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-700">电子邮箱</Label>
              <Input 
                type="email"
                className="h-11 rounded-xl"
                placeholder="zhangsan@example.com" 
                value={newUser.email} 
                onChange={e => setNewUser({...newUser, email: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-700">初始密码</Label>
              <Input 
                type="password"
                className="h-11 rounded-xl"
                value={newUser.password} 
                onChange={e => setNewUser({...newUser, password: e.target.value})}
              />
            </div>
          </div>
          <SheetFooter className="absolute bottom-0 left-0 right-0 p-6 border-t bg-slate-50/50">
            <Button variant="ghost" className="flex-1 rounded-xl" onClick={() => setIsSheetOpen(false)}>取消</Button>
            <Button onClick={handleCreateUser} className="flex-1 rounded-xl shadow-lg shadow-primary/20">确认创建</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <Card className="flex-1 border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem] flex flex-col bg-white">
        <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 py-4 px-6 border-b">
          <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
            <div className="relative w-full md:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
              <Input
                placeholder="搜索用户名、邮箱或姓名..."
                className="pl-10 h-11 rounded-xl bg-white border-slate-200 focus:ring-2 focus:ring-primary/10 transition-all"
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
              />
              {keyword && (
                <button 
                  onClick={() => setKeyword('')} 
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition-colors"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-3 w-full md:w-auto">
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                <SelectTrigger className="w-full md:w-[150px] h-11 rounded-xl shadow-sm border-slate-200 bg-white">
                  <SelectValue placeholder="过滤状态" />
                </SelectTrigger>
                <SelectContent className="rounded-xl">
                  <SelectItem value="ALL">全部状态</SelectItem>
                  <SelectItem value="ACTIVE">正常</SelectItem>
                  <SelectItem value="DISABLED">已禁用</SelectItem>
                  <SelectItem value="LOCKED">已锁定</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0 flex-1 overflow-auto">
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
              {loading && users.length === 0 ? (
                Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="pl-6">
                      <div className="flex gap-3">
                        <Skeleton className="h-10 w-10 rounded-full" />
                        <div className="space-y-1.5">
                          <Skeleton className="h-4 w-24" />
                          <Skeleton className="h-3 w-32" />
                        </div>
                      </div>
                    </TableCell>
                    <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                    <TableCell><Skeleton className="h-5 w-16 rounded-lg" /></TableCell>
                    <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                    <TableCell className="text-right pr-6"><Skeleton className="ml-auto h-8 w-8 rounded-lg" /></TableCell>
                  </TableRow>
                ))
              ) : users.length === 0 ? (
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
                users.map((user) => (
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
                          <span className="text-[10px] text-muted-foreground font-bold tracking-tight">{user.username} • {user.email}</span>
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
        </CardContent>
        {/* 统一分页器 UI */}
        <div className="flex items-center justify-between px-6 py-4 bg-slate-50/50 border-t">
          <p className="text-[10px] font-black text-slate-400 uppercase tracking-tighter">
            TOTAL RECORDS: <span className="text-slate-900">{pagination.total}</span>
          </p>
          <div className="flex gap-1.5">
            <Button 
              variant="outline" 
              size="icon" 
              className="h-8 w-8 rounded-xl shadow-sm hover:bg-white bg-white border-slate-200" 
              disabled={pagination.page === 1 || loading}
              onClick={() => fetchUsers(pagination.page - 1)}
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
              disabled={pagination.page >= pagination.totalPages || loading}
              onClick={() => fetchUsers(pagination.page + 1)}
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

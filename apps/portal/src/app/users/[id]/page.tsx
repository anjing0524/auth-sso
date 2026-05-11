/**
 * 用户详情与编辑页面
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { 
  User as UserIcon, 
  ArrowLeft, 
  Save, 
  Trash2, 
  Shield, 
  Building, 
  Mail, 
  Calendar,
  Lock,
  Unlock,
  AlertTriangle
} from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription,
  DialogTrigger
} from '@/components/ui/dialog';

interface User {
  id: string;
  name: string;
  username: string;
  email: string;
  deptId: string | null;
  deptName: string | null;
  status: 'ACTIVE' | 'DISABLED' | 'LOCKED';
  createdAt: string;
}

export default function UserDetailPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  const fetchUser = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/users/${id}`);
      const data = await response.json();
      if (response.ok) {
        setUser(data.data);
      } else {
        toast.error('用户不存在');
        router.push('/users');
      }
    } catch (error) {
      console.error('Failed to fetch user:', error);
      toast.error('获取用户信息失败');
    } finally {
      setLoading(false);
    }
  }, [id, router]);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  const handleUpdate = async () => {
    if (!user) return;
    setSaving(true);
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: user.name,
          email: user.email,
          status: user.status,
          deptId: user.deptId
        }),
      });
      if (response.ok) {
        toast.success('用户信息更新成功');
        fetchUser();
      } else {
        toast.error('更新失败');
      }
    } catch (error) {
      toast.error('网络错误');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    try {
      const response = await fetch(`/api/users/${id}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        toast.success('用户已成功删除');
        setIsDeleteOpen(false);
        router.push('/users');
      } else {
        toast.error('删除失败');
      }
    } catch (error) {
      toast.error('删除失败');
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-32" />
        <div className="grid grid-cols-12 gap-6">
          <Skeleton className="col-span-8 h-[500px] rounded-[2rem]" />
          <Skeleton className="col-span-4 h-[300px] rounded-[2rem]" />
        </div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" asChild>
            <Link href="/users"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">{user.name}</h1>
            <p className="text-muted-foreground text-sm font-medium">账号 ID: <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{user.id}</code></p>
          </div>
        </div>
        <div className="flex gap-3">
          <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <DialogTrigger render={<Button variant="destructive" className="rounded-xl px-6 bg-red-50 text-red-600 hover:bg-red-100 border-none shadow-none" />}>
              <Trash2 className="mr-2 h-4 w-4" /> 删除用户
            </DialogTrigger>
            <DialogContent className="rounded-[2rem]">
              <DialogHeader>
                <DialogTitle className="text-xl font-black text-red-600">确认永久删除？</DialogTitle>
                <DialogDescription>
                  此操作将立即注销用户 <strong>{user.name}</strong> 的所有访问权限。该操作不可撤销。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>取消</Button>
                <Button onClick={handleDelete} className="bg-red-600 hover:bg-red-700 rounded-xl px-8">确认删除</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button onClick={handleUpdate} disabled={saving} className="rounded-xl px-8 shadow-lg shadow-primary/20">
            {saving ? '保存中...' : <><Save className="mr-2 h-4 w-4" /> 保存更改</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        <Card className="col-span-8 border-none shadow-sm ring-1 ring-border/50 rounded-[2rem] overflow-hidden bg-white">
          <CardHeader className="border-b bg-slate-50/30">
            <CardTitle className="text-lg font-black flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-primary" /> 基本资料
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
             <div className="grid grid-cols-2 gap-8">
                <div className="space-y-2">
                  <Label className="font-bold text-slate-700">显示名称</Label>
                  <Input 
                    value={user.name} 
                    onChange={e => setUser({...user, name: e.target.value})}
                    className="h-11 rounded-xl focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-slate-700">电子邮箱</Label>
                  <Input 
                    value={user.email} 
                    onChange={e => setUser({...user, email: e.target.value})}
                    className="h-11 rounded-xl focus:ring-2 focus:ring-primary/10"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-slate-700">登录账号 (Username)</Label>
                  <Input value={user.username} disabled className="h-11 rounded-xl bg-slate-50 opacity-60" />
                </div>
                <div className="space-y-2">
                  <Label className="font-bold text-slate-700">账户状态</Label>
                  <Select value={user.status} onValueChange={(v: any) => setUser({...user, status: v})}>
                    <SelectTrigger className="h-11 rounded-xl">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="rounded-xl">
                      <SelectItem value="ACTIVE">正常 (Active)</SelectItem>
                      <SelectItem value="DISABLED">禁用 (Disabled)</SelectItem>
                      <SelectItem value="LOCKED">锁定 (Locked)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
             </div>
          </CardContent>
        </Card>

        <div className="col-span-4 space-y-6">
           <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-[2rem] overflow-hidden bg-white">
              <CardHeader className="pb-2">
                 <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-400">系统信息</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                 <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                       <Building className="h-4 w-4" />
                    </div>
                    <div>
                       <p className="text-[10px] font-bold text-slate-400 uppercase">所属部门</p>
                       <p className="text-sm font-bold text-slate-700">{user.deptName || '未分配'}</p>
                    </div>
                 </div>
                 <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                       <Calendar className="h-4 w-4" />
                    </div>
                    <div>
                       <p className="text-[10px] font-bold text-slate-400 uppercase">创建于</p>
                       <p className="text-sm font-bold text-slate-700">{new Date(user.createdAt).toLocaleString()}</p>
                    </div>
                 </div>
                 <div className="flex items-center gap-3">
                    <div className="p-2 bg-slate-100 rounded-lg text-slate-500">
                       <Shield className="h-4 w-4" />
                    </div>
                    <div>
                       <p className="text-[10px] font-bold text-slate-400 uppercase">安全角色</p>
                       <div className="flex flex-wrap gap-1 mt-1">
                          <Badge variant="secondary" className="bg-primary/5 text-primary border-none rounded-md text-[10px]">系统管理员</Badge>
                       </div>
                    </div>
                 </div>
              </CardContent>
           </Card>

           <div className="bg-amber-50 border border-amber-100 rounded-3xl p-6 flex gap-4 items-start">
              <div className="p-2 bg-white rounded-xl shadow-sm text-amber-500">
                 <AlertTriangle className="h-5 w-5" />
              </div>
              <div className="space-y-1">
                 <h5 className="text-sm font-bold text-amber-800">高风险操作</h5>
                 <p className="text-xs text-amber-700/80 leading-relaxed">
                   禁用或删除用户会立即撤销其在所有接入子系统中的活跃 Session，请谨慎操作。
                 </p>
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}

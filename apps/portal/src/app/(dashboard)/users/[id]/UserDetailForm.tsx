/**
 * 用户详情编辑表单 (Client Component)
 *
 * 职责分工：
 * - Server Component 父组件负责初始数据获取
 * - 本组件只管理可编辑字段的表单状态（useState）
 * - 只读展示数据（deptName、createdAt 等）直接从 prop 读取
 * - 保存后 router.refresh() 让 Server Component 重新获取，prop 更新驱动展示区刷新
 */
'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  User as UserIcon, ArrowLeft, Save, Trash2, Shield, Building, Calendar, AlertTriangle,
} from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import { updateUserAction, deleteUserAction } from '../actions';

interface Props {
  id: string;
  initialUser: Record<string, unknown> | null;
}

export default function UserDetailForm({ id, initialUser: serverUser }: Props) {
  const router = useRouter();

  // 用户不存在时：在 useEffect 中执行副作用（toast + 导航），避免在 render 中直接调用
  // React StrictMode 下 render 可能双触发，副作用统一收敛至 Effect 中是安全的
  useEffect(() => {
    if (!serverUser) {
      toast.error('用户不存在');
      router.push('/users');
    }
  }, [serverUser, router]);

  if (!serverUser) return null;

  // 可编辑字段合并为一个 form state —— 保存后即最新值，无需 prop 同步
  const [form, setForm] = useState({
    name: serverUser.name as string,
    email: (serverUser.email as string) || '',
    status: (serverUser.status as string) || 'ACTIVE',
  });
  const [saving, setSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // 只读展示从 prop 读取 —— router.refresh() 后自动更新
  const username = serverUser.username as string;
  const deptName = (serverUser.deptName as string) || null;
  const createdAt = serverUser.createdAt as string;

  const handleUpdate = async () => {
    setSaving(true);
    const res = await updateUserAction(id, form);
    if (res.success) {
      toast.success('用户信息更新成功');
      router.refresh(); // 刷新 Server Component 数据，prop 更新只读展示区
    } else {
      toast.error(res.message || '更新失败');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    const res = await deleteUserAction(id);
    if (res.success) {
      toast.success('用户已成功删除');
      setIsDeleteOpen(false);
      router.push('/users');
    } else {
      toast.error(res.message || '删除失败');
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" asChild>
            <Link href="/users"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">{form.name}</h1>
            <p className="text-muted-foreground text-sm font-medium">
              账号 ID: <code className="text-xs bg-slate-100 px-1.5 py-0.5 rounded font-mono">{username}</code>
            </p>
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
                  此操作将立即注销用户 <strong>{form.name}</strong> 的所有访问权限。该操作不可撤销。
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
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="h-11 rounded-xl focus:ring-2 focus:ring-primary/10" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-slate-700">电子邮箱</Label>
                <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  className="h-11 rounded-xl focus:ring-2 focus:ring-primary/10" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-slate-700">登录账号 (Username)</Label>
                <Input value={username} disabled className="h-11 rounded-xl bg-slate-50 opacity-60" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-slate-700">账户状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger>
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
                <div className="p-2 bg-slate-100 rounded-lg text-slate-500"><Building className="h-4 w-4" /></div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">所属部门</p>
                  <p className="text-sm font-bold text-slate-700">{deptName || '未分配'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 rounded-lg text-slate-500"><Calendar className="h-4 w-4" /></div>
                <div>
                  <p className="text-[10px] font-bold text-slate-400 uppercase">创建于</p>
                  <p className="text-sm font-bold text-slate-700">{new Date(createdAt).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 rounded-lg text-slate-500"><Shield className="h-4 w-4" /></div>
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
            <div className="p-2 bg-white rounded-xl shadow-sm text-amber-500"><AlertTriangle className="h-5 w-5" /></div>
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

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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import AssignRoleDialog from '../components/AssignRoleDialog';
import { updateUserAction, deleteUserAction } from '../actions';

interface Props {
  id: string;
  initialUser: Record<string, unknown> | null;
}

export default function UserDetailForm({ id, initialUser: serverUser }: Props) {
  const router = useRouter();
  const user = serverUser ?? {};
  const [form, setForm] = useState({
    name: user.name as string,
    email: (user.email as string) || '',
    status: (user.status as string) || 'ACTIVE',
  });
  const [saving, setSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isRoleOpen, setIsRoleOpen] = useState(false);

  // 用户不存在时：在 useEffect 中执行副作用（toast + 导航），避免在 render 中直接调用
  // React StrictMode 下 render 可能双触发，副作用统一收敛至 Effect 中是安全的
  useEffect(() => {
    if (!serverUser) {
      toast.error('用户不存在');
      router.push('/users');
    }
  }, [serverUser, router]);

  if (!serverUser) return null;

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
            <h1 className="text-3xl font-black tracking-tight text-foreground">{form.name}</h1>
            <p className="text-muted-foreground text-sm font-medium">
              账号 ID: <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">{username}</code>
            </p>
          </div>
        </div>
        <div className="flex gap-3">
          <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <DialogTrigger render={<Button variant="destructive" className="rounded-lg px-6 bg-destructive/10 text-destructive hover:bg-destructive/20 border-none shadow-none" />}>
              <Trash2 className="mr-2 h-4 w-4" /> 删除用户
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle className="text-xl font-black text-red-600">确认永久删除？</DialogTitle>
                <DialogDescription>
                  此操作将立即注销用户 <strong>{form.name}</strong> 的所有访问权限。该操作不可撤销。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>取消</Button>
                <Button onClick={handleDelete} className="bg-destructive hover:bg-destructive/80 rounded-lg px-8">确认删除</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Button
            variant="outline"
            className="rounded-lg px-6"
            onClick={() => setIsRoleOpen(true)}
          >
            <Shield className="mr-2 h-4 w-4" /> 分配角色
          </Button>
          <Button onClick={handleUpdate} disabled={saving} className="rounded-lg px-8 shadow-lg shadow-primary/20">
            {saving ? '保存中...' : <><Save className="mr-2 h-4 w-4" /> 保存更改</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        <Card className="col-span-8 border-none shadow-sm ring-1 ring-border/50 rounded-2xl overflow-hidden bg-card">
          <CardHeader className="border-b bg-muted/50">
            <CardTitle className="text-lg font-black flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-primary" /> 基本资料
            </CardTitle>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            <div className="grid grid-cols-2 gap-8">
              <div className="space-y-2">
                <Label className="font-bold text-foreground/80">显示名称</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="h-11 rounded-lg focus:ring-2 focus:ring-primary/10" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-foreground/80">电子邮箱</Label>
                <Input value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}
                  className="h-11 rounded-lg focus:ring-2 focus:ring-primary/10" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-foreground/80">登录账号 (Username)</Label>
                <Input value={username} disabled className="h-11 rounded-lg bg-muted opacity-60" />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-foreground/80">账户状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger className="h-11 rounded-lg"><SelectValue /></SelectTrigger>
                  <SelectContent className="rounded-lg">
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
          <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-2xl overflow-hidden bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground">系统信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg text-muted-foreground"><Building className="h-4 w-4" /></div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">所属部门</p>
                  <p className="text-sm font-bold text-foreground/80">{deptName || '未分配'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg text-muted-foreground"><Calendar className="h-4 w-4" /></div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">创建于</p>
                  <p className="text-sm font-bold text-foreground/80">{new Date(createdAt).toLocaleString()}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg text-muted-foreground"><Shield className="h-4 w-4" /></div>
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase">安全角色</p>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="rounded-lg text-xs mt-1"
                    onClick={() => setIsRoleOpen(true)}
                  >
                    <Shield className="mr-1 h-3 w-3" /> 管理角色
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="bg-warning/10 border border-warning/20 rounded-3xl p-6 flex gap-4 items-start">
            <div className="p-2 bg-card rounded-xl shadow-sm text-warning"><AlertTriangle className="h-5 w-5" /></div>
            <div className="space-y-1">
              <h5 className="text-sm font-bold text-warning">高风险操作</h5>
              <p className="text-xs text-warning/80 leading-relaxed">
                禁用或删除用户会立即撤销其在所有接入子系统中的活跃 Session，请谨慎操作。
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* 角色分配对话框 */}
      <AssignRoleDialog
        open={isRoleOpen}
        onOpenChange={setIsRoleOpen}
        user={{
          id,
          name: form.name,
          deptId: (serverUser.deptId as string) || null,
          deptName: (serverUser.deptName as string) || null,
        }}
      />
    </div>
  );
}

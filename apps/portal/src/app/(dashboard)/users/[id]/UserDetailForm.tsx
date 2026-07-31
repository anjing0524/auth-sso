'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowLeft,
  Building,
  Calendar,
  Clock,
  KeyRound,
  Phone,
  Save,
  Shield,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { formatShanghaiDateTime } from '@/lib/format-time';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import AssignRoleDialog from '../components/AssignRoleDialog';
import { deleteUserAction, resetPasswordAction, updateUserAction } from '../actions';

interface UserDetail {
  id: string;
  username: string;
  email: string | null;
  mobile: string | null;
  name: string;
  status: string;
  deptId: string | null;
  deptName: string | null;
  createdAt: string;
  lastLoginAt: string | null;
  roles: Array<{ id: string; code: string; name: string; description: string | null }>;
}

interface Props {
  id: string;
  initialUser: UserDetail | null;
  canDelete: boolean;
  canUpdate: boolean;
  canAssignRole: boolean;
  canResetPassword: boolean;
}

export default function UserDetailForm({
  id,
  initialUser: serverUser,
  canDelete,
  canUpdate,
  canAssignRole,
  canResetPassword,
}: Props) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: serverUser?.name ?? '',
    email: serverUser?.email ?? '',
    mobile: serverUser?.mobile ?? '',
    status: serverUser?.status ?? 'ACTIVE',
  });
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newPassword, setNewPassword] = useState('');
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isResetOpen, setIsResetOpen] = useState(false);
  const [isRoleOpen, setIsRoleOpen] = useState(false);

  useEffect(() => {
    if (!serverUser) {
      toast.error('用户不存在');
      router.push('/users');
    }
  }, [serverUser, router]);

  if (!serverUser) return null;

  const handleUpdate = async () => {
    setSaving(true);
    try {
      const res = await updateUserAction(id, form);
      if (!res.success) {
        toast.error(res.message || '更新失败');
        return;
      }
      toast.success('用户信息更新成功');
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    const res = await deleteUserAction(id);
    if (!res.success) {
      toast.error(res.message || '删除失败');
      return;
    }
    toast.success('用户已成功删除');
    setIsDeleteOpen(false);
    router.push('/users');
  };

  const handleResetPassword = async () => {
    setResetting(true);
    try {
      const res = await resetPasswordAction(id, newPassword);
      if (!res.success) {
        toast.error(res.message || '重置失败');
        return;
      }
      toast.success(res.message);
      setNewPassword('');
      setIsResetOpen(false);
    } finally {
      setResetting(false);
    }
  };

  return (
    <div className="min-w-0 space-y-6 pb-10">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" size="icon" className="shrink-0 rounded-full" asChild>
            <Link href="/users" aria-label="返回用户列表">
              <ArrowLeft className="h-5 w-5" />
            </Link>
          </Button>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black tracking-tight text-foreground sm:text-3xl">
              {form.name}
            </h1>
            <p className="truncate text-sm font-medium text-muted-foreground">
              登录账号：<code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">{serverUser.username}</code>
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canDelete && (
            <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
              <DialogTrigger
                render={<Button variant="destructive" className="rounded-lg bg-destructive/10 text-destructive shadow-none hover:bg-destructive/20" />}
              >
                <Trash2 className="mr-2 h-4 w-4" />删除用户
              </DialogTrigger>
              <DialogContent className="rounded-2xl">
                <DialogHeader>
                  <DialogTitle className="text-xl font-black text-destructive">确认删除用户？</DialogTitle>
                  <DialogDescription>
                    用户 <strong>{form.name}</strong> 将被逻辑删除，所有活跃会话也会失效。此操作不可撤销。
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>取消</Button>
                  <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          )}
          {canResetPassword && <Dialog open={isResetOpen} onOpenChange={setIsResetOpen}>
            <DialogTrigger render={<Button variant="outline" className="rounded-lg" />}>
              <KeyRound className="mr-2 h-4 w-4" />重置密码
            </DialogTrigger>
            <DialogContent className="rounded-2xl">
              <DialogHeader>
                <DialogTitle>重置用户密码</DialogTitle>
                <DialogDescription>
                  重置后会立即撤销该用户的全部会话。新密码不能与最近使用过的密码相同。
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-2 py-2">
                <Label htmlFor="reset-password">新密码</Label>
                <Input
                  id="reset-password"
                  type="password"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="至少8位，含大小写字母和数字"
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setIsResetOpen(false)}>取消</Button>
                <Button onClick={handleResetPassword} disabled={resetting || !newPassword}>
                  {resetting ? '重置中…' : '确认重置'}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>}
          {canAssignRole && <Button variant="outline" className="rounded-lg" onClick={() => setIsRoleOpen(true)}>
            <Shield className="mr-2 h-4 w-4" />分配角色
          </Button>}
          {canUpdate && <Button onClick={handleUpdate} disabled={saving} className="rounded-lg shadow-lg shadow-primary/20">
            <Save className="mr-2 h-4 w-4" />{saving ? '保存中…' : '保存更改'}
          </Button>}
        </div>
      </div>

      <div className="grid min-w-0 gap-6 xl:grid-cols-12">
        <Card className="overflow-hidden rounded-2xl border-none bg-card shadow-sm ring-1 ring-border/50 xl:col-span-8">
          <CardHeader className="border-b bg-muted/50">
            <CardTitle className="flex items-center gap-2 text-lg font-black">
              <UserIcon className="h-5 w-5 text-primary" />基本资料
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 p-5 sm:p-8">
            <div className="grid gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="user-name">显示名称</Label>
                <Input id="user-name" value={form.name} disabled={!canUpdate} onChange={(event) => setForm({ ...form, name: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-email">电子邮箱</Label>
                <Input id="user-email" type="email" value={form.email} disabled={!canUpdate} onChange={(event) => setForm({ ...form, email: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-mobile">手机号</Label>
                <Input id="user-mobile" type="tel" value={form.mobile} disabled={!canUpdate} onChange={(event) => setForm({ ...form, mobile: event.target.value })} placeholder="未填写" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-username">登录账号</Label>
                <Input id="user-username" value={serverUser.username} disabled />
              </div>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="user-status">账户状态</Label>
                <Select value={form.status} disabled={!canUpdate} onValueChange={(status) => setForm({ ...form, status })}>
                  <SelectTrigger id="user-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">正常</SelectItem>
                    <SelectItem value="DISABLED">禁用</SelectItem>
                    <SelectItem value="LOCKED">锁定</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 xl:col-span-4">
          <Card className="overflow-hidden rounded-2xl border-none bg-card shadow-sm ring-1 ring-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black tracking-wider text-muted-foreground">账户信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              <InfoRow icon={Building} label="所属部门" value={serverUser.deptName || '未分配'} />
              <InfoRow icon={Phone} label="联系电话" value={form.mobile || '未填写'} />
              <InfoRow icon={Calendar} label="创建时间" value={formatShanghaiDateTime(serverUser.createdAt)} />
              <InfoRow icon={Clock} label="最近登录" value={serverUser.lastLoginAt ? formatShanghaiDateTime(serverUser.lastLoginAt) : '暂无登录记录'} />
              <div className="space-y-2">
                <p className="text-xs font-bold text-muted-foreground">已分配角色</p>
                <div className="flex flex-wrap gap-2">
                  {serverUser.roles.length > 0
                    ? serverUser.roles.map((role) => <Badge key={role.id} variant="secondary">{role.name}</Badge>)
                    : <span className="text-sm text-muted-foreground">尚未分配角色</span>}
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-4 rounded-2xl border border-warning/20 bg-warning/10 p-5">
            <div className="rounded-xl bg-card p-2 text-warning shadow-sm"><AlertTriangle className="h-5 w-5" /></div>
            <div className="space-y-1">
              <h2 className="text-sm font-bold text-warning">高风险操作</h2>
              <p className="text-xs leading-relaxed text-warning/80">
                禁用、删除或重置密码会影响该用户在所有接入系统中的活跃会话。
              </p>
            </div>
          </div>
        </div>
      </div>

      {canAssignRole && (
        <AssignRoleDialog
          open={isRoleOpen}
          onOpenChange={setIsRoleOpen}
          user={{
            id,
            name: form.name,
            deptId: serverUser.deptId,
            deptName: serverUser.deptName,
          }}
        />
      )}
    </div>
  );
}

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="rounded-lg bg-muted p-2 text-muted-foreground"><Icon className="h-4 w-4" /></div>
      <div className="min-w-0">
        <p className="text-xs font-bold text-muted-foreground">{label}</p>
        <p className="break-words text-sm font-bold text-foreground/80">{value}</p>
      </div>
    </div>
  );
}

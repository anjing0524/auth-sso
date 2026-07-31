'use client';

import React, { useTransition } from 'react';
import {
  Activity,
  Building2,
  CheckCircle2,
  Clock,
  Fingerprint,
  Key,
  Lock,
  Mail,
  MonitorSmartphone,
  Pencil,
} from 'lucide-react';
import { toast } from 'sonner';
import {
  ADMIN_ROLE_CODES,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
} from '@auth-sso/contracts';

import { formatShanghaiDateTime } from '@/lib/format-time';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { changeOwnPasswordAction, updateOwnProfileAction } from './actions';
import type { OwnSecurityActivity } from './data';

interface ProfileClientProps {
  user: null | {
    id: string;
    name: string;
    email: string;
    picture: string | null;
    deptName: string | null;
    status: string;
  };
  permissions: string[];
  roles: Array<{ code: string; name: string }>;
  securityActivity: OwnSecurityActivity;
}

const STATUS_LABELS: Record<string, string> = {
  ACTIVE: '正常',
  DISABLED: '已禁用',
  LOCKED: '已锁定',
  DELETED: '已删除',
};

function ChangePasswordDialog() {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = React.useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    startTransition(async () => {
      const res = await changeOwnPasswordAction({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      if (!res.success) {
        toast.error(res.message ?? '修改失败');
        return;
      }
      toast.success(res.message ?? '密码已更新，请重新登录');
      setOpen(false);
      window.location.assign('/login');
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={(
          <Button
            id="btn-change-password"
            className="mt-4 h-11 w-full rounded-xl bg-background font-bold text-foreground shadow-xl shadow-black/20 hover:bg-muted"
          />
        )}
      >
        <Lock className="mr-2 h-4 w-4" />修改密码
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>修改登录密码</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <PasswordField id="currentPassword" label="当前密码" value={form.currentPassword} onChange={(value) => setForm({ ...form, currentPassword: value })} autoComplete="current-password" />
          <PasswordField id="newPassword" label="新密码" value={form.newPassword} onChange={(value) => setForm({ ...form, newPassword: value })} autoComplete="new-password" />
          <PasswordField id="confirmPassword" label="确认新密码" value={form.confirmPassword} onChange={(value) => setForm({ ...form, confirmPassword: value })} autoComplete="new-password" />
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>取消</Button>
            <Button type="submit" disabled={isPending}>{isPending ? '修改中…' : '确认修改'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="password"
        autoComplete={autoComplete}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={id === 'currentPassword' ? '输入当前密码' : '至少8位，含大小写字母和数字'}
        required
      />
    </div>
  );
}

function EditProfileDialog({ user }: { user: NonNullable<ProfileClientProps['user']> }) {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = React.useState({ name: user.name, email: user.email });

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    startTransition(async () => {
      const res = await updateOwnProfileAction(form);
      if (!res.success) {
        toast.error(res.message ?? '更新失败');
        return;
      }
      toast.success(res.message ?? '资料已更新');
      setOpen(false);
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={<Button id="btn-edit-profile" variant="ghost" size="icon" className="rounded-full" aria-label="编辑个人资料" />}
      >
        <Pencil className="h-5 w-5" />
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>编辑个人资料</DialogTitle></DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">姓名</Label>
            <Input id="profile-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">邮箱</Label>
            <Input id="profile-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} required />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>取消</Button>
            <Button type="submit" disabled={isPending}>{isPending ? '保存中…' : '保存'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProfileClient({
  user,
  permissions,
  roles,
  securityActivity,
}: ProfileClientProps) {
  if (!user) {
    return <div className="flex h-64 items-center justify-center text-muted-foreground">用户数据加载失败</div>;
  }

  const isAdmin = roles.some((role) => (ADMIN_ROLE_CODES as readonly string[]).includes(role.code));
  const permissionGroups = Object.values(PERMISSION_GROUPS)
    .map((group) => ({
      name: group.name,
      permissions: group.permissions.filter((permission) => permissions.includes(permission)),
    }))
    .filter((group) => group.permissions.length > 0);

  return (
    <main className="mx-auto min-w-0 max-w-6xl space-y-8 px-4 pb-16 pt-6 sm:px-6">
      <section className="relative overflow-hidden rounded-3xl border border-border/50 bg-card p-6 shadow-xl sm:p-8 lg:p-12">
        <div className="absolute right-3 top-3 z-20 sm:right-8 sm:top-8"><EditProfileDialog user={user} /></div>
        <div className="relative z-10 flex flex-col items-center gap-6 text-center md:flex-row md:text-left">
          <Avatar className="h-28 w-28 rounded-3xl border-4 border-card shadow-xl">
            <AvatarImage src={user.picture ?? undefined} />
            <AvatarFallback className="bg-primary text-3xl font-black text-primary-foreground">{user.name.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center justify-center gap-3 md:justify-start">
              <h1 className="break-words text-3xl font-black tracking-tight sm:text-4xl">{user.name}</h1>
              <Badge>{isAdmin ? '管理员' : '员工'}</Badge>
            </div>
            <p className="flex items-center justify-center gap-2 break-all text-muted-foreground md:justify-start">
              <Mail className="h-4 w-4 shrink-0" />{user.email}
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-8 lg:grid-cols-3">
        <div className="space-y-6">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2 text-base"><Fingerprint className="h-4 w-4 text-primary" />账户信息</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              <div>
                <Label>用户 ID</Label>
                <code className="mt-2 block break-all rounded-xl border bg-muted/30 p-3 text-xs">{user.id}</code>
              </div>
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-sm font-bold"><Activity className="h-4 w-4 text-success" />账户状态</span>
                <Badge variant={user.status === 'ACTIVE' ? 'success' : 'secondary'}>{STATUS_LABELS[user.status] ?? user.status}</Badge>
              </div>
              <Separator />
              <div>
                <Label>所属部门</Label>
                <p className="mt-2 flex items-center gap-2 text-sm font-bold"><Building2 className="h-4 w-4 text-primary" />{user.deptName || '未分配'}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-foreground text-background">
            <CardHeader><CardTitle className="text-base">安全概览</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <SummaryRow label="已分配角色" value={roles.length} />
              <SummaryRow label="生效权限" value={permissions.length} />
              <SummaryRow label="活跃会话" value={securityActivity.activeSessions.length} />
              <ChangePasswordDialog />
            </CardContent>
          </Card>
        </div>

        <div className="min-w-0 lg:col-span-2">
          <Tabs defaultValue="permissions">
            <TabsList className="grid h-12 w-full grid-cols-2">
              <TabsTrigger value="permissions">我的权限</TabsTrigger>
              <TabsTrigger value="security">会话与登录记录</TabsTrigger>
            </TabsList>
            <TabsContent value="permissions" className="pt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Key className="h-5 w-5 text-primary" />生效权限</CardTitle>
                  <CardDescription>按业务模块展示当前账户可使用的功能。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-5">
                  {permissionGroups.length === 0 && <p className="text-sm text-muted-foreground">当前账户没有可用权限。</p>}
                  {permissionGroups.map((group) => (
                    <section key={group.name} aria-labelledby={`permission-${group.name}`}>
                      <h2 id={`permission-${group.name}`} className="mb-2 text-sm font-bold">{group.name}</h2>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {group.permissions.map((permission) => (
                          <div key={permission} className="flex items-center gap-3 rounded-xl border bg-muted/20 p-3 text-sm">
                            <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
                            <span>{PERMISSION_LABELS[permission] ?? permission}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
            <TabsContent value="security" className="space-y-4 pt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><MonitorSmartphone className="h-5 w-5 text-primary" />活跃会话</CardTitle>
                  <CardDescription>当前未撤销且未过期的登录会话。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {securityActivity.activeSessions.length === 0 && <p className="text-sm text-muted-foreground">暂无活跃会话。</p>}
                  {securityActivity.activeSessions.map((session) => (
                    <div key={session.id} className="rounded-xl border p-4">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <span className="text-sm font-bold">创建于 {formatShanghaiDateTime(session.createdAt)}</span>
                        <span className="text-xs text-muted-foreground">到期：{formatShanghaiDateTime(session.expiresAt)}</span>
                      </div>
                      <p className="mt-2 break-words text-xs text-muted-foreground">授权范围：{session.scopes.join('、') || '默认'}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5 text-primary" />最近登录</CardTitle></CardHeader>
                <CardContent className="space-y-3">
                  {securityActivity.recentLogins.length === 0 && <p className="text-sm text-muted-foreground">暂无登录记录。</p>}
                  {securityActivity.recentLogins.map((login) => (
                    <div key={login.id} className="rounded-xl border p-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={login.eventType === 'LOGIN_SUCCESS' ? 'success' : 'destructive'}>
                          {login.eventType === 'LOGIN_SUCCESS' ? '登录成功' : '登录失败'}
                        </Badge>
                        <span className="text-sm font-bold">{formatShanghaiDateTime(login.createdAt)}</span>
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">IP：{login.ip ?? '未知'}{login.location ? ` · ${login.location}` : ''}</p>
                      <p className="mt-1 break-words text-xs text-muted-foreground">设备：{login.userAgent ?? '未知'}</p>
                      {login.failReason && <p className="mt-1 text-xs text-destructive">原因：{login.failReason}</p>}
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </main>
  );
}

function SummaryRow({ label, value }: { label: string; value: number }) {
  return <div className="flex items-center justify-between text-sm"><span className="opacity-70">{label}</span><strong>{value}</strong></div>;
}

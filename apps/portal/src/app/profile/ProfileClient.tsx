'use client';

/**
 * 个人中心 UI 渲染组件 (Client Component)
 *
 * 采用 Stripe/GitHub 风格的卡片式详情布局。
 * 数据由 Server Component (page.tsx) 通过 props 注入，
 * 不再使用 useEffect + fetch('/api/me') 的客户端数据瀑布。
 *
 * v2：新增修改密码 / 编辑资料 Dialog（FR-USR-10 / FR-USR-12）
 */
import React, { useTransition } from 'react';
import {
  Mail,
  ShieldCheck,
  Building2,
  Key,
  Clock,
  Fingerprint,
  CheckCircle2,
  Lock,
  ChevronRight,
  Activity,
  Pencil,
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { updateOwnProfileAction, changeOwnPasswordAction } from './actions';
import { toast } from 'sonner';
import { ADMIN_ROLE_CODES } from '@auth-sso/contracts';

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
}

/**
 * 修改密码 Dialog 组件
 */
function ChangePasswordDialog() {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = React.useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  /** 处理表单字段变更 */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  /** 提交修改密码 */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirmPassword) {
      toast.error('两次输入的新密码不一致');
      return;
    }
    startTransition(async () => {
      const res = await changeOwnPasswordAction({
        currentPassword: form.currentPassword,
        newPassword: form.newPassword,
      });
      if (res.success) {
        toast.success(res.message ?? '密码已更新，请重新登录');
        setOpen(false);
        // 服务端已失效会话，短暂延迟后刷新页面引导用户重登
        setTimeout(() => window.location.assign('/login'), 1500);
      } else {
        toast.error(res.message ?? '修改失败');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button
          id="btn-change-password"
          className="w-full bg-background text-foreground hover:bg-muted rounded-xl font-bold mt-4 shadow-xl shadow-black/20 h-11"
        >
          <Lock className="h-4 w-4 mr-2" />
          修改密码
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5 text-primary" />
            修改登录密码
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">当前密码</Label>
            <Input
              id="currentPassword"
              name="currentPassword"
              type="password"
              autoComplete="current-password"
              placeholder="输入当前密码"
              value={form.currentPassword}
              onChange={handleChange}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">新密码</Label>
            <Input
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
              placeholder="至少8位，含大小写字母和数字"
              value={form.newPassword}
              onChange={handleChange}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">确认新密码</Label>
            <Input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autoComplete="new-password"
              placeholder="再次输入新密码"
              value={form.confirmPassword}
              onChange={handleChange}
              required
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending} id="btn-change-password-submit">
              {isPending ? '修改中...' : '确认修改'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 编辑资料 Dialog 组件
 */
function EditProfileDialog({ user }: { user: NonNullable<ProfileClientProps['user']> }) {
  const [open, setOpen] = React.useState(false);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = React.useState({ name: user.name, email: user.email });

  /** 处理表单字段变更 */
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  /** 提交资料更新 */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    startTransition(async () => {
      const res = await updateOwnProfileAction(form);
      if (res.success) {
        toast.success(res.message ?? '资料已更新');
        setOpen(false);
      } else {
        toast.error(res.message ?? '更新失败');
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger>
        <Button
          id="btn-edit-profile"
          variant="ghost"
          size="icon"
          className="rounded-full hover:bg-primary/10 hover:text-primary transition-colors"
          title="编辑资料"
        >
          <Pencil className="h-5 w-5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-5 w-5 text-primary" />
            编辑个人资料
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="profile-name">姓名</Label>
            <Input
              id="profile-name"
              name="name"
              type="text"
              placeholder="显示姓名"
              value={form.name}
              onChange={handleChange}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">邮箱</Label>
            <Input
              id="profile-email"
              name="email"
              type="email"
              placeholder="邮箱地址"
              value={form.email}
              onChange={handleChange}
              required
            />
          </div>
          <DialogFooter className="pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
              取消
            </Button>
            <Button type="submit" disabled={isPending} id="btn-edit-profile-submit">
              {isPending ? '保存中...' : '保存'}
            </Button>
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
}: ProfileClientProps) {
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">用户数据加载失败</p>
      </div>
    );
  }

  const isAdmin = roles.some(r => (ADMIN_ROLE_CODES as readonly string[]).includes(r.code));

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-16 animate-in fade-in duration-700">
      {/* 1. 顶部身份横幅 */}
      <div className="group relative overflow-hidden rounded-3xl bg-card border border-border/50 shadow-2xl p-8 lg:p-12 transition-all hover:shadow-primary/5">
        <div className="absolute top-0 right-0 p-8">
          {/* 编辑资料触发按钮 */}
          <EditProfileDialog user={user} />
        </div>

        <div className="flex flex-col md:flex-row items-center gap-8 relative z-10 text-center md:text-left">
          <div className="relative">
            <Avatar className="h-28 w-24 md:h-32 md:w-32 rounded-3xl border-4 border-card ring-1 ring-primary/20 shadow-2xl">
              <AvatarImage src={user.picture ?? undefined} />
              <AvatarFallback className="text-3xl font-black bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-2 -right-2 bg-success text-success-foreground p-2 rounded-2xl shadow-lg ring-4 ring-card">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
              <h1 className="text-4xl font-black tracking-tighter text-foreground leading-none">
                {user.name}
              </h1>
              <Badge className="bg-primary text-primary-foreground border-none px-3 py-1 rounded-full font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-primary/20">
                {isAdmin ? 'Administrator' : 'Verified Staff'}
              </Badge>
            </div>
            <p className="flex items-center justify-center md:justify-start gap-2 text-muted-foreground font-medium italic">
              <Mail className="h-4 w-4 opacity-50" /> {user.email}
            </p>
          </div>
        </div>

        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="grid gap-10 lg:grid-cols-3">
        {/* 2. 左侧：核心凭证卡片 */}
        <div className="lg:col-span-1 space-y-8">
          <Card className="rounded-2xl border-none shadow-sm ring-1 ring-border/50 overflow-hidden bg-muted/50">
            <CardHeader className="bg-card/50 border-b py-6 px-8">
              <CardTitle className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-primary" />
                Auth Token
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-bold text-muted-foreground uppercase">Principal ID</Label>
                <div className="flex items-center justify-between gap-2 p-3 bg-card rounded-xl border border-border/60 group">
                  <code className="text-xs font-mono truncate opacity-60 group-hover:opacity-100 transition-opacity">{user.id}</code>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                </div>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Activity className="h-4 w-4 text-success" /> Account Status
                </span>
                <Badge variant="success" className="rounded-md font-black uppercase tracking-tighter">Active</Badge>
              </div>

              <Separator className="bg-border/60" />

              <div className="space-y-3">
                <Label className="text-[10px] font-bold text-muted-foreground uppercase">Associated Unit</Label>
                <div className="flex items-center gap-3 p-1">
                  <div className="p-2 bg-primary/10 text-primary rounded-xl"><Building2 className="h-4 w-4" /></div>
                  <span className="text-sm font-black text-foreground">{user.deptName || 'Global Operations'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-none shadow-sm ring-1 ring-border/50 overflow-hidden bg-gradient-to-br from-foreground to-foreground/80 text-background">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Security Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm opacity-60">Verified Roles</span>
                <span className="text-sm font-black">{roles.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm opacity-60">Access Permissions</span>
                <span className="text-sm font-black">{permissions.length}</span>
              </div>
              {/* FR-USR-10：自助修改密码入口 */}
              <ChangePasswordDialog />
            </CardContent>
          </Card>
        </div>

        {/* 3. 右侧：权限矩阵与活动 */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="permissions" className="w-full">
            <TabsList className="bg-muted/50 p-1.5 rounded-xl h-14 w-full grid grid-cols-2 border border-border/40 backdrop-blur-md">
              <TabsTrigger value="permissions" className="rounded-2xl font-black text-xs uppercase tracking-widest data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all">Permission Matrix</TabsTrigger>
              <TabsTrigger value="security" className="rounded-2xl font-black text-xs uppercase tracking-widest data-[state=active]:bg-card data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all">Session History</TabsTrigger>
            </TabsList>

            <TabsContent value="permissions" className="pt-6 animate-in slide-in-from-bottom-4 duration-500">
              <Card className="rounded-2xl border-none shadow-sm ring-1 ring-border/50 overflow-hidden">
                <CardHeader className="px-8 pt-8">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-2xl font-black tracking-tight flex items-center gap-3">
                      <Key className="h-6 w-6 text-primary" />
                      Functional ACL
                    </CardTitle>
                    <Badge variant="outline" className="rounded-full px-3 py-1 font-mono text-[10px] opacity-40">Matrix v2.1</Badge>
                  </div>
                  <CardDescription className="font-medium text-muted-foreground">当前账户下所有生效的原子权限标识符</CardDescription>
                </CardHeader>
                <CardContent className="p-8">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {permissions.map((perm: string) => (
                      <div key={perm} className="flex items-center justify-between p-4 rounded-xl border bg-muted/30 hover:border-primary/30 hover:bg-card hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 group">
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary/40 group-hover:bg-primary group-hover:scale-150 transition-all" />
                          <code className="text-xs font-mono font-bold text-muted-foreground group-hover:text-primary transition-colors">{perm}</code>
                        </div>
                        <CheckCircle2 className="h-3.5 w-3.5 text-success opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="pt-6 animate-in slide-in-from-bottom-4 duration-500">
              <Card className="rounded-2xl border-none shadow-sm ring-1 ring-border/50 overflow-hidden">
                <CardHeader className="px-8 pt-8">
                  <CardTitle className="text-2xl font-black tracking-tight flex items-center gap-3">
                    <Clock className="h-6 w-6 text-orange-500" />
                    Security Sessions
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="p-10 text-center border-2 border-dashed border-border rounded-2xl">
                    <Lock className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
                    <p className="text-sm font-bold text-muted-foreground">Device Identity Verification Active</p>
                    <p className="text-[10px] text-muted-foreground/50 mt-1 uppercase tracking-widest">Global SSO Node</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

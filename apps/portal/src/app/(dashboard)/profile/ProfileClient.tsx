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
import { useFieldFailure } from '@/hooks/use-field-failure';
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
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { isAdminRole } from '@auth-sso/contracts';
import { accountStatus } from '@/lib/status-label';
import { formatDateTime } from '@/lib/format-date';

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
  /** 当前 JWT 会话（服务端解析后的真实 claims + 请求头） */
  session?: {
    iat: number | null;
    exp: number | null;
    jti: string;
    clientId: string;
    userAgent: string | null;
    ip: string | null;
  } | null;
  /** 当前用户仍活跃的 refresh token 会话（服务端直读 DB） */
  sessions?: Array<{
    id: string;
    clientId: string;
    scopes: string;
    createdAt: string;
    expiresAt: string;
    authTime: string | null;
  }>;
}

/**
 * 修改密码 Dialog 组件
 */
function ChangePasswordDialog() {
  const { reportFailure } = useFieldFailure();
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
        reportFailure(res);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            id="btn-change-password"
            className="mt-4 h-10 w-full rounded-lg bg-background font-bold text-foreground shadow-lg shadow-black/20 hover:bg-muted"
          >
            <Lock className="h-4 w-4 mr-2" />
            修改密码
          </Button>
        }
      />
      <DialogContent>
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
  const { reportFailure } = useFieldFailure();
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
        reportFailure(res);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            id="btn-edit-profile"
            variant="ghost"
            size="icon"
            aria-label="编辑资料"
            className="rounded-lg hover:bg-primary/10 hover:text-primary transition-colors"
            title="编辑资料"
          >
            <Pencil className="h-5 w-5" />
          </Button>
        }
      />
      <DialogContent>
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
  session = null,
  sessions = [],
}: ProfileClientProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  /** Tab 必须与 URL 同步：此前是纯本地 state，刷新/深链 ?tab=security 会丢失、浏览器后退无效 */
  const [activeTab, setActiveTab] = React.useState(searchParams.get('tab') === 'security' ? 'security' : 'permissions');
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'permissions') params.delete('tab');
    else params.set('tab', value);
    router.replace(`${pathname}${params.toString() ? `?${params.toString()}` : ''}`, { scroll: false });
  };
  const [showAllPermissions, setShowAllPermissions] = React.useState(false);
  const visiblePermissions = showAllPermissions ? permissions : permissions.slice(0, 12);
  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">用户数据加载失败</p>
      </div>
    );
  }

  const isAdmin = isAdminRole(roles.map((r) => r.code));

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* 1. 顶部身份横幅 */}
      <div className="group relative overflow-hidden rounded-xl border border-border/50 bg-card p-6 shadow-sm transition-all hover:shadow-md lg:p-8">
        <div className="absolute top-0 right-0 z-20 p-6">
          {/* 编辑资料触发按钮 */}
          <EditProfileDialog user={user} />
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6 relative z-10 text-center md:text-left">
          <div className="relative">
            <Avatar className="h-28 w-28 rounded-full border-4 border-card shadow-2xl ring-1 ring-primary/20 md:h-32 md:w-32">
              <AvatarImage src={user.picture ?? undefined} />
              <AvatarFallback className="text-3xl font-black bg-gradient-to-br from-primary to-primary/70 text-primary-foreground">
                {user.name.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-2 -right-2 rounded-full bg-success p-2 text-success-foreground shadow-lg ring-4 ring-card">
              <ShieldCheck className="h-5 w-5" />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">
                {user.name}
              </h1>
              <Badge className="border-none bg-primary px-3 text-primary-foreground shadow-lg shadow-primary/20">
                {roles.length > 0 ? roles.map((r) => r.name).join(' / ') : isAdmin ? '管理员' : '员工'}
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
        <div className="lg:col-span-1 space-y-6">
          <Card className="overflow-hidden rounded-xl border-none bg-muted/50 shadow-sm ring-1 ring-border/50">
            <CardHeader className="bg-card/50 border-b py-6">
              <CardTitle className="text-sm font-black uppercase tracking-[0.2em] text-muted-foreground flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-primary" />
                身份凭证
              </CardTitle>
            </CardHeader>
            <CardContent className="p-6 space-y-6">
              <div className="space-y-2">
                <Label>主体 ID</Label>
                <div className="flex items-center justify-between gap-2 p-3 bg-card rounded-xl border border-border/60 group">
                  <code className="text-xs font-mono truncate opacity-60 group-hover:opacity-100 transition-opacity">{user.id}</code>
                  <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                </div>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-sm font-bold text-foreground flex items-center gap-2">
                  <Activity className="h-4 w-4 text-success" /> 账号状态
                </span>
                <Badge variant={accountStatus(user.status).variant}>{accountStatus(user.status).label}</Badge>
              </div>

              <Separator className="bg-border/60" />

              <div className="space-y-3">
                <Label>所属部门</Label>
                <div className="flex items-center gap-3 p-1">
                  <div className="p-2 bg-primary/10 text-primary rounded-xl"><Building2 className="h-4 w-4" /></div>
                  <span className="text-sm font-black text-foreground">{user.deptName || 'Global Operations'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="overflow-hidden rounded-xl border-none bg-gradient-to-br from-foreground to-foreground/80 text-background shadow-sm ring-1 ring-border/50">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-muted-foreground">安全摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
              <div className="flex items-center justify-between">
                <span className="text-sm opacity-60">有效角色</span>
                <span className="text-sm font-black">{roles.length}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm opacity-60">权限点</span>
                <span className="text-sm font-black">{permissions.length}</span>
              </div>
              {/* FR-USR-10：自助修改密码入口 */}
              <ChangePasswordDialog />
            </CardContent>
          </Card>
        </div>

        {/* 3. 右侧：权限矩阵与活动 */}
        <div className="lg:col-span-2">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="permissions">权限矩阵</TabsTrigger>
              <TabsTrigger value="security">会话记录</TabsTrigger>
            </TabsList>

            <TabsContent value="permissions" className="pt-6 animate-in slide-in-from-bottom-4 duration-500">
              <Card className="overflow-hidden rounded-xl border-none shadow-sm ring-1 ring-border/50">
                <CardHeader className="pt-6">
                  <div className="flex items-center justify-between">
                    <CardTitle className="flex items-center gap-3">
                      <Key className="h-6 w-6 text-primary" />
                      功能权限清单
                    </CardTitle>
                  </div>
                  <CardDescription className="font-medium text-muted-foreground">当前账户下所有生效的原子权限标识符</CardDescription>
                </CardHeader>
                <CardContent className="p-6">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {visiblePermissions.map((perm: string) => (
                      <div key={perm} className="flex items-center justify-between p-4 rounded-xl border bg-muted/30 hover:border-primary/30 hover:bg-card hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 group">
                        <div className="flex items-center gap-3">
                          <div className="h-1.5 w-1.5 rounded-full bg-primary/40 group-hover:bg-primary group-hover:scale-150 transition-all" />
                          <code className="text-xs font-mono font-bold text-muted-foreground group-hover:text-primary transition-colors">{perm}</code>
                        </div>
                        <CheckCircle2 className="h-3.5 w-3.5 text-success opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    ))}
                  </div>
                  {permissions.length > 12 && (
                    <div className="mt-6 flex justify-center">
                      <Button variant="outline" size="sm" onClick={() => setShowAllPermissions((v) => !v)}>
                        {showAllPermissions ? '收起' : `展开全部（共 ${permissions.length} 项）`}
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="pt-6">
              <Card className="overflow-hidden rounded-xl border-none shadow-sm ring-1 ring-border/50">
                <CardHeader className="pt-6">
                  <CardTitle className="flex items-center gap-3">
                    <Clock className="h-6 w-6 text-warning" />
                    安全会话
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-6 p-6">
                  <div className="rounded-xl border border-border/60 bg-muted/30 p-6">
                    <div className="mb-4 flex items-center justify-between">
                      <p className="text-sm font-semibold">当前会话</p>
                      <Badge variant="success">在线</Badge>
                    </div>
                    {session ? (
                      <dl className="grid gap-3 sm:grid-cols-2">
                        <div className="flex justify-between gap-3 sm:block">
                          <dt className="text-xs text-muted-foreground">登录时间</dt>
                          <dd className="mt-0.5 font-mono text-xs">{formatDateTime(session.iat ? new Date(session.iat * 1000) : null)}</dd>
                        </div>
                        <div className="flex justify-between gap-3 sm:block">
                          <dt className="text-xs text-muted-foreground">会话过期</dt>
                          <dd className="mt-0.5 font-mono text-xs">{formatDateTime(session.exp ? new Date(session.exp * 1000) : null)}</dd>
                        </div>
                        <div className="flex justify-between gap-3 sm:block">
                          <dt className="text-xs text-muted-foreground">会话标识</dt>
                          <dd className="mt-0.5 truncate font-mono text-xs">{session.jti}</dd>
                        </div>
                        <div className="flex justify-between gap-3 sm:block">
                          <dt className="text-xs text-muted-foreground">来源 IP</dt>
                          <dd className="mt-0.5 font-mono text-xs">{session.ip ?? '-'}</dd>
                        </div>
                        <div className="sm:col-span-2">
                          <dt className="text-xs text-muted-foreground">设备 / 客户端</dt>
                          <dd className="mt-0.5 break-all text-xs text-muted-foreground">{session.userAgent ?? '-'}</dd>
                        </div>
                      </dl>
                    ) : (
                      <p className="text-sm text-muted-foreground">无法解析当前会话信息</p>
                    )}
                  </div>

                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-semibold">活跃登录会话</p>
                      <span className="text-xs text-muted-foreground">共 {sessions.length} 个</span>
                    </div>
                    {sessions.length === 0 ? (
                      <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
                        暂无其他活跃会话
                      </p>
                    ) : (
                      <div className="divide-y rounded-xl border border-border/60">
                        {sessions.map((item) => (
                          <div key={item.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
                            <div className="min-w-0">
                              <p className="truncate font-mono text-xs">{item.clientId}</p>
                              <p className="truncate text-xs text-muted-foreground">scope: {item.scopes}</p>
                            </div>
                            <div className="text-right text-xs text-muted-foreground">
                              <p>建立 {formatDateTime(item.createdAt)}</p>
                              <p>到期 {formatDateTime(item.expiresAt)}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <Button
                    variant="outline"
                    onClick={async () => {
                      await fetch('/api/auth/logout', { method: 'POST' });
                      window.location.href = '/login';
                    }}
                  >
                    退出当前会话
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

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
import { Mail, ShieldCheck, Building2, Key, Clock, Lock, Pencil, Copy, LogOut } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from '@/components/ui/dialog';
import { updateOwnProfileAction, changeOwnPasswordAction } from './actions';
import { revokeOwnSessionAction } from './session-actions';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
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
          <Button id="btn-change-password" variant="outline" size="sm">
            <Lock className="h-3.5 w-3.5" />
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
              placeholder="至少 10 位，含大写/小写字母、数字、特殊字符中的至少三类"
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
          <Button id="btn-edit-profile" variant="outline" size="sm" aria-label="编辑资料" title="编辑资料">
            <Pencil className="h-3.5 w-3.5" />
            编辑资料
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
  const [showAllPermissions, setShowAllPermissions] = React.useState(false);
  /** U-PF02：退出会话是会话级安全操作，需二次确认（防误点） */
  const [logoutConfirmOpen, setLogoutConfirmOpen] = React.useState(false);
  const [loggingOut, setLoggingOut] = React.useState(false);
  // 会话列表可能很多（每端每次刷新一条）：默认只展示 3 条，避免把安全信息挤出首屏
  const router = useRouter();
  const { reportFailure } = useFieldFailure();
  const [showAllSessions, setShowAllSessions] = React.useState(false);
  /** 待确认撤销的单个会话（自助安全操作，需二次确认） */
  const [revokeTarget, setRevokeTarget] = React.useState<string | null>(null);
  const [revoking, setRevoking] = React.useState(false);
  const visibleSessions = showAllSessions ? sessions : sessions.slice(0, 3);
  const visiblePermissions = showAllPermissions ? permissions : permissions.slice(0, 10);

  if (!user) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-muted-foreground">用户数据加载失败</p>
      </div>
    );
  }

  const isAdmin = isAdminRole(roles.map((r) => r.code));
  const copySubjectId = async () => {
    try {
      await navigator.clipboard.writeText(user.id);
      toast.success('已复制主体 ID');
    } catch {
      toast.error('复制失败，请手动选择');
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {/* 紧凑身份头：头像/姓名/角色/邮箱/部门 + 高频动作（编辑资料/改密） */}
      <Card className="shrink-0 gap-0 rounded-lg border border-border/70 py-0 shadow-sm ring-0">
        <CardContent className="flex flex-wrap items-center gap-3 p-3">
          <Avatar className="h-12 w-12 shrink-0 rounded-full border-2 border-card shadow-sm">
            <AvatarImage src={user.picture ?? undefined} />
            <AvatarFallback className="bg-primary text-base font-semibold text-primary-foreground">
              {user.name.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[17px] font-semibold leading-6 tracking-tight text-foreground">{user.name}</h1>
              {isAdmin && <Badge variant="secondary" className="text-[10px]">管理员</Badge>}
              {roles.map((r) => <Badge key={r.code} variant="outline" className="text-[10px]">{r.name}</Badge>)}
              <Badge variant={accountStatus(user.status).variant}>{accountStatus(user.status).label}</Badge>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1"><Mail className="h-3 w-3" />{user.email}</span>
              <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{user.deptName || '未分配部门'}</span>
              <span className="flex items-center gap-1"><ShieldCheck className="h-3 w-3" />{roles.length} 个角色 · {permissions.length} 个权限点</span>
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <EditProfileDialog user={user} />
            <ChangePasswordDialog />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {/* 账户资料：只读身份 + 可复制的技术标识 */}
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
            <CardHeader className="border-b bg-muted/30 px-3 py-2">
              <CardTitle className="type-card-title">账户资料</CardTitle>
            </CardHeader>
            <CardContent className="p-3">
              <dl className="grid gap-x-6 gap-y-2.5 sm:grid-cols-2">
                <div className="flex items-baseline justify-between gap-3 sm:block">
                  <dt className="text-[11px] text-muted-foreground">姓名</dt>
                  <dd className="text-[13px]">{user.name}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 sm:block">
                  <dt className="text-[11px] text-muted-foreground">邮箱</dt>
                  <dd className="truncate text-[13px]">{user.email}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 sm:block">
                  <dt className="text-[11px] text-muted-foreground">所属部门</dt>
                  <dd className="text-[13px]">{user.deptName || '未分配部门'}</dd>
                </div>
                <div className="flex items-baseline justify-between gap-3 sm:block">
                  <dt className="text-[11px] text-muted-foreground">账号状态</dt>
                  <dd><Badge variant={accountStatus(user.status).variant}>{accountStatus(user.status).label}</Badge></dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-[11px] text-muted-foreground">主体 ID（排障/工单用）</dt>
                  <dd className="mt-1 flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1 font-mono text-[11px]">{user.id}</code>
                    <Button variant="ghost" size="icon-sm" aria-label="复制主体 ID" title="复制主体 ID" onClick={copySubjectId}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </dd>
                </div>
              </dl>
            </CardContent>
          </Card>

          {/* 权限摘要：角色 → 权限点，默认只展示高频 10 个，避免长列表压过安全信息 */}
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/30 px-3 py-2">
              <CardTitle className="flex items-center gap-2 type-card-title">
                <Key className="h-4 w-4 text-primary" /> 权限摘要
              </CardTitle>
              <span className="text-[11px] text-muted-foreground">共 {permissions.length} 项 · 由角色决定</span>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              <div className="flex flex-wrap gap-1.5">
                {roles.length === 0 ? (
                  <span className="text-[11px] text-muted-foreground">未分配角色</span>
                ) : roles.map((r) => (
                  <Badge key={r.code} variant="secondary" className="text-[11px]">{r.name}</Badge>
                ))}
              </div>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {visiblePermissions.map((perm) => (
                  <code key={perm} className="truncate rounded border border-border/60 bg-muted/30 px-2 py-1 font-mono text-[11px] text-muted-foreground" title={perm}>
                    {perm}
                  </code>
                ))}
              </div>
              {permissions.length > 10 && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px]" onClick={() => setShowAllPermissions((v) => !v)}>
                  {showAllPermissions ? '收起' : `展开全部（共 ${permissions.length} 项）`}
                </Button>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          {/* 登录会话：当前会话 + 活跃 refresh 会话，危险动作二次确认 */}
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/30 px-3 py-2">
              <CardTitle className="flex items-center gap-2 type-card-title">
                <Clock className="h-4 w-4 text-warning" /> 登录会话
              </CardTitle>
              <Badge variant="success" className="text-[10px]">在线</Badge>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              {session ? (
                <dl className="space-y-1.5">
                  <div className="flex justify-between gap-3">
                    <dt className="text-[11px] text-muted-foreground">登录时间</dt>
                    <dd className="font-mono text-[11px]">{formatDateTime(session.iat ? new Date(session.iat * 1000) : null)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[11px] text-muted-foreground">会话过期</dt>
                    <dd className="font-mono text-[11px]">{formatDateTime(session.exp ? new Date(session.exp * 1000) : null)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-[11px] text-muted-foreground">来源 IP</dt>
                    <dd className="truncate font-mono text-[11px]">{session.ip ?? '-'}</dd>
                  </div>
                  <div>
                    <dt className="text-[11px] text-muted-foreground">设备 / 客户端</dt>
                    <dd className="mt-0.5 line-clamp-2 break-all text-[11px] text-muted-foreground">{session.userAgent ?? '-'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="text-[11px] text-muted-foreground">无法解析当前会话信息</p>
              )}

              <div className="border-t pt-2.5">
              <Button variant="outline" size="sm" className="w-full" onClick={() => setLogoutConfirmOpen(true)}>
                退出当前会话
              </Button>

                <div className="flex items-center justify-between gap-2">
                  <p className="text-[12px] font-medium">活跃登录会话</p>
                  <span className="text-[11px] text-muted-foreground">共 {sessions.length} 个</span>
                </div>
                {sessions.length === 0 ? (
                  <p className="mt-1.5 rounded border border-dashed px-2 py-3 text-center text-[11px] text-muted-foreground">暂无其他活跃会话</p>
                ) : (
                  <ul className="mt-1.5 divide-y rounded border border-border/60">
                    {visibleSessions.map((item) => (
                      <li key={item.id} className="flex items-start justify-between gap-2 px-2 py-1.5">
                        <div className="min-w-0">
                          <p className="truncate font-mono text-[11px]">{item.clientId}</p>
                          <p className="truncate text-[10px] text-muted-foreground">登录于 {formatDateTime(item.createdAt)} · #{item.id.slice(0, 8)}</p>
                          <p className="truncate text-[10px] text-muted-foreground">scope: {item.scopes} · 到期 {formatDateTime(item.expiresAt)}</p>
                        </div>
                        <Button
                          variant="ghost" size="sm" className="h-6 shrink-0 px-1.5 text-[10px] text-destructive hover:bg-destructive/10"
                          aria-label={`撤销会话 ${formatDateTime(item.createdAt)}（${item.clientId} · ${item.id.slice(0, 8)}）`}
                          onClick={() => setRevokeTarget(item.id)}
                        >
                          撤销
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {sessions.length > 3 && (
                  <Button variant="ghost" size="sm" className="mt-1 h-7 w-full px-2 text-[11px]" onClick={() => setShowAllSessions((v) => !v)}>
                    {showAllSessions ? '收起' : `查看全部 ${sessions.length} 个会话`}
                  </Button>
                )}
              </div>

              {/* U-PF02：二次确认，避免误点即清会话 */}
              <Dialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>退出当前会话？</DialogTitle>
                    <DialogDescription>
                      将清除本设备的登录会话并返回登录页。其他设备上的会话不受影响。
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setLogoutConfirmOpen(false)} disabled={loggingOut}>取消</Button>
                    <Button
                      variant="destructive"
                      disabled={loggingOut}
                      onClick={async () => {
                        setLoggingOut(true);
                        try {
                          await fetch('/api/auth/logout', { method: 'POST' });
                          window.location.href = '/login';
                        } finally {
                          setLoggingOut(false);
                        }
                      }}
                    >
                      {loggingOut ? '退出中...' : '确认退出'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* 单个会话撤销：refresh token 失效，已签发 AT 自然过期（≤1h） */}
              <Dialog open={revokeTarget !== null} onOpenChange={(open) => { if (!open) setRevokeTarget(null); }}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <LogOut className="h-4 w-4 text-destructive" /> 撤销该会话？
                    </DialogTitle>
                    <DialogDescription>
                      将撤销「{sessions.find((s) => s.id === revokeTarget) ? formatDateTime(sessions.find((s) => s.id === revokeTarget)!.createdAt) : '该'}」创建的会话；
                      该设备将无法再刷新登录状态（已签发的访问令牌最长 1 小时后失效）。
                      如需让本机立即退出，请使用「退出当前会话」。
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter>
                    <Button variant="outline" onClick={() => setRevokeTarget(null)} disabled={revoking}>取消</Button>
                    <Button
                      variant="destructive"
                      disabled={revoking}
                      onClick={async () => {
                        if (!revokeTarget) return;
                        setRevoking(true);
                        try {
                          const res = await revokeOwnSessionAction(revokeTarget);
                          if (res.success) {
                            toast.success((res as { message?: string }).message ?? '会话已撤销');
                            setRevokeTarget(null);
                            router.refresh();
                          } else {
                            reportFailure(res, '撤销失败');
                          }
                        } finally {
                          setRevoking(false);
                        }
                      }}
                    >
                      {revoking ? '撤销中...' : '确认撤销'}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

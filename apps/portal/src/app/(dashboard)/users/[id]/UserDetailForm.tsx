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
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  User as UserIcon, Save, Trash2, Shield, Building, Calendar, AlertTriangle, ShieldCheck, KeyRound, History, LogOut,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CopyTextButton } from '@/components/shared/copy-text-button';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import { AUDIT_PERMISSIONS, USER_PERMISSIONS } from '@auth-sso/contracts';
import { updateUserAction, deleteUserAction, unlockUserAction, forceLogoutUserAction } from '../actions';

import { PageHeader } from '@/components/shared/page-header';
import { RequiredLegend, RequiredMark } from '@/components/shared/required-mark';
import { validateUserBasics } from '@/lib/user-validation';
import { formatDateTime } from '@/lib/format-date';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { userFacingMessage } from '../components/user-error-copy';
interface Props {
  id: string;
  initialUser: Record<string, unknown> | null;
  /** 是否具备 user:update；无权限时页面进入只读模式（字段禁用 + 横幅） */
  canUpdate: boolean;
  /** 是否在编辑当前登录账号自己（禁止自禁用/自锁/自删/自迁部门） */
  isSelf?: boolean;
  /** 操作者数据范围内的部门（用于迁移） */
  departments?: Array<{ id: string; name: string }>;
  /** 返回列表（保留筛选） */
  returnHref?: string;
  /** 当前活跃会话数（强制下线影响面） */
  activeSessionCount?: number;
}

export default function UserDetailForm({ id, initialUser: serverUser, canUpdate, isSelf = false, departments = [], returnHref = '/users', activeSessionCount = 0 }: Props) {
  const router = useRouter();
  const user = serverUser ?? {};
  const [form, setForm] = useState({
    name: user.name as string,
    email: (user.email as string) || '',
    status: (user.status as string) || 'ACTIVE',
    deptId: (user.deptId as string) || '',
    avatarUrl: (user.avatarUrl as string) || '',
  });
  const [savedForm, setSavedForm] = useState(form);
  const [saving, setSaving] = useState(false);
  // 未保存修改：避免"没改也保存"产生无意义的审计记录，也避免误以为已保存
  const isDirty =
    form.name !== savedForm.name || form.email !== savedForm.email || form.status !== savedForm.status || form.deptId !== savedForm.deptId || form.avatarUrl !== savedForm.avatarUrl;
  // 失败处置只有一个入口（本表单不渲染 <FieldError> ⇒ 传空字段 ⇒ 一律 toast）
  const { reportFailure } = useFieldFailure();
  const leaveGuard = useUnsavedChangesGuard(isDirty);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [deletingUser, setDeletingUser] = useState(false);
  const [forceLogoutOpen, setForceLogoutOpen] = useState(false);
  const [forceLogoutBusy, setForceLogoutBusy] = useState(false);

  // 用户不存在时：在 useEffect 中执行副作用（toast + 导航），避免在 render 中直接调用
  // React StrictMode 下 render 可能双触发，副作用统一收敛至 Effect 中是安全的
  useEffect(() => {
    if (!serverUser) {
      toast.error('用户不存在');
      router.push(returnHref);
    }
  }, [serverUser, router]);

  if (!serverUser) return null;

  // 只读展示从 prop 读取 —— router.refresh() 后自动更新
  const username = serverUser.username as string;
  const STATUS_LABELS: Record<string, string> = {
    ACTIVE: '正常',
    DISABLED: '已禁用',
    LOCKED: '已锁定',
  };
  const deptName = (serverUser.deptName as string) || null;
  // 当前部门可能因范围变化不在列表里：保底保留当前项，避免 Select 显示空
  const deptOptions = form.deptId && !departments.some((d) => d.id === form.deptId)
    ? [{ id: form.deptId, name: deptName ?? form.deptId }, ...departments]
    : departments;
  const createdAt = serverUser.createdAt as string;
  const lastLoginAt = (serverUser.lastLoginAt as string | null) ?? null;
  const emailVerified = Boolean(serverUser.emailVerified);
  // getUser 读口已返回角色（含删除标记），这里只做展示，不额外查询
  const roles = (serverUser.roles as Array<{ id: string; code: string; name: string }> | undefined) ?? [];

  const handleUpdate = async () => {
    const validation = validateUserBasics(form);
    const firstError = (['name', 'email'] as const).find((field) => validation[field]);
    if (firstError) {
      toast.error(validation[firstError]!);
      requestAnimationFrame(() => document.getElementById(
        firstError === 'name' ? 'user-name' : 'user-email',
      )?.focus());
      return;
    }
    setSaving(true);
    const res = await updateUserAction(id, { ...form, deptId: form.deptId || null, avatarUrl: form.avatarUrl.trim() || null });
    if (res.success) {
      setSavedForm(form);
      toast.success('用户信息更新成功');
      router.refresh(); // 刷新 Server Component 数据，prop 更新只读展示区
    } else {
      reportFailure({ error: res.error, message: userFacingMessage(res, '更新失败') });
    }
    setSaving(false);
  };

  /** LOCKED 用户的恢复入口：必须走 unlockUserAction（H-C-02），不能经 update 直写状态。 */
  const handleUnlock = async () => {
    setSaving(true);
    const res = await unlockUserAction(id);
    if (res.success) {
      toast.success('用户已解锁');
      setForm((prev) => ({ ...prev, status: 'ACTIVE' }));
      setSavedForm((prev) => ({ ...prev, status: 'ACTIVE' }));
      router.refresh();
    } else {
      reportFailure({ error: res.error, message: userFacingMessage(res, '解锁失败') });
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    setDeletingUser(true);
    try {
      const res = await deleteUserAction(id);
      if (res.success) {
        toast.success('用户已成功删除');
        setIsDeleteOpen(false);
        router.push(returnHref);
      } else {
        reportFailure({ error: res.error, message: userFacingMessage(res, '删除失败') });
      }
    } finally {
      setDeletingUser(false);
    }
  };

  /** 安全事件处置：只踢全部会话，不重置密码 */
  const handleForceLogout = async () => {
    setForceLogoutBusy(true);
    const res = await forceLogoutUserAction(id);
    if (res.success) {
      toast.success(res.message ?? '已强制下线该用户');
      setForceLogoutOpen(false);
      router.refresh();
    } else {
      reportFailure({ error: res.error, message: userFacingMessage(res, '强制下线失败') });
    }
    setForceLogoutBusy(false);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        backHref={returnHref}
        backLabel="返回用户列表"
        title={form.name}
        description={`用户名：${username} · 状态：${STATUS_LABELS[form.status] ?? form.status}`}
        actions={
          <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
            {isDirty && (
              <span role="status" className="rounded bg-badge-warning-bg px-2 py-1 text-[11px] font-medium text-badge-warning-fg">
                未保存的修改
              </span>
            )}
            <PermissionGuard permission={USER_PERMISSIONS.UPDATE}>
              {isDirty && (
                <Button variant="outline" size="sm" onClick={() => setForm(savedForm)} disabled={saving}>
                  放弃修改
                </Button>
              )}
              <Button size="sm" onClick={handleUpdate} disabled={saving || !isDirty} title={!canUpdate ? '当前账号没有编辑权限' : !isDirty ? '没有未保存的修改' : undefined}>
                {saving ? '保存中...' : <><Save className="h-3.5 w-3.5" /> 保存修改</>}
              </Button>
            </PermissionGuard>
          </div>
        }
      />

      {!canUpdate && (
        <div data-readonly-banner className="flex items-center gap-2 rounded-lg border border-border/60 bg-muted/50 px-3 py-2 text-[13px] text-muted-foreground">
          <Shield className="h-4 w-4 shrink-0" />
          只读模式：当前账号缺少用户编辑权限（portal:user:update），仅可查看资料。
        </div>
      )}

      <fieldset disabled={!canUpdate} className="m-0 min-w-0 border-0 p-0">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="space-y-3 lg:col-span-8">
            {/* ① 基本资料：可编辑字段集中，两列栅格 */}
            <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
              <CardHeader className="border-b bg-muted/30 px-3 py-2">
                <CardTitle className="flex items-center gap-2 type-card-title">
                  <UserIcon className="h-4 w-4 text-primary" /> 基本资料
                </CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 p-3 sm:grid-cols-2">
                <p className="text-[11px] text-muted-foreground sm:col-span-2"><RequiredLegend /></p>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1"><Label htmlFor="user-name">显示名称</Label><RequiredMark /></div>
                  <Input id="user-name" aria-required="true" maxLength={100} value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
                </div>
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1"><Label htmlFor="user-email">电子邮箱</Label><RequiredMark /></div>
                  <Input id="user-email" aria-required="true" maxLength={255} value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="user-avatar">头像 URL（可选）</Label>
                  <Input id="user-avatar" type="url" maxLength={500} value={form.avatarUrl} onChange={e => setForm({ ...form, avatarUrl: e.target.value })} placeholder="https://example.com/avatar.png" />
                  <p className="text-[10px] leading-4 text-muted-foreground">用于列表头像；留空显示姓名首字母。</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-username">用户名（不可修改）</Label>
                  <Input id="user-username" value={username} disabled className="bg-muted opacity-60" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="user-status">账户状态</Label>
                  <Select
                    value={form.status}
                    onValueChange={(v) => setForm({ ...form, status: v })}
                    disabled={(serverUser.status as string) === 'LOCKED'}
                  >
                    <SelectTrigger id="user-status" aria-label="账户状态">
                      <SelectValue>{STATUS_LABELS[form.status] ?? form.status}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ACTIVE">正常</SelectItem>
                      <SelectItem value="DISABLED" disabled={isSelf}>已禁用</SelectItem>
                      <SelectItem value="LOCKED" disabled={isSelf}>已锁定</SelectItem>
                    </SelectContent>
                  </Select>
                  {isSelf && (
                    <p className="text-[11px] text-muted-foreground">当前登录账号不能禁用或锁定自己。</p>
                  )}
                {(serverUser.status as string) === 'LOCKED' && (
                    <p className="text-[11px] text-muted-foreground">已锁定账号不可直接切换状态，请在下方「重置密码 / 解锁」中处理。</p>
                  )}
                  {isSelf && (
                    <p className="text-[11px] text-muted-foreground">不能禁用或锁定自己的账号。</p>
                  )}
                  {form.status === 'DISABLED' && savedForm.status !== 'DISABLED' && (
                    <p className="text-[11px] text-destructive">保存后{activeSessionCount > 0 ? `将立即注销该用户当前 ${activeSessionCount} 个活跃会话，` : '将注销该用户全部会话，'}并禁止其登录。</p>
                  )}
                  {form.status === 'ACTIVE' && savedForm.status === 'DISABLED' && (
                    <p className="rounded bg-badge-success-bg px-2 py-1 text-[11px] text-badge-success-fg">保存后恢复登录能力，原有角色保持不变。</p>
                  )}
                </div>
                              {!isSelf && (
                  <div className="flex items-center justify-between gap-3 border-t pt-3 sm:col-span-2">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">强制下线</p>
                      <p className="text-[11px] text-muted-foreground">{activeSessionCount > 0 ? `当前 ${activeSessionCount} 个活跃会话；` : '当前无活跃会话；'}将撤销全部 Token 并让所有设备退出，不重置密码。</p>
                    </div>
                    <PermissionGuard permission={USER_PERMISSIONS.MANAGE}>
                      <Button variant="outline" size="sm" onClick={() => setForceLogoutOpen(true)}>
                        <LogOut className="h-3.5 w-3.5" /> 强制下线
                      </Button>
                    </PermissionGuard>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* ② 账号安全：把"重置密码/解锁/删除"从页头收进分组，带影响说明 */}
            <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
              <CardHeader className="border-b bg-muted/30 px-3 py-2">
                <CardTitle className="flex items-center gap-2 type-card-title">
                  <KeyRound className="h-4 w-4 text-primary" /> 账号安全
                </CardTitle>
              </CardHeader>
              <CardContent className="divide-y p-0">
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">重置密码</p>
                    <p className="text-[11px] text-muted-foreground">重置后该用户所有活跃会话会被撤销，需要用新密码重新登录。</p>
                  </div>
                  <PermissionGuard permission={USER_PERMISSIONS.RESET_PASSWORD}>
                    <ResetPasswordDialog userId={id} userName={form.name} activeSessionCount={activeSessionCount} />
                  </PermissionGuard>
                </div>
                {(serverUser.status as string) === 'LOCKED' && (
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium">解锁账号</p>
                      <p className="text-[11px] text-muted-foreground">登录失败次数过多会被临时锁定；解锁后恢复为正常状态。</p>
                    </div>
                    <PermissionGuard permission={USER_PERMISSIONS.UPDATE}>
                      <Button variant="outline" size="sm" onClick={handleUnlock} disabled={saving}>
                        <ShieldCheck className="h-3.5 w-3.5" /> 解锁
                      </Button>
                    </PermissionGuard>
                  </div>
                )}
                {!isSelf && (
                <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-destructive">删除用户</p>
                    <p className="text-[11px] text-muted-foreground">立即注销该用户全部权限与活跃会话，不可撤销。</p>
                  </div>
                  <PermissionGuard permission={USER_PERMISSIONS.DELETE}>
                    <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                      <DialogTrigger render={<Button variant="outline" size="sm" className="border-destructive/30 text-destructive hover:bg-destructive/10" />}>
                        <Trash2 className="h-3.5 w-3.5" /> 删除用户
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle className="text-destructive">确认永久删除？</DialogTitle>
                          <DialogDescription>
                            此操作将永久删除用户 <strong>{form.name}</strong>：移除 {roles.length} 个角色绑定{activeSessionCount > 0 ? `，并撤销当前 ${activeSessionCount} 个活跃会话` : ''}。该操作不可撤销。
                          </DialogDescription>
                        </DialogHeader>
                        <DialogFooter>
                          <Button variant="outline" onClick={() => setIsDeleteOpen(false)} disabled={deletingUser}>取消</Button>
                          <Button variant="destructive" onClick={handleDelete} disabled={deletingUser}>
                            {deletingUser ? '删除中...' : '确认删除'}
                          </Button>
                        </DialogFooter>
                      </DialogContent>
                    </Dialog>
                  </PermissionGuard>
                </div>
                )}
                {!isSelf && (
                  <Dialog open={forceLogoutOpen} onOpenChange={setForceLogoutOpen}>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>强制下线用户？</DialogTitle>
                        <DialogDescription>
                          将撤销该用户当前 {activeSessionCount} 个活跃会话及其全部 Refresh / Access Token；所有设备立即退出登录，不重置密码，用户可用原密码重新登录。
                        </DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setForceLogoutOpen(false)} disabled={forceLogoutBusy}>取消</Button>
                        <Button variant="destructive" onClick={handleForceLogout} disabled={forceLogoutBusy}>
                          {forceLogoutBusy ? '下线中...' : '确认强制下线'}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="space-y-3 lg:col-span-4">
            {/* ③ 部门与角色：只读摘要 + 分配入口 */}
            <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
              <CardHeader className="border-b bg-muted/30 px-3 py-2">
                <CardTitle className="flex items-center gap-2 type-card-title">
                  <Building className="h-4 w-4 text-primary" /> 部门与角色
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">所属部门</span>
                  {canUpdate && !isSelf ? (
                    <Select
                      value={form.deptId}
                      onValueChange={(v) => setForm({ ...form, deptId: v })}
                      disabled={saving || deptOptions.length === 0}
                    >
                      <SelectTrigger aria-label="所属部门" className="h-8 w-[150px]">
                        <SelectValue placeholder="未分配" />
                      </SelectTrigger>
                      <SelectContent>
                        {deptOptions.map((d) => (
                          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-[13px] font-medium">{deptName || '未分配'}</span>
                  )}
                </div>
                {canUpdate && isSelf && (
                  <p className="text-[10px] leading-4 text-muted-foreground">不能修改自己的部门，请由其他管理员操作。</p>
                )}
                {canUpdate && !isSelf && form.deptId !== savedForm.deptId && (
                  <p className="rounded bg-badge-warning-bg px-2 py-1 text-[10px] leading-4 text-badge-warning-fg">
                    迁移部门前需确保该用户角色都属于目标部门，否则会提示先解除角色。
                  </p>
                )}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">角色（{roles.length}）</span>
                    <PermissionGuard permission={USER_PERMISSIONS.ASSIGN_ROLE}>
                      <Button asChild variant="outline" size="sm">
                        <Link href={`/users/${id}/roles?returnTo=${encodeURIComponent(`/users/${id}?returnTo=${encodeURIComponent(returnHref)}`)}`}>
                          <Shield className="mr-1.5 h-3.5 w-3.5" /> 管理角色
                        </Link>
                      </Button>
                    </PermissionGuard>
                  </div>
                  {roles.length === 0 ? (
                    <p className="rounded border border-dashed px-2 py-2 text-[11px] text-muted-foreground">
                      未分配角色：该用户登录后只能看到基础页面。
                    </p>
                  ) : (
                    <div className="flex flex-wrap gap-1">
                      {roles.map((r) => (
                        <span key={r.id} title={r.code} className="rounded border border-border/60 bg-muted/40 px-1.5 py-0.5 text-[11px] text-foreground">
                          {r.name}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
                <p className="text-[11px] leading-5 text-muted-foreground">
                  角色决定可访问的菜单与操作权限；部门决定数据范围（子树）。
                </p>
              </CardContent>
            </Card>

            {/* ④ 系统信息：排障需要，提供复制 */}
            <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
              <CardHeader className="border-b bg-muted/30 px-3 py-2">
                <CardTitle className="flex items-center gap-2 type-card-title">
                  <Calendar className="h-4 w-4 text-primary" /> 系统信息
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2.5 p-3">
                <div>
                  <p className="text-[11px] text-muted-foreground">用户 ID</p>
                  <div className="flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px]" title={String(serverUser.id ?? id)}>{String(serverUser.id ?? id)}</code>
                    <CopyTextButton text={String(serverUser.id ?? id)} label="复制用户 ID" successMessage="已复制用户 ID" />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">邮箱验证</span>
                  <Badge variant={emailVerified ? 'success' : 'secondary'} className="text-[10px]">{emailVerified ? '已验证' : '未验证'}</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">最近登录</span>
                  <span className="text-[13px]">{lastLoginAt ? formatDateTime(lastLoginAt) : '从未登录'}</span>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">活跃会话</span>
                  <Badge variant={activeSessionCount > 0 ? 'secondary' : 'outline'} className="text-[10px]">{activeSessionCount} 个</Badge>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-muted-foreground">创建于</span>
                  <span className="text-[13px]">{formatDateTime(createdAt)}</span>
                </div>
                {/* 审计追溯：操作日志的 url/params 含目标用户 ID，用 keyword 精确过滤 */}
                <PermissionGuard permission={AUDIT_PERMISSIONS.READ}>
                  <Button asChild variant="outline" size="sm" className="mt-1 w-full">
                    <Link
                      href={`/audit-logs?tab=operation&keyword=${encodeURIComponent(String(serverUser.id ?? id))}`}
                      title="按目标 ID 匹配该用户的创建与角色/部门/状态等变更记录"
                    >
                      <History className="h-3.5 w-3.5" /> 查看变更审计
                    </Link>
                  </Button>
                </PermissionGuard>
              </CardContent>
            </Card>

            <div className="flex items-start gap-2 rounded-lg border border-badge-warning-fg/30 bg-badge-warning-bg px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 shrink-0 text-badge-warning-fg" />
              <p className="text-[11px] leading-5 text-badge-warning-fg">
                禁用或删除用户会立即撤销其在所有接入子系统中的活跃 Session，请谨慎操作。
              </p>
            </div>
          </div>
        </div>
      </fieldset>

      {/* U-UD01：390px 下页头按钮组会被挤出视口；关键保存操作在移动端固定底部，避免"改完没法保存"。 */}
      {canUpdate && (
        <div className="sticky bottom-0 z-20 -mx-3 flex gap-2 border-t border-border bg-background/95 px-3 py-2 backdrop-blur lg:hidden">
          {isDirty && (
            <Button variant="outline" className="flex-1" onClick={() => setForm(savedForm)} disabled={saving}>
              放弃修改
            </Button>
          )}
          <Button className="flex-1" onClick={handleUpdate} disabled={saving || !isDirty} title={!canUpdate ? '当前账号没有编辑权限' : !isDirty ? '没有未保存的修改' : undefined}>
            {saving ? '保存中...' : <><Save className="h-4 w-4" /> 保存修改</>}
          </Button>
        </div>
      )}
      {leaveGuard}
    </div>
  );
}
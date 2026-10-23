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
  User as UserIcon, Save, Trash2, Shield, Building, Calendar, AlertTriangle, ShieldCheck,
} from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription, DialogTrigger,
} from '@/components/ui/dialog';
import AssignRoleDialog from '../components/AssignRoleDialog';
import { USER_PERMISSIONS } from '@auth-sso/contracts';
import { updateUserAction, deleteUserAction, unlockUserAction } from '../actions';

import { PageHeader } from '@/components/shared/page-header';
import { formatDateTime } from '@/lib/format-date';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { ResetPasswordDialog } from './ResetPasswordDialog';
import { userFacingMessage } from '../components/user-error-copy';
interface Props {
  id: string;
  initialUser: Record<string, unknown> | null;
  /** 是否具备 user:update；无权限时页面进入只读模式（字段禁用 + 横幅） */
  canUpdate: boolean;
}

export default function UserDetailForm({ id, initialUser: serverUser, canUpdate }: Props) {
  const router = useRouter();
  const user = serverUser ?? {};
  const [form, setForm] = useState({
    name: user.name as string,
    email: (user.email as string) || '',
    status: (user.status as string) || 'ACTIVE',
  });
  const [saving, setSaving] = useState(false);
  // 失败处置只有一个入口（本表单不渲染 <FieldError> ⇒ 传空字段 ⇒ 一律 toast）
  const { reportFailure } = useFieldFailure();
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
  const STATUS_LABELS: Record<string, string> = {
    ACTIVE: '正常',
    DISABLED: '已禁用',
    LOCKED: '已锁定',
  };
  const deptName = (serverUser.deptName as string) || null;
  const createdAt = serverUser.createdAt as string;

  const handleUpdate = async () => {
    setSaving(true);
    const res = await updateUserAction(id, form);
    if (res.success) {
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
      router.refresh();
    } else {
      reportFailure({ error: res.error, message: userFacingMessage(res, '解锁失败') });
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
      reportFailure({ error: res.error, message: userFacingMessage(res, '删除失败') });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/users"
        title={form.name}
        description={`账号：${username}`}
        actions={
          <div className="flex flex-wrap items-center justify-start gap-2 lg:justify-end">
          <PermissionGuard permission={USER_PERMISSIONS.DELETE}>
          <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
            <DialogTrigger render={<Button variant="destructive" className="rounded-lg px-6 bg-destructive/10 text-destructive hover:bg-destructive/20 border-none shadow-none" />}>
              <Trash2 className="mr-2 h-4 w-4" /> 删除用户
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle className="text-destructive">确认永久删除？</DialogTitle>
                <DialogDescription>
                  此操作将立即注销用户 <strong>{form.name}</strong> 的所有访问权限。该操作不可撤销。
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>取消</Button>
                <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </PermissionGuard>
          <PermissionGuard permission={USER_PERMISSIONS.RESET_PASSWORD}>
            <ResetPasswordDialog userId={id} userName={form.name} />
          </PermissionGuard>
          <PermissionGuard permission={USER_PERMISSIONS.ASSIGN_ROLE}>
            <Button
              variant="outline"
              className="rounded-lg px-6"
              onClick={() => setIsRoleOpen(true)}
            >
              <Shield className="mr-2 h-4 w-4" /> 分配角色
            </Button>
          </PermissionGuard>
          {(serverUser.status as string) === 'LOCKED' && (
            <PermissionGuard permission={USER_PERMISSIONS.UPDATE}>
              <Button variant="outline" onClick={handleUnlock} disabled={saving}>
                <ShieldCheck className="mr-2 h-4 w-4" /> 解锁
              </Button>
            </PermissionGuard>
          )}
          <PermissionGuard permission={USER_PERMISSIONS.UPDATE}>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? '保存中...' : <><Save className="h-4 w-4" /> 保存修改</>}
            </Button>
          </PermissionGuard>
          </div>
        }
      />

      {!canUpdate && (
        <div data-readonly-banner className="flex items-center gap-2 rounded-xl border border-border/60 bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
          <Shield className="h-4 w-4 shrink-0" />
          只读模式：当前账号缺少用户编辑权限（portal:user:update），仅可查看资料。
        </div>
      )}

      <fieldset disabled={!canUpdate} className="m-0 min-w-0 border-0 p-0">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <Card className="overflow-hidden lg:col-span-8 rounded-xl border-none bg-card shadow-sm ring-1 ring-border/50">
          <CardHeader className="border-b bg-muted/50">
            <CardTitle className="flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-primary" /> 基本资料
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="user-name">显示名称</Label>
                <Input id="user-name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-email">电子邮箱</Label>
                <Input id="user-email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="user-username">登录账号</Label>
                <Input id="user-username" value={username} disabled aria-label="登录账号" className="bg-muted opacity-60" />
              </div>
              <div className="space-y-2">
                <Label>账户状态</Label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm({ ...form, status: v })}
                  disabled={(serverUser.status as string) === 'LOCKED'}
                >
                  <SelectTrigger aria-label="账户状态">
                    <SelectValue>{STATUS_LABELS[form.status] ?? form.status}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">正常</SelectItem>
                    <SelectItem value="DISABLED">已禁用</SelectItem>
                    <SelectItem value="LOCKED">已锁定</SelectItem>
                  </SelectContent>
                </Select>
                {(serverUser.status as string) === 'LOCKED' && (
                  <p className="text-xs text-muted-foreground">
                    已锁定账号不可直接切换状态，请使用右上角「解锁」恢复为正常。
                  </p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-6 lg:col-span-4">
          <Card className="overflow-hidden rounded-xl border-none bg-card shadow-sm ring-1 ring-border/50">
            <CardHeader className="pb-2">
              <CardTitle>系统信息</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg text-muted-foreground"><Building className="h-4 w-4" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">所属部门</p>
                  <p className="text-sm font-medium">{deptName || '未分配'}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg text-muted-foreground"><Calendar className="h-4 w-4" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">创建于</p>
                  <p className="text-sm font-medium">{formatDateTime(createdAt)}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2 bg-muted rounded-lg text-muted-foreground"><Shield className="h-4 w-4" /></div>
                <div>
                  <p className="text-xs text-muted-foreground">安全角色</p>
                  <p className="text-sm text-muted-foreground">通过右上角「分配角色」管理</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="flex items-start gap-4 rounded-xl border border-warning/20 bg-warning/10 p-6">
            <div className="p-2 bg-card rounded-xl shadow-sm text-warning"><AlertTriangle className="h-5 w-5" /></div>
            <div className="space-y-1">
              <h3 className="text-sm font-bold text-warning">高风险操作</h3>
              <p className="text-xs text-warning/80 leading-relaxed">
                禁用或删除用户会立即撤销其在所有接入子系统中的活跃 Session，请谨慎操作。
              </p>
            </div>
          </div>
        </div>
      </div>
      </fieldset>

      {/* U-UD01：390px 下页头按钮组会被挤出视口；关键保存操作在移动端固定底部，避免"改完没法保存"。 */}
      {canUpdate && (
        <div className="sticky bottom-0 z-20 -mx-4 flex gap-2 border-t border-border bg-background/95 px-4 py-3 backdrop-blur lg:hidden">
          {(serverUser.status as string) === 'LOCKED' && (
            <Button variant="outline" className="flex-1" onClick={handleUnlock} disabled={saving}>
              解锁
            </Button>
          )}
          <Button className="flex-1" onClick={handleUpdate} disabled={saving}>
            {saving ? '保存中...' : <><Save className="h-4 w-4" /> 保存修改</>}
          </Button>
        </div>
      )}

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

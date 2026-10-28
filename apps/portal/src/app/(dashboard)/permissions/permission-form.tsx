'use client';

/**
 * 权限新建/编辑表单（页面，不用弹窗）
 *
 * 2026-10-23 用户规则：**弹窗内不允许滚动；需要滚动的表单说明它应该是页面**。
 * 「页面/目录」类型的权限有 8 个字段，在 600px 高的浏览器内容区里弹窗放不下，
 * 因此改为独立路由：/permissions/new 与 /permissions/:id/edit。
 */
import { useMemo, useState } from 'react';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { CopyTextButton } from '@/components/shared/copy-text-button';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PageHeader } from '@/components/shared/page-header';
import { FieldError } from '@/components/shared/field-error';
import { ICON_MAP } from '@/lib/icon-map';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { ALL_PERMISSIONS } from '@auth-sso/contracts';

import { createPermissionAction, updatePermissionAction } from './actions';

const TYPE_LABELS: Record<string, string> = { API: '接口', PAGE: '页面', DIRECTORY: '目录' };

const ICON_LABELS: Record<string, string> = {
  LayoutGrid: '工作台', LayoutDashboard: '仪表盘', Users: '用户', UserPlus: '新增用户', Building2: '部门',
  ShieldCheck: '角色', AppWindow: '应用', Menu: '菜单', ShieldAlert: '审计', FileText: '文档', Key: '权限',
  Lock: '锁', Globe: '全局', Bell: '通知', HelpCircle: '帮助', Settings: '设置', User: '用户', Inbox: '收件箱',
};

export interface MenuOption { id: string; name: string; type: string; parentId: string | null }

export interface PermissionFormProps {
  mode: 'create' | 'edit';
  menuOptions: MenuOption[];
  permission?: {
    id: string;
    name: string;
    code: string;
    type: string;
    description?: string | null;
    path?: string | null;
    icon?: string | null;
    visible?: boolean | null;
    parentId?: string | null;
    sort?: number;
    status?: string;
    clientId?: string | null;
  };
  clients?: Array<{ id: string; name: string }>;
  /** 保存/取消后返回列表；默认 /permissions */
  returnHref?: string;
  /** 新建时继承列表的类型/归属应用筛选 */
  initialType?: string;
  initialClientId?: string;
}

export default function PermissionForm({ mode, menuOptions, permission, clients = [], returnHref = '/permissions', initialType, initialClientId }: PermissionFormProps) {
  const router = useRouter();
  const [form, setForm] = useState({
    name: permission?.name ?? '',
    code: permission?.code ?? '',
    type: permission?.type ?? initialType ?? 'API',
    description: permission?.description ?? '',
    path: permission?.path ?? '',
    icon: permission?.icon ?? '',
    visible: permission?.visible ?? true,
    parentId: permission?.parentId ?? '',
    sort: permission?.sort ?? 0,
    status: permission?.status ?? 'ACTIVE',
    clientId: permission?.clientId ?? initialClientId ?? '',
  });
  const [savedForm] = useState(form);
  const isDirty = JSON.stringify(form) !== JSON.stringify(savedForm);
  const leaveGuard = useUnsavedChangesGuard(isDirty);
  const [saving, setSaving] = useState(false);
  const isBuiltin = mode === 'edit' && permission ? (ALL_PERMISSIONS as readonly string[]).includes(permission.code) : false;
  const isMenu = form.type !== 'API';
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['code']);

  /** 编辑时父级候选排除自身及后代（H-19 环检测的 UI 侧防线） */
  const excludedParentIds = useMemo(() => {
    const excluded = new Set<string>();
    if (!permission) return excluded;
    excluded.add(permission.id);
    const childrenOf = new Map<string, string[]>();
    for (const m of menuOptions) {
      if (!m.parentId) continue;
      const list = childrenOf.get(m.parentId) ?? [];
      list.push(m.id);
      childrenOf.set(m.parentId, list);
    }
    const queue = [permission.id];
    while (queue.length > 0) {
      const current = queue.pop()!;
      for (const childId of childrenOf.get(current) ?? []) {
        if (!excluded.has(childId)) {
          excluded.add(childId);
          queue.push(childId);
        }
      }
    }
    return excluded;
  }, [permission, menuOptions]);

  const menuPayload = (mode: 'create' | 'update') => ({
    path: form.path || (mode === 'update' ? null : undefined),
    icon: form.icon || (mode === 'update' ? null : undefined),
    visible: form.visible,
    parentId: form.parentId || null,
    sort: Number(form.sort) || 0,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearFailure();
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    if (form.type === 'PAGE' && !form.path.trim()) { toast.error('页面类型必须填写路由路径'); return; }
    setSaving(true);
    try {
      const r = mode === 'create'
        ? await createPermissionAction(
            form.type === 'API'
              ? { name: form.name, code: form.code, type: 'API', description: form.description || undefined, clientId: form.clientId || undefined }
              : { name: form.name, code: form.code, type: form.type as 'DIRECTORY' | 'PAGE', description: form.description || undefined, ...menuPayload('create') },
          )
        : await updatePermissionAction(permission!.id, form.type === 'API'
            ? { name: form.name, type: 'API' as const, description: form.description || null, clientId: form.clientId || null, status: form.status }
            : { name: form.name, type: form.type, description: form.description || null, ...menuPayload('update'), status: form.status });
      if (r.success) {
        toast.success(r.message);
        router.push(returnHref);
      } else {
        reportFailure(r);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        backHref={returnHref}
        backLabel="返回权限列表"
        icon="Key"
        title={mode === 'create' ? `新建${TYPE_LABELS[form.type] ?? ''}权限` : `编辑${TYPE_LABELS[form.type] ?? ''}权限`}
        description={mode === 'create' ? '权限编码创建后不可变更；页面/目录类型需要路由与图标' : `编码：${form.code}（创建后不可变更）`}
      />

      {isBuiltin && (
        <div className="rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-[11px] leading-5 text-foreground">
          内置权限：编码被服务端代码引用，不可修改编码、不可删除；可调整名称/描述/状态，禁用后立即影响所有已授权角色。
        </div>
      )}

      <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="rounded-lg border border-border/70 bg-card shadow-sm">
          <div className="border-b bg-muted/30 px-3 py-2 text-[13px] font-medium">基本信息</div>
          <div className="grid gap-3 p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="perm-name">权限名称</Label>
              <Input id="perm-name" value={form.name} maxLength={100} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="用户列表" />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="perm-code">权限编码{mode === 'edit' ? '（不可变更）' : ''}</Label>
                {mode === 'edit' && <CopyTextButton text={form.code} label="复制权限编码" />}
              </div>
              <Input id="perm-code" value={form.code} maxLength={150} disabled={mode === 'edit'} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({ ...form, code: e.target.value })} placeholder="user:list" />
            </div>
            <FieldError failure={fieldError} field="code" />
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="perm-desc">描述（可选）</Label>
              <Input id="perm-desc" value={form.description} maxLength={500} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="用于说明该权限的用途" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="perm-type">类型</Label>
              <Select value={form.type} onValueChange={v => setForm({ ...form, type: v })} disabled={isBuiltin}>
                <SelectTrigger id="perm-type"><SelectValue>{TYPE_LABELS[form.type] ?? form.type}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">接口（API）</SelectItem>
                  <SelectItem value="PAGE">页面（PAGE）</SelectItem>
                  <SelectItem value="DIRECTORY">目录（DIRECTORY）</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === 'edit' && (
              <div className="space-y-1.5">
                <Label htmlFor="perm-status">状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v })}>
                  <SelectTrigger id="perm-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">启用</SelectItem>
                    <SelectItem value="DISABLED">停用</SelectItem>
                  </SelectContent>
                </Select>
                {form.status === 'DISABLED' && (
                  <p className="rounded bg-badge-warning-bg px-2 py-1 text-[10px] leading-4 text-badge-warning-fg">
                    停用后立即影响所有已授权角色；权限本身保留，可随时恢复。
                  </p>
                )}
              </div>
            )}
            {form.type === 'API' && (
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="perm-client">归属应用（可选）</Label>
                <Select value={form.clientId || 'NONE'} onValueChange={(v) => setForm({ ...form, clientId: v === 'NONE' ? '' : v })} disabled={isBuiltin}>
                  <SelectTrigger id="perm-client"><SelectValue>{(form.clientId && clients.find((c) => c.id === form.clientId)?.name) || '不绑定'}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NONE">不绑定</SelectItem>
                    {clients.map((c) => (
                      <SelectItem key={c.id} value={c.id}>{c.name}（{c.id}）</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[10px] leading-4 text-muted-foreground">{isBuiltin ? '内置权限的归属应用由服务端代码固定，不可修改。' : '归属应用决定该权限属于哪个 OAuth Client；接口编码建议以 Client ID 开头。'}</p>
              </div>
            )}
            {isMenu && (
              <div className="space-y-1.5">
                <Label htmlFor="perm-parent">父级权限</Label>
                <Select value={form.parentId || 'ROOT'} onValueChange={(v) => setForm({ ...form, parentId: v === 'ROOT' ? '' : v })}>
                  <SelectTrigger id="perm-parent"><SelectValue>{menuOptions.find((m) => m.id === form.parentId)?.name ?? '顶层权限'}</SelectValue></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ROOT">顶层权限</SelectItem>
                    {menuOptions.filter((m) => !excludedParentIds.has(m.id)).map((m) => (
                      <SelectItem key={m.id} value={m.id}>{m.name}{m.type === 'DIRECTORY' ? '（目录）' : ''}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        </div>

        {isMenu && (
          <div className="rounded-lg border border-border/70 bg-card shadow-sm">
            <div className="border-b bg-muted/30 px-3 py-2 text-[13px] font-medium">菜单配置</div>
            <div className="grid gap-3 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="perm-path">路由路径{form.type === 'PAGE' ? '（必填）' : '（可选）'}</Label>
                <Input id="perm-path" value={form.path} maxLength={200} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/users" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perm-icon">图标</Label>
                <Select value={form.icon || 'LayoutGrid'} onValueChange={(v) => setForm({ ...form, icon: v })}>
                  <SelectTrigger id="perm-icon"><SelectValue>{ICON_LABELS[form.icon || 'LayoutGrid'] ?? (form.icon || '工作台')}</SelectValue></SelectTrigger>
                  <SelectContent>
                    {Object.keys(ICON_MAP).map((name) => (<SelectItem key={name} value={name}>{ICON_LABELS[name] ?? name}</SelectItem>))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="perm-sort">排序</Label>
                <Input id="perm-sort" type="number" value={form.sort} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} />
              </div>
              <label className="flex items-center gap-2 pb-2 text-sm sm:pt-6">
                <Checkbox checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v === true })} />
                在侧边栏显示
              </label>
            </div>
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <Button type="button" variant="outline" size="sm" asChild>
            <Link href={returnHref}>取消</Link>
          </Button>
          <Button type="submit" size="sm" disabled={saving}>{saving ? '保存中...' : mode === 'create' ? '创建' : '保存'}</Button>
        </div>
      </form>
      {leaveGuard}
    </div>
  );
}

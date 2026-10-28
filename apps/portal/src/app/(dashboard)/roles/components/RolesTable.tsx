'use client';

/**
 * 角色列表交互组件 — 搜索、分页、增删改
 * 写操作通过 Server Actions 直调
 *
 * v3.2: dataScopeType 已替换为 deptId，新建/编辑角色使用部门选择器
 */
import React, { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Edit, Trash2, KeyRound, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import {
  TableCell, TableRow,
} from '@/components/ui/table';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { enableStatus } from '@/lib/status-label';
import { createRoleAction, updateRoleAction, deleteRoleAction } from '../actions';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { FieldError } from '@/components/shared/field-error';

import { SearchInput } from '@/components/shared/search-input';
import { TableToolbar } from '@/components/shared/table-toolbar';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { ROLE_PERMISSIONS } from '@auth-sso/contracts';
interface RoleRow {
  id: string;  name: string; code: string;
  description: string | null; deptId: string;
  isSystem: boolean; status: string; sort: number; createdAt: string;
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number; }

interface Props {
  roles: RoleRow[];
  pagination: Pagination;
  initialKeyword: string;
  /** 排序：default | permissions-asc | permissions-desc */
  initialSort?: string;
  /** 状态筛选：'' | ACTIVE | DISABLED */
  initialStatus?: string;
  /** 部门筛选（''=全部） */
  initialDeptId?: string;
  /** 工作台快捷入口 /roles?create=1 自动打开 */
  autoOpenCreate?: boolean;
  departments: Array<{ id: string; name: string }>;
  /** 删除确认的影响面：roleId → 绑定用户数（U-ROLES03） */
  boundUserCounts?: Record<string, number>;
  /** 角色 → 权限条数（空壳/高权角色判断） */
  permissionCounts?: Record<string, number>;
}

export default function RolesTable({ roles, pagination, initialKeyword, initialSort = 'default', initialStatus = '', initialDeptId = '', autoOpenCreate = false, departments, boundUserCounts = {}, permissionCounts = {} }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const currentListHref = `/roles${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(autoOpenCreate);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', description: '', deptId: autoOpenCreate ? (departments[0]?.id ?? '') : '', sort: 0, status: 'ACTIVE' });
  /** 具体错误码（如 ROLE_ALREADY_EXISTS）落到对应输入框（#92；hook 供四处表单复用） */
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['code']);

  const closeAddDialog = () => { setIsAddOpen(false); if (autoOpenCreate) router.replace('/roles'); };

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (value: string) => {
    setKeyword(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set('keyword', value.trim());
      if (initialSort !== 'default') params.set('sort', initialSort);
      if (initialStatus) params.set('status', initialStatus);
      if (initialDeptId) params.set('deptId', initialDeptId);
      params.set('page', '1');
      startTransition(() => router.push(`/roles?${params.toString()}`));
    }, 300);
  };
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const getDefaultDeptId = () => departments.length > 0 ? departments[0]!.id : '';

  /** 对话框统一改为 `<form>` 提交（U-G06/U-ROLES02）：Enter 与点击主按钮行为一致 */
  const submitCreate = (e: React.FormEvent) => { e.preventDefault(); void handleCreate(); };
  const submitUpdate = (e: React.FormEvent) => { e.preventDefault(); void handleUpdate(); };

  const openEdit = (r: RoleRow) => {
    setSelected(r);
    setForm({ name: r.name, code: r.code, description: r.description || '', deptId: r.deptId, sort: r.sort, status: r.status });
    setIsEditOpen(true);
  };

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    if (!form.deptId) { toast.error('请选择所属部门'); return; }
    clearFailure();
    setSaving(true);
    const res = await createRoleAction({ name: form.name, code: form.code, description: form.description.trim() || undefined, deptId: form.deptId, sort: form.sort });
    setSaving(false);
    if (res.success) { toast.success(res.message); setIsAddOpen(false); if (autoOpenCreate) router.replace('/roles'); router.refresh(); } else { reportFailure(res); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    clearFailure();
    const res = await updateRoleAction(selected.id, { ...form, description: form.description.trim() || null });
    setSaving(false);
    if (res.success) { toast.success(res.message); setIsEditOpen(false); router.refresh(); } else { reportFailure(res); }
  };

  /**
   * 删除**只用闭包参数**，不读 `selected`。
   *
   * 此前是 `onClick={() => { setSelected(r); handleDelete(); }}`：`setSelected` 是异步的，
   * `handleDelete` 读到的仍是上一次的 state（首击时为 null）⇒ 点击静默无反应
   * （审计 P1-3 实测：DB 行数不变、无 toast）。现在改为弹窗确认，目标随点击显式传入。
   */
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await deleteRoleAction(deleteTarget.id);
    setDeleting(false);
    if (res.success) {
      toast.success(res.message);
      setDeleteTarget(null);
      router.refresh();
    } else {
      // 失败保留确认框，避免用户反复重开
      reportFailure(res);
    }
  };

  /** 删除角色的影响面文案：0 用户/0 权限时不展示无意义数字 */
  const deletionImpactText = (roleId: string) => {
    const users = boundUserCounts[roleId] ?? 0;
    const perms = permissionCounts[roleId] ?? 0;
    const userText = users > 0 ? `${users} 个用户` : '暂无绑定用户';
    const permText = perms > 0 ? `将清除 ${perms} 条权限绑定` : '该角色无权限绑定';
    return `${userText}；${permText}`;
  };

  const getDeptName = (deptId: string) => departments.find(d => d.id === deptId)?.name ?? deptId;

  const renderDeptSelect = (value: string, onChange: (v: string) => void, id?: string) => (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue placeholder="选择部门" /></SelectTrigger>
      <SelectContent>
        {departments.map(d => (
          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  // 列宽/响应式：角色名是主信息占弹性宽度；编码、部门是辅助信息，窄屏逐级隐藏，
  // 操作列固定宽度（三个图标按钮），避免 1024px 下操作列被挤到视野外。
  const applySort = (value: string) => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (initialStatus) params.set('status', initialStatus);
    if (initialDeptId) params.set('deptId', initialDeptId);
    if (value !== 'default') params.set('sort', value);
    params.set('page', '1');
    startTransition(() => router.push(`/roles?${params.toString()}`));
  };
  const applyStatus = (value: string) => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (initialSort !== 'default') params.set('sort', initialSort);
    if (initialDeptId) params.set('deptId', initialDeptId);
    if (value) params.set('status', value);
    params.set('page', '1');
    startTransition(() => router.push(`/roles?${params.toString()}`));
  };
  const applyDept = (value: string) => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (initialSort !== 'default') params.set('sort', initialSort);
    if (initialStatus) params.set('status', initialStatus);
    if (value !== 'ALL') params.set('deptId', value);
    params.set('page', '1');
    startTransition(() => router.push(`/roles?${params.toString()}`));
  };

  const columns = [
    { key: 'name', header: '角色名称', className: 'min-w-[240px]' },
    { key: 'code', header: '编码', className: 'hidden w-[150px] md:table-cell' },
    { key: 'dept', header: '所属部门', className: 'hidden w-[150px] lg:table-cell' },
    { key: 'permissions', header: '权限数', className: 'hidden w-[84px] sm:table-cell' },
    { key: 'status', header: '状态', className: 'hidden w-[96px] sm:table-cell' },
    { key: 'actions', header: '操作', className: 'w-[116px] text-right' },
  ];

  const cardHeader = (
    <TableToolbar
      className="md:items-start"
      left={
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2">
          <h1 className="shrink-0 text-[15px] font-semibold tracking-tight text-foreground">角色管理</h1>
          <SearchInput placeholder="搜索角色名称或编码" value={keyword} onChange={handleSearch} busy={isPending} className="w-full sm:w-auto md:w-56" />
          <div className="order-3 flex w-full flex-wrap items-center gap-2 min-[1100px]:order-2 min-[1100px]:w-auto">
            <Select value={initialSort} onValueChange={applySort}>
              <SelectTrigger aria-label="角色排序" className="w-[calc(50%-0.25rem)] md:w-32">
                <SelectValue>
                  {initialSort === 'permissions-asc' ? '权限数最少' : initialSort === 'permissions-desc' ? '权限数最多' : '默认排序'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">默认排序</SelectItem>
                <SelectItem value="permissions-asc">权限数最少</SelectItem>
                <SelectItem value="permissions-desc">权限数最多</SelectItem>
              </SelectContent>
            </Select>
            <Select value={initialStatus || 'ALL'} onValueChange={(v) => applyStatus(v === 'ALL' ? '' : v)}>
              <SelectTrigger aria-label="过滤角色状态" className="w-[calc(50%-0.25rem)] md:w-28">
                <SelectValue>
                  {initialStatus === 'ACTIVE' ? '已启用' : initialStatus === 'DISABLED' ? '已禁用' : '全部状态'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部状态</SelectItem>
                <SelectItem value="ACTIVE">已启用</SelectItem>
                <SelectItem value="DISABLED">已禁用</SelectItem>
              </SelectContent>
            </Select>
            <Select value={initialDeptId || 'ALL'} onValueChange={applyDept}>
              <SelectTrigger aria-label="过滤角色部门" className="w-[calc(50%-0.25rem)] md:w-32">
                <SelectValue>{departments.find((d) => d.id === initialDeptId)?.name ?? '全部部门'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部部门</SelectItem>
                {departments.map((d) => (
                  <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      }
      right={
        <PermissionGuard permission={ROLE_PERMISSIONS.CREATE}>
          <Button onClick={() => { setForm({ name: '', code: '', description: '', deptId: getDefaultDeptId(), sort: 0, status: 'ACTIVE' }); setIsAddOpen(true); }}>
            <Plus className="h-4 w-4" /> 新建角色
          </Button>
        </PermissionGuard>
      }
    />
  );

  const renderRow = (r: RoleRow) => (
    <TableRow key={r.id}>
      {/* 主信息：图标仅作视觉锚点（7×7/浅色底），名称 13px 半粗，描述 11px 单行。 */}
      <TableCell>
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10">
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          </div>
          <div className="flex min-w-0 flex-col leading-tight">
            <div className="flex items-center gap-1.5">
              <span className="max-w-[260px] truncate text-[13px] font-semibold text-foreground" title={r.name}>{r.name}</span>
              {r.isSystem && (
                <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">系统</Badge>
              )}
              <Badge variant="outline" className="h-5 shrink-0 px-1.5 text-[10px] font-normal" title="当前绑定用户数">
                {boundUserCounts[r.id] ?? 0} 用户
              </Badge>
            </div>
            {r.description && (
              <p className="line-clamp-1 text-[11px] leading-4 text-muted-foreground" title={r.description}>{r.description}</p>
            )}
            {/* <sm：状态列隐藏（空间优先给名称与操作），状态改用行内小徽章，信息不丢。 */}
            <span className="mt-0.5 sm:hidden">
              <Badge variant={enableStatus(r.status).variant} className="h-4 px-1 text-[10px]">{enableStatus(r.status).label}</Badge>
            </span>
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <code className="inline-flex max-w-full items-center truncate rounded border border-border/70 bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground/80">
          {r.code}
        </code>
      </TableCell>
      <TableCell className="hidden lg:table-cell">
        <span className="block max-w-[150px] truncate text-[13px] text-muted-foreground">{getDeptName(r.deptId)}</span>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Link
          href={`/roles/${r.id}/permissions?returnTo=${encodeURIComponent(currentListHref)}`}
          title={
            (permissionCounts[r.id] ?? 0) === 0
              ? '该角色没有任何权限，绑定用户将无法登录门户；点击配置权限'
              : `配置权限（当前 ${permissionCounts[r.id] ?? 0} 项）`
          }
          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[12px] tabular-nums hover:bg-primary/10"
        >
          {(permissionCounts[r.id] ?? 0) === 0 ? (
            <Badge variant="warning" className="h-5 px-1.5 text-[10px]">无权限</Badge>
          ) : (
            <span className="font-medium text-foreground">{permissionCounts[r.id]} 项</span>
          )}
        </Link>
      </TableCell>
      <TableCell className="hidden sm:table-cell">
        <Badge variant={enableStatus(r.status).variant} className="text-[11px]">{enableStatus(r.status).label}</Badge>
      </TableCell>
      {/* 操作列：图标按钮 + 原生 title 提示，节省横宽；aria-label 保留完整语义（读屏/自动化不受影响）。 */}
      <TableCell className="text-right">
        {r.isSystem ? (
          <PermissionGuard permission={ROLE_PERMISSIONS.ASSIGN_PERMISSION}>
            <Button asChild variant="ghost" size="icon-sm" aria-label={`查看权限 ${r.name}`} title="查看权限（系统角色只读）">
              <Link href={`/roles/${r.id}/permissions?returnTo=${encodeURIComponent(currentListHref)}`}><Eye className="h-4 w-4" /></Link>
            </Button>
          </PermissionGuard>
        ) : (
          <div className="flex items-center justify-end gap-0.5">
            <PermissionGuard permission={ROLE_PERMISSIONS.UPDATE}>
              <Button variant="ghost" size="icon-sm" aria-label={`编辑角色 ${r.name}`} title={`编辑角色 ${r.name}`} onClick={() => openEdit(r)}>
                <Edit className="h-4 w-4" />
              </Button>
            </PermissionGuard>
            <PermissionGuard permission={ROLE_PERMISSIONS.ASSIGN_PERMISSION}>
              <Button asChild variant="ghost" size="icon-sm" aria-label={`配置权限 ${r.name}`} title={`配置权限 ${r.name}`}>
                <Link href={`/roles/${r.id}/permissions?returnTo=${encodeURIComponent(currentListHref)}`}>
                  <KeyRound className="h-4 w-4" />
                </Link>
              </Button>
            </PermissionGuard>
            <PermissionGuard permission={ROLE_PERMISSIONS.DELETE}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`删除角色 ${r.name}`}
                title={`删除角色 ${r.name}`}
                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                onClick={() => setDeleteTarget(r)}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </PermissionGuard>
          </div>
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
      <DataTable
        columns={columns}
        data={roles}
        loading={isPending}
        emptyState={
          keyword.trim() || initialStatus !== '' || initialDeptId !== '' ? (
            <EmptyState
              variant="simple"
              kind="filtered"
              icon="ShieldCheck"
              clearAction={{ label: '清除搜索', href: '/roles' }}
            />
          ) : (
            <EmptyState
              variant="simple"
              icon="ShieldCheck"
              title="暂无角色"
              description="创建角色以开始管理权限"
              action={{ label: '新建角色', onClick: () => { setForm({ name: '', code: '', description: '', deptId: getDefaultDeptId(), sort: 0, status: 'ACTIVE' }); setIsAddOpen(true); } }}
            />
          )
        }
        renderRow={renderRow}
        cardHeader={cardHeader}
      />
      <TablePagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPageChange={(next) => {
          const p = new URLSearchParams(window.location.search);
          p.set('page', String(next));
          startTransition(() => router.push(`/roles?${p.toString()}`));
        }}
        disabled={isPending}
      />
      </div>

      <Dialog open={isAddOpen} onOpenChange={(open) => { setIsAddOpen(open); if (!open) closeAddDialog(); }}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> 新建角色</DialogTitle></DialogHeader>
          <form onSubmit={submitCreate}>
            <div className="grid gap-3 py-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="role-name">角色名称</Label><Input id="role-name" value={form.name} maxLength={100} onChange={e => setForm({...form, name: e.target.value})} placeholder="管理员" /></div>
              <div className="space-y-2"><Label htmlFor="role-code">角色编码</Label><Input id="role-code" value={form.code} maxLength={50} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} placeholder="admin" /><FieldError failure={fieldError} field="code" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="role-description">描述（可选）</Label><Textarea id="role-description" value={form.description} maxLength={500} rows={2} onChange={e => setForm({...form, description: e.target.value})} placeholder="例如：可管理用户、角色与审计日志" /></div>
              <div className="space-y-2"><Label htmlFor="role-dept">所属部门</Label>{renderDeptSelect(form.deptId, v => setForm({...form, deptId: v}), 'role-dept')}</div>
              <div className="space-y-2"><Label htmlFor="role-sort">排序（越小越靠前）</Label><Input id="role-sort" type="number" value={form.sort} onChange={e => setForm({...form, sort: Number(e.target.value)})} /></div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={closeAddDialog}>取消</Button><Button type="submit" disabled={saving}>创建</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑角色</DialogTitle></DialogHeader>
          <form onSubmit={submitUpdate}>
            <div className="grid gap-3 py-4 sm:grid-cols-2">
              <div className="space-y-2"><Label htmlFor="role-edit-name">角色名称</Label><Input id="role-edit-name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              <div className="space-y-2"><Label htmlFor="role-edit-code">角色编码</Label><Input id="role-edit-code" value={form.code} disabled /><FieldError failure={fieldError} field="code" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="role-edit-description">描述（可选）</Label><Textarea id="role-edit-description" value={form.description} maxLength={500} rows={2} onChange={e => setForm({...form, description: e.target.value})} placeholder="例如：可管理用户、角色与审计日志" /></div>
              <div className="space-y-2 sm:col-span-2"><Label htmlFor="role-edit-dept">所属部门</Label>{renderDeptSelect(form.deptId, v => setForm({...form, deptId: v}), 'role-edit-dept')}
                {selected && (boundUserCounts[selected.id] ?? 0) > 0 && (
                  <p className="rounded bg-badge-warning-bg px-2 py-1 text-[10px] leading-4 text-badge-warning-fg">
                    该角色已绑定 {boundUserCounts[selected.id]} 个用户；迁移部门前需先解除绑定，否则保存会被拒绝。
                  </p>
                )}
              </div>
              <div className="space-y-2"><Label htmlFor="role-edit-sort">排序（越小越靠前）</Label><Input id="role-edit-sort" type="number" value={form.sort} onChange={e => setForm({...form, sort: Number(e.target.value)})} /></div>
              <div className="space-y-2">
                <Label htmlFor="role-edit-status">状态</Label>
                <Select value={form.status} onValueChange={(v) => setForm({...form, status: v})}>
                  <SelectTrigger id="role-edit-status"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ACTIVE">启用</SelectItem>
                    <SelectItem value="DISABLED">停用</SelectItem>
                  </SelectContent>
                </Select>
                {form.status === 'DISABLED' && (
                  <p className="rounded bg-badge-warning-bg px-2 py-1 text-[10px] leading-4 text-badge-warning-fg">
                    停用后绑定用户立即失去该角色权限，可能无法登录门户；角色配置保留，可随时恢复。
                  </p>
                )}
              </div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsEditOpen(false)}>取消</Button><Button type="submit" disabled={saving}>保存</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 删除确认（危险操作统一走设计系统弹窗，不用原生 confirm） */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>删除角色「{deleteTarget?.name}」？</DialogTitle>
            <DialogDescription>
              删除后该角色的权限绑定会一并清除；若已分配给用户，这些用户会失去该角色的权限并被强制重新登录。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive" data-delete-impact>
              影响面：{deletionImpactText(deleteTarget.id)}。
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

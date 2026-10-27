'use client';

/**
 * 角色列表交互组件 — 搜索、分页、增删改
 * 写操作通过 Server Actions 直调
 *
 * v3.2: dataScopeType 已替换为 deptId，新建/编辑角色使用部门选择器
 */
import React, { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Edit, Trash2, KeyRound, Eye,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  departments: Array<{ id: string; name: string }>;
  /** 删除确认的影响面：roleId → 绑定用户数（U-ROLES03） */
  boundUserCounts?: Record<string, number>;
  /** 角色 → 权限条数（空壳/高权角色判断） */
  permissionCounts?: Record<string, number>;
}

export default function RolesTable({ roles, pagination, initialKeyword, initialSort = 'default', initialStatus = '', departments, boundUserCounts = {}, permissionCounts = {} }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', description: '', deptId: '', sort: 0 });
  /** 具体错误码（如 ROLE_ALREADY_EXISTS）落到对应输入框（#92；hook 供四处表单复用） */
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['code']);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = (value: string) => {
    setKeyword(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams();
      if (value.trim()) params.set('keyword', value.trim());
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
    setForm({ name: r.name, code: r.code, description: r.description || '', deptId: r.deptId, sort: r.sort });
    setIsEditOpen(true);
  };

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    if (!form.deptId) { toast.error('请选择所属部门'); return; }
    clearFailure();
    setSaving(true);
    const res = await createRoleAction({ name: form.name, code: form.code, description: form.description || undefined, deptId: form.deptId, sort: form.sort });
    setSaving(false);
    if (res.success) { toast.success(res.message); setIsAddOpen(false); router.refresh(); } else { reportFailure(res); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    clearFailure();
    const res = await updateRoleAction(selected.id, form);
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
    setDeleteTarget(null);
    if (res.success) { toast.success(res.message); router.refresh(); } else { reportFailure(res); }
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
    if (value !== 'default') params.set('sort', value);
    params.set('page', '1');
    router.push(`/roles?${params.toString()}`);
  };
  const applyStatus = (value: string) => {
    const params = new URLSearchParams();
    if (keyword.trim()) params.set('keyword', keyword.trim());
    if (initialSort !== 'default') params.set('sort', initialSort);
    if (value) params.set('status', value);
    params.set('page', '1');
    router.push(`/roles?${params.toString()}`);
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
      left={
        <div className="flex min-w-0 flex-wrap items-center gap-2 md:flex-nowrap md:gap-3">
          <h1 className="w-full shrink-0 text-[15px] font-semibold tracking-tight text-foreground md:w-auto">角色管理</h1>
          <SearchInput placeholder="搜索角色名称或编码..." value={keyword} onChange={handleSearch} busy={isPending} className="w-full md:w-64" />
          <Select value={initialSort} onValueChange={applySort}>
            <SelectTrigger aria-label="角色排序" className="w-[calc(50%-0.25rem)] md:w-40">
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
            <SelectTrigger aria-label="过滤角色状态" className="w-[calc(50%-0.25rem)] md:w-32">
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
        </div>
      }
      right={
        <PermissionGuard permission={ROLE_PERMISSIONS.CREATE}>
          <Button onClick={() => { setForm({ name: '', code: '', description: '', deptId: getDefaultDeptId(), sort: 0 }); setIsAddOpen(true); }}>
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
          href={`/roles/${r.id}/permissions`}
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
              <Link href={`/roles/${r.id}/permissions`}><Eye className="h-4 w-4" /></Link>
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
                <Link href={`/roles/${r.id}/permissions`}>
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
          keyword.trim() || initialStatus !== '' ? (
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
              action={{ label: '新建角色', onClick: () => { setForm({ name: '', code: '', description: '', deptId: getDefaultDeptId(), sort: 0 }); setIsAddOpen(true); } }}
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
          router.push(`/roles?${p.toString()}`);
        }}
      />
      </div>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> 新建角色</DialogTitle></DialogHeader>
          <form onSubmit={submitCreate}>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label htmlFor="role-name">角色名称</Label><Input id="role-name" value={form.name} maxLength={100} onChange={e => setForm({...form, name: e.target.value})} placeholder="管理员" /></div>
              <div className="space-y-2"><Label htmlFor="role-code">角色编码</Label><Input id="role-code" value={form.code} maxLength={50} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} placeholder="admin" /></div>
              <FieldError failure={fieldError} field="code" />
              <div className="space-y-2"><Label htmlFor="role-dept">所属部门</Label>{renderDeptSelect(form.deptId, v => setForm({...form, deptId: v}), 'role-dept')}</div>
            </div>
            <DialogFooter><Button type="button" variant="outline" onClick={() => setIsAddOpen(false)}>取消</Button><Button type="submit" disabled={saving}>创建</Button></DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>编辑角色</DialogTitle></DialogHeader>
          <form onSubmit={submitUpdate}>
            <div className="space-y-4 py-4">
              <div className="space-y-2"><Label htmlFor="role-edit-name">角色名称</Label><Input id="role-edit-name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
              <div className="space-y-2"><Label htmlFor="role-edit-code">角色编码</Label><Input id="role-edit-code" value={form.code} disabled /></div>
              {/* 编辑态的 code 是 disabled（不可改、也不会产生冲突码），但仍渲染错误——
                  否则 update 失败时既不弹 toast 也不内联，正是要消灭的静默路径 */}
              <FieldError failure={fieldError} field="code" />
              <div className="space-y-2"><Label htmlFor="role-edit-dept">所属部门</Label>{renderDeptSelect(form.deptId, v => setForm({...form, deptId: v}), 'role-edit-dept')}</div>
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
              影响面：{boundUserCounts[deleteTarget.id] ?? 0} 个用户；该角色的权限绑定将同步清除。
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

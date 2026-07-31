'use client';

/**
 * 角色列表交互组件 — 搜索、分页、增删改
 * 写操作通过 Server Actions 直调
 *
 * v3.2: dataScopeType 已替换为 deptId，新建/编辑角色使用部门选择器
 */
import React, { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Search, MoreHorizontal, Edit, Trash2, KeyRound,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  TableCell, TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import {
  assignRolePermissionsAction,
  createRoleAction,
  updateRoleAction,
  deleteRoleAction,
} from '../actions';

interface RoleRow {
  id: string;  name: string; code: string;
  description: string | null; deptId: string;
  isSystem: boolean; status: string; sort: number; boundUserCount: number;
  permissionIds: string[]; createdAt: string;
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number; }

interface Props {
  roles: RoleRow[];
  pagination: Pagination;
  initialKeyword: string;
  departments: Array<{ id: string; name: string }>;
  permissions: Array<{ id: string; code: string; name: string }>;
  canAssignPermissions: boolean;
}

export default function RolesTable({
  roles,
  pagination,
  initialKeyword,
  departments,
  permissions,
  canAssignPermissions,
}: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<RoleRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [permissionTarget, setPermissionTarget] = useState<RoleRow | null>(null);
  const [selectedPermissionIds, setSelectedPermissionIds] = useState<Set<string>>(new Set());
  const [form, setForm] = useState({ name: '', code: '', description: '', deptId: '', sort: 0 });

  const handleSearch = (value: string) => {
    setKeyword(value);
    const params = new URLSearchParams();
    if (value) params.set('keyword', value);
    startTransition(() => router.push(`/roles${params.toString() ? `?${params.toString()}` : ''}`));
  };

  const getDefaultDeptId = () => departments.length > 0 ? departments[0]!.id : '';

  const openEdit = (r: RoleRow) => {
    setSelected(r);
    setForm({ name: r.name, code: r.code, description: r.description || '', deptId: r.deptId, sort: r.sort });
    setIsEditOpen(true);
  };

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    if (!form.deptId) { toast.error('请选择所属部门'); return; }
    setSaving(true);
    const res = await createRoleAction({ name: form.name, code: form.code, description: form.description || undefined, deptId: form.deptId, sort: form.sort });
    setSaving(false);
    if (res.success) { toast.success(res.message); setIsAddOpen(false); router.refresh(); } else { toast.error(res.message); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    const res = await updateRoleAction(selected.id, form);
    setSaving(false);
    if (res.success) { toast.success(res.message); setIsEditOpen(false); router.refresh(); } else { toast.error(res.message); }
  };

  const handleDelete = async (target: RoleRow) => {
    setDeleting(true);
    try {
      const res = await deleteRoleAction(target.id);
      if (res.success) {
        toast.success(res.message);
        setDeleteTarget(null);
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } finally {
      setDeleting(false);
    }
  };

  const getDeptName = (deptId: string) => departments.find(d => d.id === deptId)?.name ?? deptId;
  const permissionGroups = useMemo(() => {
    const groups = new Map<string, typeof permissions>();
    for (const permission of permissions) {
      const segments = permission.code.split(':');
      const key = segments.slice(0, 2).join(':') || 'other';
      const values = groups.get(key) ?? [];
      values.push(permission);
      groups.set(key, values);
    }
    return [...groups.entries()];
  }, [permissions]);

  const openPermissions = (role: RoleRow) => {
    setPermissionTarget(role);
    setSelectedPermissionIds(new Set(role.permissionIds));
  };

  const savePermissions = async () => {
    if (!permissionTarget) return;
    setSaving(true);
    try {
      const result = await assignRolePermissionsAction(
        permissionTarget.id,
        [...selectedPermissionIds],
      );
      if (result.success) {
        toast.success(result.message);
        setPermissionTarget(null);
        router.refresh();
      } else {
        toast.error(result.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const renderDeptSelect = (id: string, value: string, onChange: (v: string) => void) => (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger id={id}><SelectValue placeholder="选择部门" /></SelectTrigger>
      <SelectContent>
        {departments.map(d => (
          <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  const columns = [
    { key: 'name', header: '角色名称', className: 'pl-8' },
    { key: 'code', header: '编码' },
    { key: 'dept', header: '所属部门' },
    { key: 'status', header: '状态' },
    { key: 'actions', header: '操作', className: 'text-right pr-8' },
  ];

  const cardHeader = (
    <div className="bg-muted/50 border-b py-4 px-6">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <div className="relative w-full md:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
          <Input placeholder="搜索角色名称或编码..." className="pl-9 h-9 rounded-lg text-sm" value={keyword} onChange={e => handleSearch(e.target.value)} />
        </div>
        <Button size="sm" className="rounded-lg" onClick={() => { setForm({ name: '', code: '', description: '', deptId: getDefaultDeptId(), sort: 0 }); setIsAddOpen(true); }}>
          <Plus className="mr-1.5 h-3.5 w-3.5" /> 新建角色
        </Button>
      </div>
    </div>
  );

  const renderRow = (r: RoleRow) => (
    <TableRow key={r.id} className="hover:bg-muted/50">
      <TableCell className="pl-8">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10"><ShieldCheck className="h-4 w-4 text-primary" /></div>
          <div>
            <span className="font-medium text-sm">{r.name}</span>
            {r.isSystem && <Badge variant="outline" className="ml-2 text-[10px]">系统</Badge>}
            {r.description && <p className="text-[10px] text-muted-foreground">{r.description}</p>}
          </div>
        </div>
      </TableCell>
      <TableCell><code className="text-xs bg-muted px-2 py-0.5 rounded">{r.code}</code></TableCell>
      <TableCell><span className="text-xs text-muted-foreground">{getDeptName(r.deptId)}</span></TableCell>
      <TableCell><Badge variant={r.status === 'ACTIVE' ? 'success' : 'secondary'} className="text-[10px]">{r.status === 'ACTIVE' ? '启用' : '停用'}</Badge></TableCell>
      <TableCell className="text-right pr-8">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label={`打开 ${r.name} 的角色操作`}><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-xl p-2">
            <DropdownMenuLabel className="text-[10px]">角色操作</DropdownMenuLabel><DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openEdit(r)}><Edit className="h-3.5 w-3.5 mr-2 text-primary" /> 编辑</DropdownMenuItem>
            {canAssignPermissions && (
              <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openPermissions(r)}>
                <KeyRound className="h-3.5 w-3.5 mr-2 text-primary" /> 配置权限
              </DropdownMenuItem>
            )}
            {!r.isSystem && (
              <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive" onClick={() => setDeleteTarget(r)}>
                <Trash2 className="h-3.5 w-3.5 mr-2" /> 删除
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={roles}
        loading={isPending}
        emptyState={
          <EmptyState
            variant="simple"
            icon={ShieldCheck}
            title="暂无角色"
            description="创建角色以开始管理权限"
            action={{ label: '新建角色', onClick: () => { setForm({ name: '', code: '', description: '', deptId: getDefaultDeptId(), sort: 0 }); setIsAddOpen(true); } }}
          />
        }
        renderRow={renderRow}
        cardHeader={cardHeader}
      />
      {pagination.totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t bg-muted/50">
          <span className="text-xs text-muted-foreground">共 {pagination.total} 条</span>
          <div className="flex gap-1">
            {Array.from({ length: pagination.totalPages }).map((_, i) => (
              <Button key={i} variant={i + 1 === pagination.page ? 'default' : 'ghost'} size="sm" className="h-7 w-7 text-xs rounded-lg"
                onClick={() => { const p = new URLSearchParams(window.location.search); p.set('page', String(i + 1)); router.push(`/roles?${p.toString()}`); }}>
                {i + 1}
              </Button>
            ))}
          </div>
        </div>
      )}

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> 新建角色</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label htmlFor="role-name">角色名称</Label><Input id="role-name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="管理员" /></div>
            <div className="space-y-2"><Label htmlFor="role-code">角色编码</Label><Input id="role-code" value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="admin" /></div>
            <div className="space-y-2"><Label htmlFor="role-department">所属部门</Label>{renderDeptSelect('role-department', form.deptId, v => setForm({...form, deptId: v}))}</div>
            <div className="space-y-2"><Label htmlFor="role-description">角色描述</Label><Input id="role-description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} placeholder="说明该角色的职责与适用范围" /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsAddOpen(false)}>取消</Button><Button onClick={handleCreate} disabled={saving}>创建</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>编辑角色</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label htmlFor="edit-role-name">角色名称</Label><Input id="edit-role-name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-2"><Label htmlFor="edit-role-code">角色编码</Label><Input id="edit-role-code" value={form.code} disabled /></div>
            <div className="space-y-2"><Label htmlFor="edit-role-department">所属部门</Label>{renderDeptSelect('edit-role-department', form.deptId, v => setForm({...form, deptId: v}))}</div>
            <div className="space-y-2"><Label htmlFor="edit-role-description">角色描述</Label><Input id="edit-role-description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsEditOpen(false)}>取消</Button><Button onClick={handleUpdate} disabled={saving}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={permissionTarget !== null}
        onOpenChange={(open) => {
          if (!open && !saving) setPermissionTarget(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>配置角色权限</DialogTitle>
            <DialogDescription>
              为“{permissionTarget?.name}”选择 API 权限。保存后，已绑定用户的权限缓存和访问令牌会立即失效。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-5 py-2">
            {permissionGroups.map(([group, items]) => (
              <fieldset key={group} className="rounded-xl border p-4">
                <legend className="px-2 text-sm font-bold">{group}</legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {items.map((permission) => (
                    <label key={permission.id} className="flex items-start gap-2 rounded-lg p-2 hover:bg-muted">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedPermissionIds.has(permission.id)}
                        onChange={(event) => {
                          setSelectedPermissionIds((previous) => {
                            const next = new Set(previous);
                            if (event.target.checked) next.add(permission.id);
                            else next.delete(permission.id);
                            return next;
                          });
                        }}
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{permission.name}</span>
                        <code className="block truncate text-[10px] text-muted-foreground">{permission.code}</code>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPermissionTarget(null)} disabled={saving}>取消</Button>
            <Button onClick={() => void savePermissions()} disabled={saving}>
              {saving ? '保存中...' : `保存 ${selectedPermissionIds.size} 项权限`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null);
        }}
      >
        <DialogContent className="rounded-2xl">
          <DialogHeader>
            <DialogTitle>确认删除角色</DialogTitle>
            <DialogDescription>
              {deleteTarget
                ? `角色“${deleteTarget.name}”将被永久删除，并解除 ${deleteTarget.boundUserCount} 位用户的角色绑定及全部权限关联。此操作不可撤销。`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setDeleteTarget(null)}
              disabled={deleting}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleteTarget) void handleDelete(deleteTarget);
              }}
              disabled={deleting}
            >
              {deleting ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

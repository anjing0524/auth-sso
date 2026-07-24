'use client';

/**
 * 角色列表交互组件 — 搜索、分页、增删改
 * 写操作通过 Server Actions 直调
 *
 * v3.2: dataScopeType 已替换为 deptId，新建/编辑角色使用部门选择器
 */
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Search, MoreHorizontal, Edit, Trash2,
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
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { createRoleAction, updateRoleAction, deleteRoleAction } from '../actions';

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
  departments: Array<{ id: string; name: string }>;
}

export default function RolesTable({ roles, pagination, initialKeyword, departments }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<RoleRow | null>(null);
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

  const handleDelete = async () => {
    if (!selected) return;
    const res = await deleteRoleAction(selected.id);
    if (res.success) { toast.success(res.message); setIsEditOpen(false); router.refresh(); } else { toast.error(res.message); }
  };

  const getDeptName = (deptId: string) => departments.find(d => d.id === deptId)?.name ?? deptId;

  const renderDeptSelect = (value: string, onChange: (v: string) => void) => (
    <Select value={value || undefined} onValueChange={onChange}>
      <SelectTrigger><SelectValue placeholder="选择部门" /></SelectTrigger>
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
      <TableCell><Badge variant={r.status === 'ACTIVE' ? 'success' : 'secondary'} className="text-[10px]">{r.status}</Badge></TableCell>
      <TableCell className="text-right pr-8">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-xl p-2">
            <DropdownMenuLabel className="text-[10px]">角色操作</DropdownMenuLabel><DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openEdit(r)}><Edit className="h-3.5 w-3.5 mr-2 text-primary" /> 编辑</DropdownMenuItem>
            {!r.isSystem && (
              <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive" onClick={() => { setSelected(r); handleDelete(); }}>
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
            <div className="space-y-2"><Label>角色名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="管理员" /></div>
            <div className="space-y-2"><Label>角色编码</Label><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="admin" /></div>
            <div className="space-y-2"><Label>所属部门</Label>{renderDeptSelect(form.deptId, v => setForm({...form, deptId: v}))}</div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsAddOpen(false)}>取消</Button><Button onClick={handleCreate} disabled={saving}>创建</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>编辑角色</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>角色名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>角色编码</Label><Input value={form.code} disabled /></div>
            <div className="space-y-2"><Label>所属部门</Label>{renderDeptSelect(form.deptId, v => setForm({...form, deptId: v}))}</div>
          </div>
          <DialogFooter><Button variant="ghost" onClick={() => setIsEditOpen(false)}>取消</Button><Button onClick={handleUpdate} disabled={saving}>保存</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

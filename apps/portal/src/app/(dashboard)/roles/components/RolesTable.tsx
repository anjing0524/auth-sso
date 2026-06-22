'use client';

/**
 * 角色列表交互组件 — 搜索、分页、增删改
 * 写操作通过 Server Actions 直调
 */
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Search, MoreHorizontal, Edit, Trash2,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
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
import { createRoleAction, updateRoleAction, deleteRoleAction } from '../actions';

interface RoleRow {
  id: string;  name: string; code: string;
  description: string | null; dataScopeType: string;
  isSystem: boolean; status: string; sort: number; createdAt: string;
}

interface Pagination { page: number; pageSize: number; total: number; totalPages: number; }

interface Props {
  roles: RoleRow[];
  pagination: Pagination;
  initialKeyword: string;
}

export default function RolesTable({ roles, pagination, initialKeyword }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);

  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [form, setForm] = useState({ name: '', code: '', description: '', dataScopeType: 'SELF' as string, sort: 0 });

  const handleSearch = (value: string) => {
    setKeyword(value);
    const params = new URLSearchParams();
    if (value) params.set('keyword', value);
    startTransition(() => router.push(`/roles${params.toString() ? `?${params.toString()}` : ''}`));
  };

  const openEdit = (r: RoleRow) => { setSelected(r); setForm({ name: r.name, code: r.code, description: r.description || '', dataScopeType: r.dataScopeType, sort: r.sort }); setIsEditOpen(true); };

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    setSaving(true);
    const res = await createRoleAction({ name: form.name, code: form.code, description: form.description || undefined, dataScopeType: form.dataScopeType as 'ALL' | 'DEPT' | 'SELF' | 'CUSTOM', sort: form.sort });
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

  return (
    <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem]">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b py-4 px-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
            <Input placeholder="搜索角色名称或编码..." className="pl-9 h-9 rounded-lg text-sm" value={keyword} onChange={e => handleSearch(e.target.value)} />
          </div>
          <Button size="sm" className="rounded-lg" onClick={() => { setForm({ name: '', code: '', description: '', dataScopeType: 'SELF', sort: 0 }); setIsAddOpen(true); }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> 新建角色
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-slate-50/30">
            <TableRow>
              <TableHead className="pl-8">角色名称</TableHead>
              <TableHead>编码</TableHead>
              <TableHead>数据范围</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right pr-8">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground">加载中...</TableCell></TableRow>
            ) : roles.length === 0 ? (
              <TableRow><TableCell colSpan={5} className="text-center py-16 text-muted-foreground">暂无角色数据</TableCell></TableRow>
            ) : roles.map(r => (
              <TableRow key={r.id} className="hover:bg-slate-50/50">
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
                <TableCell><code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{r.code}</code></TableCell>
                <TableCell><Badge variant="outline" className="text-[10px]">{r.dataScopeType}</Badge></TableCell>
                <TableCell><Badge variant={r.status === 'ACTIVE' ? 'success' : 'secondary'} className="text-[10px]">{r.status}</Badge></TableCell>
                <TableCell className="text-right pr-8">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg"><MoreHorizontal className="h-3.5 w-3.5" /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-40 rounded-xl p-2">
                      <DropdownMenuLabel className="text-[10px]">角色操作</DropdownMenuLabel><DropdownMenuSeparator />
                      <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openEdit(r)}><Edit className="h-3.5 w-3.5 mr-2 text-blue-500" /> 编辑</DropdownMenuItem>
                      {!r.isSystem && (
                        <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive" onClick={() => { setSelected(r); handleDelete(); }}>
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> 删除
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-6 py-3 border-t bg-slate-50/30">
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
      </CardContent>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}><DialogContent className="rounded-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> 新建角色</DialogTitle></DialogHeader><div className="space-y-4 py-4"><div className="space-y-2"><Label>角色名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="管理员" /></div><div className="space-y-2"><Label>角色编码</Label><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="admin" /></div><div className="space-y-2"><Label>数据范围</Label><Select value={form.dataScopeType} onValueChange={v => setForm({...form, dataScopeType: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">全部</SelectItem><SelectItem value="DEPT">本部门</SelectItem><SelectItem value="SELF">仅本人</SelectItem><SelectItem value="CUSTOM">自定义</SelectItem></SelectContent></Select></div></div><DialogFooter><Button variant="ghost" onClick={() => setIsAddOpen(false)}>取消</Button><Button onClick={handleCreate} disabled={saving}>创建</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}><DialogContent className="rounded-2xl"><DialogHeader><DialogTitle>编辑角色</DialogTitle></DialogHeader><div className="space-y-4 py-4"><div className="space-y-2"><Label>角色名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div><div className="space-y-2"><Label>角色编码</Label><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} /></div><div className="space-y-2"><Label>数据范围</Label><Select value={form.dataScopeType} onValueChange={v => setForm({...form, dataScopeType: v})}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ALL">全部</SelectItem><SelectItem value="DEPT">本部门</SelectItem><SelectItem value="SELF">仅本人</SelectItem><SelectItem value="CUSTOM">自定义</SelectItem></SelectContent></Select></div></div><DialogFooter><Button variant="ghost" onClick={() => setIsEditOpen(false)}>取消</Button><Button onClick={handleUpdate} disabled={saving}>保存</Button></DialogFooter></DialogContent></Dialog>
    </Card>
  );
}

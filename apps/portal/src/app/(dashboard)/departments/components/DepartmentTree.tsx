'use client';

/**
 * 部门树交互组件 — 展开/折叠、搜索、增删改
 * 写操作通过 Server Actions 直调，不调 REST API
 */
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Building2, Plus, ChevronRight, ChevronDown, MoreVertical, Edit, Trash2, Search, Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EmptyState } from '@/components/shared/empty-state';
import { createDepartmentAction, updateDepartmentAction, deleteDepartmentAction } from '../actions';

interface DeptTreeNode {
  id: string;
  
  parentId: string | null;
  name: string;
  code: string | null;
  sort: number;
  status: string;
  children: DeptTreeNode[];
}

interface Props {
  departments: DeptTreeNode[];
}

/** 扁平化树节点（含深度） */
function flattenTree(nodes: DeptTreeNode[], depth = 0): Array<DeptTreeNode & { depth: number }> {
  let result: Array<DeptTreeNode & { depth: number }> = [];
  for (const node of nodes) {
    result.push({ ...node, depth });
    if (node.children?.length) result = result.concat(flattenTree(node.children, depth + 1));
  }
  return result;
}

export default function DepartmentTree({ departments }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // 弹窗
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<DeptTreeNode | null>(null);
  const [parentId, setParentId] = useState<string>('');
  const [form, setForm] = useState({ name: '', code: '', sort: 0, parentId: '' as string | null });

  const toggleExpand = (id: string) => {
    setExpanded(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  const openAdd = (parent?: string) => { setForm({ name: '', code: '', sort: 0, parentId: parent || null }); setIsAddOpen(true); };
  const openEdit = (dept: DeptTreeNode) => { setSelected(dept); setForm({ name: dept.name, code: dept.code || '', sort: dept.sort, parentId: dept.parentId }); setIsEditOpen(true); };

  const handleCreate = async () => {
    if (!form.name) { toast.error('请填写部门名称'); return; }
    setSaving(true);
    const r = await createDepartmentAction({ name: form.name, code: form.code || undefined, sort: form.sort, parentId: form.parentId });
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsAddOpen(false); router.refresh(); } else { toast.error(r.message); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    const r = await updateDepartmentAction(selected.id, form);
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); } else { toast.error(r.message); }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const r = await deleteDepartmentAction(selected.id);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); } else { toast.error(r.message); }
  };

  const flatList = flattenTree(departments);
  const filtered = keyword ? flatList.filter(d => d.name.includes(keyword) || d.code?.includes(keyword)) : flatList;

  return (
    <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-xl">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b py-4 px-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-72">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
            <Input placeholder="搜索部门..." className="pl-9 h-9 rounded-lg text-sm" value={keyword} onChange={e => setKeyword(e.target.value)} />
          </div>
          <Button size="sm" className="rounded-lg" onClick={() => openAdd()}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> 新建根部门
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y">
          {filtered.map(dept => (
            <div key={dept.id} className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50/50 transition-colors" style={{ paddingLeft: `${24 + dept.depth * 24}px` }}>
              {(dept.children?.length ?? 0) > 0 ? (
                <Button variant="ghost" size="icon" className="h-6 w-6 rounded" onClick={() => toggleExpand(dept.id)}>
                  {expanded.has(dept.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                </Button>
              ) : <div className="w-6" />}
              <Building2 className="h-4 w-4 text-blue-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">{dept.name}</span>
                  {dept.code && <code className="text-[10px] text-slate-400">{dept.code}</code>}
                </div>
              </div>
              <Badge variant={dept.status === 'ACTIVE' ? 'success' : 'secondary'} className="text-[10px] shrink-0">{dept.status}</Badge>
              <div className="flex items-center gap-1 shrink-0">
                <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => openAdd(dept.id)} title="添加子部门"><Plus className="h-3 w-3" /></Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg"><MoreVertical className="h-3 w-3" /></Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-40 rounded-xl p-2">
                    <DropdownMenuLabel className="text-[10px]">部门操作</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openEdit(dept)}><Edit className="h-3.5 w-3.5 mr-2 text-blue-500" /> 编辑</DropdownMenuItem>
                    <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive" onClick={() => { setSelected(dept); handleDelete(); }}>
                      <Trash2 className="h-3.5 w-3.5 mr-2" /> 删除
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <EmptyState variant="simple" icon={Building2} title="暂无部门" description="创建组织架构以开始管理" action={{ label: '创建根部门', onClick: () => openAdd() }} />
          )}
        </div>
      </CardContent>

      {/* 新增对话框 */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Building2 className="h-5 w-5 text-primary" /> 新建部门</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>部门名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="技术部" /></div>
            <div className="space-y-2"><Label>部门编码</Label><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="tech" /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsAddOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? '创建中...' : '确认创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>编辑部门</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>部门名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>部门编码</Label><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} /></div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>取消</Button>
            <Button onClick={handleUpdate} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

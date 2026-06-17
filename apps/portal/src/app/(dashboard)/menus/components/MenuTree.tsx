'use client';

/**
 * 菜单树交互组件 — 展开/折叠、增删改、递归删除
 * 写操作通过 Server Actions 直调
 */
import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Plus, ChevronRight, ChevronDown, MoreHorizontal, Edit, Trash2, Search, Menu, Globe, FolderTree,
} from 'lucide-react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { createMenuAction, updateMenuAction, deleteMenuAction } from '../actions';

interface MenuItem {
  id: string; publicId: string; parentId: string | null;
  name: string; path: string | null; icon: string | null; sort: number;
  menuType: string; status: string; visible: boolean;
  children?: MenuItem[];
}

interface Props {
  menus: MenuItem[];
}

function flattenTree(nodes: MenuItem[], depth = 0): Array<MenuItem & { depth: number }> {
  return nodes.reduce<Array<MenuItem & { depth: number }>>((acc, node) => {
    acc.push({ ...node, depth });
    if (node.children?.length) acc.push(...flattenTree(node.children, depth + 1));
    return acc;
  }, []);
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  DIRECTORY: <FolderTree className="h-3.5 w-3.5 text-amber-500" />,
  MENU: <Menu className="h-3.5 w-3.5 text-blue-500" />,
  BUTTON: <Globe className="h-3.5 w-3.5 text-green-500" />,
};

export default function MenuTree({ menus }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [selected, setSelected] = useState<MenuItem | null>(null);
  const [form, setForm] = useState({ name: '', path: '', icon: '', parentId: null as string | null, sort: 0, menuType: 'MENU' as string });

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const openAdd = (parent?: string) => { setForm({ name: '', path: '', icon: '', parentId: parent || null, sort: 0, menuType: 'MENU' }); setIsAddOpen(true); };
  const openEdit = (m: MenuItem) => { setSelected(m); setForm({ name: m.name, path: m.path || '', icon: m.icon || '', parentId: m.parentId, sort: m.sort, menuType: m.menuType }); setIsEditOpen(true); };

  const handleCreate = async () => {
    if (!form.name) { toast.error('请填写菜单名称'); return; }
    setSaving(true);
    const r = await createMenuAction({ name: form.name, path: form.path || undefined, icon: form.icon || undefined, parentId: form.parentId, sort: form.sort, visible: true, menuType: form.menuType as 'DIRECTORY' | 'MENU' | 'BUTTON' });
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsAddOpen(false); router.refresh(); } else { toast.error(r.message); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    const r = await updateMenuAction(selected.id, form);
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); } else { toast.error(r.message); }
  };

  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm('确认删除此菜单？子菜单将一并递归删除。')) return;
    const r = await deleteMenuAction(selected.id);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); } else { toast.error(r.message); }
  };

  const flatList = flattenTree(menus);
  const filtered = keyword ? flatList.filter(m => m.name.includes(keyword) || m.path?.includes(keyword)) : flatList;

  return (
    <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem]">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b py-4 px-6">
        <div className="flex items-center justify-between gap-4">
          <div className="relative w-72"><Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" /><Input placeholder="搜索菜单..." className="pl-9 h-9 rounded-lg text-sm" value={keyword} onChange={e => setKeyword(e.target.value)} /></div>
          <Button size="sm" className="rounded-lg" onClick={() => openAdd()}><Plus className="mr-1.5 h-3.5 w-3.5" /> 新建</Button>
        </div>
      </CardHeader>
      <CardContent className="p-0"><div className="divide-y">
        {filtered.map(m => (
          <div key={m.id} className="flex items-center gap-3 px-6 py-3 hover:bg-slate-50/50" style={{ paddingLeft: `${24 + m.depth * 24}px` }}>
            {(m.children?.length ?? 0) > 0 ? <Button variant="ghost" size="icon" className="h-6 w-6 rounded" onClick={() => toggleExpand(m.id)}>{expanded.has(m.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}</Button> : <div className="w-6" />}
            {TYPE_ICONS[m.menuType] || <Menu className="h-3.5 w-3.5" />}
            <div className="flex-1 min-w-0"><span className="font-medium text-sm">{m.name}</span><span className="text-[10px] text-slate-400 ml-2">{m.path}</span></div>
            <Badge variant="outline" className="text-[10px]">{m.menuType}</Badge>
            <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg" onClick={() => openAdd(m.id)}><Plus className="h-3 w-3" /></Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg"><MoreHorizontal className="h-3 w-3" /></Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36 rounded-xl p-2">
                <DropdownMenuLabel className="text-[10px]">菜单操作</DropdownMenuLabel><DropdownMenuSeparator />
                <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openEdit(m)}><Edit className="h-3.5 w-3.5 mr-2 text-blue-500" /> 编辑</DropdownMenuItem>
                <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive" onClick={() => { setSelected(m); handleDelete(); }}><Trash2 className="h-3.5 w-3.5 mr-2" /> 删除</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {filtered.length === 0 && <div className="text-center py-16 text-muted-foreground text-sm">暂无菜单数据</div>}
      </div></CardContent>

      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}><DialogContent className="rounded-2xl"><DialogHeader><DialogTitle>新建菜单</DialogTitle></DialogHeader><div className="space-y-4 py-4"><div className="space-y-2"><Label>菜单名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div><div className="space-y-2"><Label>路由路径</Label><Input value={form.path} onChange={e => setForm({...form, path: e.target.value})} placeholder="/dashboard" /></div></div><DialogFooter><Button variant="ghost" onClick={() => setIsAddOpen(false)}>取消</Button><Button onClick={handleCreate} disabled={saving}>创建</Button></DialogFooter></DialogContent></Dialog>
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}><DialogContent className="rounded-2xl"><DialogHeader><DialogTitle>编辑菜单</DialogTitle></DialogHeader><div className="space-y-4 py-4"><div className="space-y-2"><Label>菜单名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div><div className="space-y-2"><Label>路由路径</Label><Input value={form.path} onChange={e => setForm({...form, path: e.target.value})} /></div></div><DialogFooter><Button variant="ghost" onClick={() => setIsEditOpen(false)}>取消</Button><Button onClick={handleUpdate} disabled={saving}>保存</Button></DialogFooter></DialogContent></Dialog>
    </Card>
  );
}

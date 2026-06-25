'use client';

/**
 * 权限列表交互组件 — Tab 过滤、搜索、增删改弹窗
 * 写操作通过 Server Actions 直调
 */
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Search, MoreHorizontal, Edit, Trash2, Database, Globe, Code, Folder,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '../actions';

interface PermissionRow {
  id: string;
  
  name: string;
  code: string;
  type: string;
  resource: string | null;
  action: string | null;
  status: string;
  createdAt: string;
}

interface Props {
  permissions: PermissionRow[];
  activeTab: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
	  DIRECTORY: <Folder className="h-3 w-3 text-purple-500" />,
	  PAGE: <Globe className="h-3 w-3 text-blue-500" />,
	  API: <Code className="h-3 w-3 text-green-500" />,
  DATA: <Database className="h-3 w-3 text-orange-500" />,
};

const TABS = ['ALL', 'DIRECTORY', 'PAGE', 'API', 'DATA'];

export default function PermissionsTable({ permissions, activeTab }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState('');
  const [isPending, startTransition] = useTransition();

  // 弹窗
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<PermissionRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', code: '', type: 'API' as string, resource: '', action: '' });

  const handleTabChange = (tab: string) => {
    startTransition(() => {
      router.push(`/permissions${tab !== 'ALL' ? `?type=${tab}` : ''}`);
    });
  };

  const openEdit = (p: PermissionRow) => {
    setSelected(p);
    setForm({ name: p.name, code: p.code, type: p.type, resource: p.resource || '', action: p.action || '' });
    setIsEditOpen(true);
  };

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    setSaving(true);
    const r = await createPermissionAction({ name: form.name, code: form.code, type: form.type as 'DIRECTORY' | 'PAGE' | 'API' | 'DATA', resource: form.resource, action: form.action, sort: 0 });
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsAddOpen(false); setForm({ name: '', code: '', type: 'API', resource: '', action: '' }); router.refresh(); }
    else { toast.error(r.message); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    const r = await updatePermissionAction(selected.id, form);
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); }
    else { toast.error(r.message); }
  };

  const handleDelete = async () => {
    if (!selected) return;
    const r = await deletePermissionAction(selected.id);
    if (r.success) { toast.success(r.message); setIsDeleteOpen(false); router.refresh(); }
    else { toast.error(r.message); }
  };

  const filtered = keyword
    ? permissions.filter(p => p.name.includes(keyword) || p.code.includes(keyword))
    : permissions;

  return (
    <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-xl">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b py-4 px-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
          <Tabs value={activeTab} onValueChange={handleTabChange} className="w-auto">
            <TabsList className="h-9">
              {TABS.map(tab => (
                <TabsTrigger key={tab} value={tab} className="text-xs px-3">{tab}</TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <div className="flex gap-3 items-center">
            <div className="relative w-64">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
              <Input placeholder="搜索权限名称或编码..." className="pl-9 h-9 rounded-lg text-sm" value={keyword} onChange={e => setKeyword(e.target.value)} />
            </div>
            <Button size="sm" className="rounded-lg" onClick={() => { setForm({ name: '', code: '', type: 'API', resource: '', action: '' }); setIsAddOpen(true); }}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> 新增
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-slate-50/30">
            <TableRow>
              <TableHead className="pl-8">权限名称</TableHead>
              <TableHead>权限编码</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>状态</TableHead>
              <TableHead className="text-right pr-8">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-8"><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-12 rounded-full" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                  <TableCell className="text-right pr-8"><Skeleton className="ml-auto h-8 w-8 rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : (
              filtered.map(p => (
                <TableRow key={p.id} className="hover:bg-slate-50/50">
                  <TableCell className="pl-8 font-medium">{p.name}</TableCell>
                  <TableCell><code className="text-xs bg-slate-100 px-2 py-0.5 rounded">{p.code}</code></TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px] gap-1">
                      {TYPE_ICONS[p.type] || null} {p.type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge variant={p.status === 'ACTIVE' ? 'success' : 'secondary'} className="text-[10px]">{p.status}</Badge>
                  </TableCell>
                  <TableCell className="text-right pr-8">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg"><MoreHorizontal className="h-3.5 w-3.5" /></Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-40 rounded-xl p-2">
                        <DropdownMenuLabel className="text-[10px]">权限操作</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openEdit(p)}>
                          <Edit className="h-3.5 w-3.5 mr-2 text-blue-500" /> 编辑
                        </DropdownMenuItem>
                        <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive" onClick={() => { setSelected(p); setIsDeleteOpen(true); }}>
                          <Trash2 className="h-3.5 w-3.5 mr-2" /> 删除
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>

      {/* 新增对话框 */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> 新增权限</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>权限名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="用户列表" /></div>
            <div className="space-y-2"><Label>权限编码</Label><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="user:list" /></div>
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">API</SelectItem>
                  <SelectItem value="DIRECTORY">DIRECTORY</SelectItem>
                  <SelectItem value="DATA">DATA</SelectItem>
                </SelectContent>
              </Select>
            </div>
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
          <DialogHeader><DialogTitle>编辑权限</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>权限名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>权限编码</Label><Input value={form.code} onChange={e => setForm({...form, code: e.target.value})} /></div>
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">API</SelectItem>
                  <SelectItem value="DIRECTORY">DIRECTORY</SelectItem>
                  <SelectItem value="DATA">DATA</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsEditOpen(false)}>取消</Button>
            <Button onClick={handleUpdate} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">确认删除权限 "{selected?.name}"？关联角色的绑定将同步清除。</p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

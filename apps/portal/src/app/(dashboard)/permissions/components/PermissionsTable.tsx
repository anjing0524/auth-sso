'use client';

/**
 * 权限列表交互组件 — Tab 过滤、搜索、增删改弹窗
 * 写操作通过 Server Actions 直调
 */
import React, { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Search, MoreHorizontal, Edit, Trash2, Globe, Code, Folder,
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '../actions';

interface PermissionRow {
  id: string;
  name: string;
  code: string;
  type: string;
  description: string | null;
  path: string | null;
  status: string;
  boundRoleCount: number;
  boundMenuCount: number;
  createdAt: string;
}

interface Props {
  permissions: PermissionRow[];
  activeTab: string;
  /** URL 同步的搜索关键词初始值 */
  initialKeyword?: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  DIRECTORY: <Folder className="h-3 w-3 text-purple-500" />,
  PAGE: <Globe className="h-3 w-3 text-blue-500" />,
  API: <Code className="h-3 w-3 text-green-500" />,
};

const TABS = ['ALL', 'DIRECTORY', 'PAGE', 'API'];
const TAB_LABELS: Record<string, string> = {
  ALL: '全部',
  DIRECTORY: '目录',
  PAGE: '页面',
  API: '接口',
};

export default function PermissionsTable({ permissions, activeTab, initialKeyword = '' }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();

  // 弹窗
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<PermissionRow | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    code: '',
    type: 'API' as string,
    description: '',
    path: '',
  });

  const handleTabChange = (tab: string) => {
    startTransition(() => {
      router.push(`/permissions${tab !== 'ALL' ? `?type=${tab}` : ''}`);
    });
  };

  /** 搜索关键词同步到 URL searchParams（遵循 RolesTable 模式） */
  const handleSearch = (value: string) => {
    setKeyword(value);
    const params = new URLSearchParams(window.location.search);
    if (value) params.set('keyword', value);
    else params.delete('keyword');
    startTransition(() => router.push(`/permissions${params.toString() ? `?${params.toString()}` : ''}`));
  };

  const openEdit = (p: PermissionRow) => {
    setSelected(p);
    setForm({
      name: p.name,
      code: p.code,
      type: p.type,
      description: p.description ?? '',
      path: p.path ?? '',
    });
    setIsEditOpen(true);
  };

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    setSaving(true);
    const r = await createPermissionAction({
      name: form.name,
      code: form.code,
      type: form.type as 'DIRECTORY' | 'PAGE' | 'API',
      description: form.description || undefined,
      ...(form.type !== 'API' ? {
        path: form.path || undefined,
        visible: true,
      } : {}),
      sort: 0,
    });
    setSaving(false);
    if (r.success) {
      toast.success(r.message);
      setIsAddOpen(false);
      setForm({ name: '', code: '', type: 'API', description: '', path: '' });
      router.refresh();
    }
    else { toast.error(r.message); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    setSaving(true);
    const r = await updatePermissionAction(selected.id, {
      name: form.name,
      description: form.description || null,
    });
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

  const columns = [
    { key: 'name', header: '权限名称', className: 'pl-8' },
    { key: 'code', header: '权限编码' },
    { key: 'type', header: '类型' },
    { key: 'references', header: '引用' },
    { key: 'status', header: '状态' },
    { key: 'actions', header: '操作', className: 'text-right pr-8' },
  ];

  const cardHeader = (
    <div className="bg-muted/50 border-b py-4 px-6">
      <div className="flex flex-col md:flex-row gap-4 items-center justify-between">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="w-auto">
          <TabsList className="h-9">
            {TABS.map(tab => (
              <TabsTrigger key={tab} value={tab} className="text-xs px-3">{TAB_LABELS[tab]}</TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <div className="flex gap-3 items-center">
          <div className="relative w-64">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
            <Input placeholder="搜索权限名称或编码..." className="pl-9 h-9 rounded-lg text-sm" value={keyword} onChange={e => handleSearch(e.target.value)} />
          </div>
          <Button size="sm" className="rounded-lg" onClick={() => {
            setForm({ name: '', code: '', type: 'API', description: '', path: '' });
            setIsAddOpen(true);
          }}>
            <Plus className="mr-1.5 h-3.5 w-3.5" /> 新增
          </Button>
        </div>
      </div>
    </div>
  );

  const renderRow = (p: PermissionRow) => (
    <TableRow key={p.id} className="hover:bg-muted/50">
      <TableCell className="pl-8 font-medium">{p.name}</TableCell>
      <TableCell><code className="text-xs bg-muted px-2 py-0.5 rounded">{p.code}</code></TableCell>
      <TableCell>
        <Badge variant="outline" className="text-[10px] gap-1">
          {TYPE_ICONS[p.type] || null} {p.type}
        </Badge>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {p.boundRoleCount} 个角色 / {p.boundMenuCount} 个菜单
      </TableCell>
      <TableCell>
        <Badge variant={p.status === 'ACTIVE' ? 'success' : 'secondary'} className="text-[10px]">
          {p.status === 'ACTIVE' ? '启用' : '停用'}
        </Badge>
      </TableCell>
      <TableCell className="text-right pr-8">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" aria-label={`打开 ${p.name} 的操作菜单`}><MoreHorizontal className="h-3.5 w-3.5" /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40 rounded-xl p-2">
            <DropdownMenuLabel className="text-[10px]">权限操作</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="rounded-lg cursor-pointer" onClick={() => openEdit(p)}>
              <Edit className="h-3.5 w-3.5 mr-2 text-primary" /> 编辑
            </DropdownMenuItem>
            <DropdownMenuItem className="rounded-lg cursor-pointer text-destructive" onClick={() => { setSelected(p); setIsDeleteOpen(true); }}>
              <Trash2 className="h-3.5 w-3.5 mr-2" /> 删除
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={filtered}
        loading={isPending}
        emptyState={
          <EmptyState
            variant="simple"
            icon={ShieldCheck}
            title="暂无权限"
            description="新增权限点以控制功能访问"
            action={{ label: '新增权限', onClick: () => {
              setForm({ name: '', code: '', type: 'API', description: '', path: '' });
              setIsAddOpen(true);
            } }}
          />
        }
        renderRow={renderRow}
        cardHeader={cardHeader}
      />

      {/* 新增对话框 */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent className="rounded-2xl">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> 新增权限</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label htmlFor="permission-name">权限名称</Label><Input id="permission-name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} placeholder="用户列表" /></div>
            <div className="space-y-2"><Label htmlFor="permission-code">权限编码</Label><Input id="permission-code" value={form.code} onChange={e => setForm({...form, code: e.target.value})} placeholder="portal:resource:action" /></div>
            <div className="space-y-2"><Label htmlFor="permission-description">描述</Label><Input id="permission-description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <div className="space-y-2">
              <Label htmlFor="permission-type">类型</Label>
              <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                <SelectTrigger id="permission-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">API</SelectItem>
                  <SelectItem value="DIRECTORY">DIRECTORY</SelectItem>
                  <SelectItem value="PAGE">PAGE</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.type !== 'API' && (
              <div className="space-y-2">
                <Label htmlFor="permission-path">菜单路径{form.type === 'PAGE' ? '（必填）' : ''}</Label>
                <Input id="permission-path" value={form.path} onChange={e => setForm({...form, path: e.target.value})} placeholder="/users" />
              </div>
            )}
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
            <div className="space-y-2"><Label htmlFor="edit-permission-name">权限名称</Label><Input id="edit-permission-name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-2"><Label htmlFor="edit-permission-code">权限编码</Label><Input id="edit-permission-code" value={form.code} disabled /></div>
            <div className="space-y-2"><Label htmlFor="edit-permission-description">描述</Label><Input id="edit-permission-description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} /></div>
            <div className="space-y-2">
              <Label htmlFor="edit-permission-type">类型</Label>
              <Select value={form.type} disabled>
                <SelectTrigger id="edit-permission-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">API</SelectItem>
                  <SelectItem value="DIRECTORY">DIRECTORY</SelectItem>
                  <SelectItem value="PAGE">PAGE</SelectItem>
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
          <p className="text-sm text-muted-foreground">
            确认删除权限 &quot;{selected?.name}&quot;？将清除 {selected?.boundRoleCount ?? 0} 个角色绑定，
            并解除 {selected?.boundMenuCount ?? 0} 个菜单的可见权限绑定。
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

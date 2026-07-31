'use client';

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Edit, Menu, MoreHorizontal, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { MENU_ICON_VALUES } from '@auth-sso/contracts';
import { createMenuAction, deleteMenuAction, updateMenuAction } from '../actions';

interface MenuRow {
  id: string;
  code: string;
  name: string;
  type: 'DIRECTORY' | 'PAGE';
  description: string | null;
  path: string | null;
  icon: string | null;
  visible: boolean;
  parentId: string | null;
  requiredPermissionId: string | null;
  status: string;
  sort: number;
}

interface MenuForm {
  code: string;
  name: string;
  type: 'DIRECTORY' | 'PAGE';
  description: string;
  path: string;
  icon: string;
  visible: boolean;
  parentId: string;
  requiredPermissionId: string;
  sort: number;
}

const EMPTY_FORM: MenuForm = {
  code: '',
  name: '',
  type: 'PAGE',
  description: '',
  path: '/',
  icon: 'LayoutGrid',
  visible: true,
  parentId: '',
  requiredPermissionId: '',
  sort: 0,
};

function depthOf(menu: MenuRow, menus: MenuRow[]): number {
  let depth = 0;
  let parentId = menu.parentId;
  const visited = new Set<string>();
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    depth += 1;
    parentId = menus.find((item) => item.id === parentId)?.parentId ?? null;
  }
  return depth;
}

export default function MenuManager({
  menus,
  apiPermissions,
}: {
  menus: MenuRow[];
  apiPermissions: Array<{ id: string; code: string; name: string }>;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<MenuRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MenuRow | null>(null);
  const [form, setForm] = useState<MenuForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const orderedMenus = useMemo(
    () => [...menus].sort((a, b) => depthOf(a, menus) - depthOf(b, menus) || a.sort - b.sort),
    [menus],
  );

  const openCreate = () => {
    setSelected(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (menu: MenuRow) => {
    setSelected(menu);
    setForm({
      code: menu.code,
      name: menu.name,
      type: menu.type,
      description: menu.description ?? '',
      path: menu.path ?? '',
      icon: menu.icon ?? 'LayoutGrid',
      visible: menu.visible,
      parentId: menu.parentId ?? '',
      requiredPermissionId: menu.requiredPermissionId ?? '',
      sort: menu.sort,
    });
    setDialogOpen(true);
  };

  const actionInput = {
    name: form.name,
    type: form.type,
    description: form.description || null,
    path: form.path || null,
    icon: form.icon || null,
    visible: form.visible,
    parentId: form.parentId || null,
    requiredPermissionId: form.requiredPermissionId || null,
    sort: form.sort,
  };

  const save = async () => {
    setSaving(true);
    try {
      const result = selected
        ? await updateMenuAction(selected.id, actionInput)
        : await createMenuAction({ code: form.code, ...actionInput });
      if (result.success) {
        toast.success(result.message);
        setDialogOpen(false);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '保存菜单失败');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (target: MenuRow) => {
    setSaving(true);
    try {
      const result = await deleteMenuAction(target.id);
      if (result.success) {
        toast.success(result.message);
        setDeleteTarget(null);
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '删除菜单失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader className="flex-row items-center justify-between border-b bg-muted/50">
          <p className="text-sm text-muted-foreground">共 {menus.length} 个菜单节点</p>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1 size-4" /> 新建菜单
          </Button>
        </CardHeader>
        <CardContent className="divide-y p-0">
          {orderedMenus.map((menu) => (
            <div
              key={menu.id}
              className="flex items-center gap-3 px-5 py-3"
              style={{ paddingLeft: `${20 + depthOf(menu, menus) * 24}px` }}
            >
              <Menu className="size-4 shrink-0 text-primary" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold">{menu.name}</span>
                  <Badge variant="outline">{menu.type}</Badge>
                  {!menu.visible && <Badge variant="secondary">已隐藏</Badge>}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {menu.code} · {menu.path || '无跳转路径'}
                </p>
              </div>
              <span className="hidden max-w-64 truncate text-xs text-muted-foreground md:block">
                {apiPermissions.find((permission) => permission.id === menu.requiredPermissionId)?.code
                  ?? '仅需登录'}
              </span>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" aria-label={`打开 ${menu.name} 菜单操作`}>
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => openEdit(menu)}>
                    <Edit className="mr-2 size-4" /> 编辑
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => setDeleteTarget(menu)}
                  >
                    <Trash2 className="mr-2 size-4" /> 删除
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{selected ? '编辑菜单' : '新建菜单'}</DialogTitle>
            <DialogDescription>菜单节点与业务权限显式绑定，菜单编码创建后不可修改。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-2 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="menu-name">名称</Label>
              <Input id="menu-name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="menu-code">菜单编码</Label>
              <Input id="menu-code" value={form.code} disabled={selected !== null} onChange={(event) => setForm({ ...form, code: event.target.value })} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="menu-type">类型</Label>
              <Select value={form.type} onValueChange={(value) => setForm({ ...form, type: value as MenuForm['type'] })}>
                <SelectTrigger id="menu-type"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="DIRECTORY">目录</SelectItem>
                  <SelectItem value="PAGE">页面</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="menu-path">站内路径</Label>
              <Input id="menu-path" value={form.path} onChange={(event) => setForm({ ...form, path: event.target.value })} placeholder="/users" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="menu-icon">图标</Label>
              <Select value={form.icon} onValueChange={(value) => setForm({ ...form, icon: value })}>
                <SelectTrigger id="menu-icon"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MENU_ICON_VALUES.map((icon) => <SelectItem key={icon} value={icon}>{icon}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="menu-parent">父级目录</Label>
              <Select value={form.parentId || '__root__'} onValueChange={(value) => setForm({ ...form, parentId: value === '__root__' ? '' : value })}>
                <SelectTrigger id="menu-parent"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__root__">根级</SelectItem>
                  {menus.filter((menu) => menu.type === 'DIRECTORY' && menu.id !== selected?.id).map((menu) => (
                    <SelectItem key={menu.id} value={menu.id}>{menu.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="menu-required-permission">可见性所需 API 权限</Label>
              <Select value={form.requiredPermissionId || '__authenticated__'} onValueChange={(value) => setForm({ ...form, requiredPermissionId: value === '__authenticated__' ? '' : value })}>
                <SelectTrigger id="menu-required-permission"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__authenticated__">仅需登录</SelectItem>
                  {apiPermissions.map((permission) => (
                    <SelectItem key={permission.id} value={permission.id}>{permission.name}（{permission.code}）</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="menu-sort">排序</Label>
              <Input id="menu-sort" type="number" value={form.sort} onChange={(event) => setForm({ ...form, sort: Number(event.target.value) })} />
            </div>
            <label className="flex items-center gap-2 self-end pb-2 text-sm font-medium">
              <input type="checkbox" checked={form.visible} onChange={(event) => setForm({ ...form, visible: event.target.checked })} />
              在侧边栏显示
            </label>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={() => void save()} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => !open && !saving && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认删除菜单</DialogTitle>
            <DialogDescription>
              将删除“{deleteTarget?.name}”。存在子菜单时服务端会拒绝删除。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={saving}>取消</Button>
            <Button variant="destructive" disabled={saving} onClick={() => deleteTarget && void remove(deleteTarget)}>
              {saving ? '删除中...' : '确认删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

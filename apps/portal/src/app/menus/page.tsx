/**
 * 菜单管理页面 - 完整 CRUD 版
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { 
  Menu as MenuIcon, 
  Plus, 
  ChevronRight, 
  ChevronDown, 
  MoreHorizontal, 
  Edit, 
  Trash2, 
  Eye, 
  EyeOff,
  LayoutGrid,
  ShieldCheck,
  Search,
  Save
} from 'lucide-react';
import * as Icons from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from '@/components/ui/table';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogFooter,
  DialogDescription,
  DialogTrigger
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface MenuItem {
  id: string;
  parentId: string | null;
  name: string;
  path: string;
  permissionCode: string | null;
  icon: string | null;
  visible: boolean;
  sort: number;
  status: 'ACTIVE' | 'DISABLED';
  children?: MenuItem[];
}

const DynamicIcon = ({ name, className }: { name: string | null; className?: string }) => {
  if (!name) return <LayoutGrid className={className} />;
  const IconComponent = (Icons as any)[name] || Icons.HelpCircle;
  return <IconComponent className={className} />;
};

export default function MenusPage() {
  const [menus, setMenus] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');

  // 弹窗状态
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [editingMenu, setEditingMenu] = useState<MenuItem | null>(null);
  const [formMenu, setFormMenu] = useState({ 
    name: '', 
    path: '', 
    permissionCode: '', 
    parentId: null as string | null,
    sort: 0,
    visible: true 
  });

  const fetchMenus = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/menus');
      const data = await response.json();
      if (response.ok) {
        setMenus(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch menus:', error);
      toast.error('获取菜单失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMenus();
  }, [fetchMenus]);

  const handleSaveMenu = async () => {
    if (!formMenu.name) return toast.error('菜单名称不能为空');
    const method = editingMenu ? 'PATCH' : 'POST';
    const url = editingMenu ? `/api/menus/${editingMenu.id}` : '/api/menus';
    
    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formMenu)
      });
      if (response.ok) {
        toast.success(editingMenu ? '更新成功' : '创建成功');
        setIsFormOpen(false);
        fetchMenus();
      }
    } catch (error) {
      toast.error('操作失败');
    }
  };

  const handleDeleteMenu = async () => {
    if (!editingMenu) return;
    try {
      const response = await fetch(`/api/menus/${editingMenu.id}`, { method: 'DELETE' });
      if (response.ok) {
        toast.success('删除成功');
        setIsDeleteOpen(false);
        fetchMenus();
      }
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const openAdd = (parentId: string | null = null) => {
    setEditingMenu(null);
    setFormMenu({ name: '', path: '', permissionCode: '', parentId, sort: 0, visible: true });
    setIsFormOpen(true);
  };

  const openEdit = (m: MenuItem) => {
    setEditingMenu(m);
    setFormMenu({ 
      name: m.name, 
      path: m.path || '', 
      permissionCode: m.permissionCode || '', 
      parentId: m.parentId,
      sort: m.sort,
      visible: m.visible 
    });
    setIsFormOpen(true);
  };

  const openDelete = (m: MenuItem) => {
    setEditingMenu(m);
    setIsDeleteOpen(true);
  };

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const buildTree = (items: MenuItem[], parentId: string | null = null): MenuItem[] => {
    return items
      .filter(item => item.parentId === parentId)
      .map(item => ({
        ...item,
        children: buildTree(items, item.id)
      }))
      .sort((a, b) => a.sort - b.sort);
  };

  const filteredMenus = menus.filter(m => 
    m.name.toLowerCase().includes(keyword.toLowerCase()) || 
    (m.path && m.path.toLowerCase().includes(keyword.toLowerCase()))
  );

  const menuTree = buildTree(filteredMenus);

  const renderRows = (items: MenuItem[], level = 0) => {
    return items.flatMap(item => {
      const isExpanded = expanded.has(item.id);
      const hasChildren = item.children && item.children.length > 0;
      
      const rows = [
        <TableRow key={item.id} className="group hover:bg-slate-50/50 transition-colors">
          <TableCell className="pl-6 py-4">
            <div className="flex items-center gap-2" style={{ marginLeft: `${level * 24}px` }}>
              <div 
                className="w-5 h-5 flex items-center justify-center cursor-pointer hover:bg-slate-100 rounded"
                onClick={() => toggleExpand(item.id)}
              >
                {hasChildren ? (
                  isExpanded ? <ChevronDown className="h-3 w-3 text-slate-400" /> : <ChevronRight className="h-3 w-3 text-slate-400" />
                ) : (
                  <div className="w-1 h-1 rounded-full bg-slate-300 ml-1" />
                )}
              </div>
              <div className="p-1.5 bg-slate-100 rounded-lg">
                <DynamicIcon name={item.icon} className="h-3.5 w-3.5 text-slate-500" />
              </div>
              <span className="font-bold text-sm text-slate-700">{item.name}</span>
            </div>
          </TableCell>
          <TableCell>
            <code className="text-[11px] font-mono text-slate-400">{item.path || '-'}</code>
          </TableCell>
          <TableCell>
            {item.permissionCode ? (
              <Badge variant="outline" className="h-5 px-2 bg-slate-50 text-slate-500 border-slate-200 font-mono text-[10px]">
                {item.permissionCode}
              </Badge>
            ) : (
              <span className="text-[10px] text-slate-300 italic">未绑定</span>
            )}
          </TableCell>
          <TableCell>
            {item.visible ? (
              <Badge variant="success" className="h-5 px-2 gap-1 rounded-md text-[10px]">
                <Eye className="h-3 w-3" /> 显示
              </Badge>
            ) : (
              <Badge variant="secondary" className="h-5 px-2 gap-1 rounded-md bg-slate-100 text-slate-400 border-none text-[10px]">
                <EyeOff className="h-3 w-3" /> 隐藏
              </Badge>
            )}
          </TableCell>
          <TableCell className="text-center font-mono text-xs opacity-50">
            {item.sort}
          </TableCell>
          <TableCell className="text-right pr-8">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-40 rounded-xl p-2 shadow-2xl">
                <DropdownMenuItem onClick={() => openEdit(item)} className="rounded-lg cursor-pointer">
                  <Edit className="h-4 w-4 mr-2 text-blue-500" /> 编辑
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => openAdd(item.id)} className="rounded-lg cursor-pointer">
                  <Plus className="h-4 w-4 mr-2 text-green-500" /> 子菜单
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => openDelete(item)} className="rounded-lg cursor-pointer text-destructive focus:bg-destructive/5 focus:text-destructive">
                   <Trash2 className="h-4 w-4 mr-2" /> 删除
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </TableCell>
        </TableRow>
      ];

      if (hasChildren && isExpanded) {
        rows.push(...renderRows(item.children!, level + 1));
      }

      return rows;
    });
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">菜单管理</h1>
          <p className="text-muted-foreground text-sm font-medium">维护门户侧边栏的树形架构与动态权限绑定。</p>
        </div>
        <Button className="rounded-xl h-11 px-6 shadow-lg shadow-primary/20" onClick={() => openAdd(null)}>
          <Plus className="mr-2 h-4 w-4" /> 新增菜单
        </Button>
      </div>

      {/* 新增/编辑对话框 */}
      <Dialog open={isFormOpen} onOpenChange={setIsFormOpen}>
        <DialogContent className="sm:max-w-[450px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">{editingMenu ? '编辑菜单项' : '新增菜单项'}</DialogTitle>
            <DialogDescription>配置菜单名称、路由路径及关联的权限标识。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="grid grid-cols-2 gap-4">
               <div className="space-y-2">
                 <Label className="font-bold">菜单名称</Label>
                 <Input value={formMenu.name} onChange={e => setFormMenu({...formMenu, name: e.target.value})} />
               </div>
               <div className="space-y-2">
                 <Label className="font-bold">排序权重</Label>
                 <Input type="number" value={formMenu.sort} onChange={e => setFormMenu({...formMenu, sort: parseInt(e.target.value)})} />
               </div>
            </div>
            <div className="space-y-2">
              <Label className="font-bold">路由路径 (Path)</Label>
              <Input placeholder="/dashboard" value={formMenu.path} onChange={e => setFormMenu({...formMenu, path: e.target.value})} />
            </div>
            <div className="space-y-2">
              <Label className="font-bold">权限标识 (Permission Code)</Label>
              <Input placeholder="system:menu:view" value={formMenu.permissionCode} onChange={e => setFormMenu({...formMenu, permissionCode: e.target.value})} />
            </div>
            <div className="flex items-center gap-2">
               <Label className="font-bold">侧边栏显示</Label>
               <Select value={formMenu.visible ? 'YES' : 'NO'} onValueChange={(v) => setFormMenu({...formMenu, visible: v === 'YES'})}>
                 <SelectTrigger className="w-24 rounded-lg"><SelectValue /></SelectTrigger>
                 <SelectContent><SelectItem value="YES">显示</SelectItem><SelectItem value="NO">隐藏</SelectItem></SelectContent>
               </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setIsFormOpen(false)}>取消</Button>
            <Button onClick={handleSaveMenu} className="rounded-xl px-8"><Save className="mr-2 h-4 w-4" /> 保存配置</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除对话框 */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
         <DialogContent className="rounded-[2rem]">
            <DialogHeader>
               <DialogTitle className="text-xl font-black text-red-600">删除菜单项？</DialogTitle>
               <DialogDescription>这将移除 <strong>{editingMenu?.name}</strong> 及其关联子项，且不可恢复。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
               <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>取消</Button>
               <Button onClick={handleDeleteMenu} className="bg-red-600 hover:bg-red-700 rounded-xl px-8">确认删除</Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border shadow-sm">
           <div className="flex items-center gap-3">
              <div className="p-2 bg-primary/10 rounded-xl text-primary">
                <MenuIcon className="h-5 w-5" />
              </div>
              <div className="text-sm font-black text-slate-700 uppercase tracking-widest">Navigation Hierarchy</div>
           </div>
           
           <div className="relative w-full md:w-80">
             <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground opacity-50" />
             <Input 
               placeholder="搜索菜单名称或路径..." 
               className="pl-10 h-10 rounded-xl bg-slate-50/50 border-slate-200 focus:bg-white transition-all"
               value={keyword}
               onChange={e => setKeyword(e.target.value)}
             />
           </div>
        </div>

        <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem]">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-slate-50/30">
                <TableRow>
                  <TableHead className="pl-8">菜单名称</TableHead>
                  <TableHead>路由路径</TableHead>
                  <TableHead>权限标识</TableHead>
                  <TableHead>显示状态</TableHead>
                  <TableHead className="text-center w-[80px]">排序</TableHead>
                  <TableHead className="text-right pr-8">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-8"><Skeleton className="h-10 w-48" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-10 mx-auto" /></TableCell>
                      <TableCell className="text-right pr-8"><Skeleton className="ml-auto h-8 w-8 rounded-md" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredMenus.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-64 text-center">
                      <div className="flex flex-col items-center justify-center space-y-4">
                        <div className="bg-primary/10 p-4 rounded-full">
                          <MenuIcon className="h-8 w-8 text-primary" />
                        </div>
                        <div>
                          <p className="text-base font-bold text-slate-700">{keyword ? '未找到匹配的菜单项' : '尚未配置菜单'}</p>
                          <p className="text-sm text-slate-500 mt-1">{keyword ? '请尝试更换搜索词' : '创建菜单以构建系统导航结构'}</p>
                        </div>
                        {!keyword && (
                          <Button onClick={() => setIsFormOpen(true)} className="rounded-xl px-6 mt-2 shadow-lg shadow-primary/20">
                            <Plus className="mr-2 h-4 w-4" /> 创建第一个菜单
                          </Button>
                        )}                      </div>
                    </TableCell>
                  </TableRow>
                ) : (                  renderRows(menuTree)
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

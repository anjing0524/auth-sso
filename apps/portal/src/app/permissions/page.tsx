/**
 * 权限管理页面
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { 
  ShieldCheck, 
  Plus, 
  Search, 
  MoreHorizontal, 
  Edit, 
  Trash2,
  Database,
  Globe,
  Code,
  Settings2,
  Filter
} from 'lucide-react';

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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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

interface Permission {
  id: string;
  publicId: string;
  name: string;
  code: string;
  type: 'MENU' | 'API' | 'DATA';
  resource: string | null;
  action: string | null;
  status: 'ACTIVE' | 'DISABLED';
  createdAt: string;
}

export default function PermissionsPage() {
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [activeTab, setActiveTab] = useState('ALL');

  // 弹窗状态
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsAddEdit] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selectedPerm, setSelectedPerm] = useState<Permission | null>(null);
  const [formPerm, setFormPerm] = useState<{name: string, code: string, type: 'API' | 'MENU' | 'DATA'}>({ name: '', code: '', type: 'API' });

  const fetchPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/permissions');
      const data = await response.json();
      if (response.ok) {
        setPermissions(data.data || []);
      }
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPermissions();
  }, [fetchPermissions]);

  const handleCreatePerm = async () => {
    if (!formPerm.name || !formPerm.code) return toast.error('请填写完整信息');
    try {
      const response = await fetch('/api/permissions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formPerm)
      });
      if (response.ok) {
        toast.success('权限项创建成功');
        setIsAddOpen(false);
        setFormPerm({ name: '', code: '', type: 'API' });
        fetchPermissions();
      } else {
        const err = await response.json();
        toast.error(err.message || '创建失败');
      }
    } catch (error) {
      toast.error('请求失败');
    }
  };

  const handleUpdatePerm = async () => {
    if (!selectedPerm) return;
    try {
      const response = await fetch(`/api/permissions/${selectedPerm.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formPerm)
      });
      if (response.ok) {
        toast.success('更新成功');
        setIsAddEdit(false);
        fetchPermissions();
      }
    } catch (error) {
      toast.error('更新失败');
    }
  };

  const handleDeletePerm = async () => {
    if (!selectedPerm) return;
    try {
      const response = await fetch(`/api/permissions/${selectedPerm.id}`, { method: 'DELETE' });
      if (response.ok) {
        toast.success('删除成功');
        setIsDeleteOpen(false);
        fetchPermissions();
      }
    } catch (error) {
      toast.error('删除失败');
    }
  };

  const openEdit = (p: Permission) => {
    setSelectedPerm(p);
    setFormPerm({ name: p.name, code: p.code, type: p.type as 'API' | 'MENU' | 'DATA' });
    setIsAddEdit(true);
  };

  const openDelete = (p: Permission) => {
    setSelectedPerm(p);
    setIsDeleteOpen(true);
  };

  const filteredPermissions = permissions.filter(p => {
    const matchesKeyword = p.name.toLowerCase().includes(keyword.toLowerCase()) || 
                          p.code.toLowerCase().includes(keyword.toLowerCase());
    const matchesTab = activeTab === 'ALL' || p.type === activeTab;
    return matchesKeyword && matchesTab;
  });

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'MENU': return <Globe className="h-3.5 w-3.5" />;
      case 'API': return <Code className="h-3.5 w-3.5" />;
      case 'DATA': return <Database className="h-3.5 w-3.5" />;
      default: return <Settings2 className="h-3.5 w-3.5" />;
    }
  };

  const getTypeBadge = (type: string) => {
    switch (type) {
      case 'MENU': return <Badge variant="outline" className="bg-blue-50 text-blue-600 border-blue-100">菜单</Badge>;
      case 'API': return <Badge variant="outline" className="bg-green-50 text-green-600 border-green-100">接口</Badge>;
      case 'DATA': return <Badge variant="outline" className="bg-purple-50 text-purple-600 border-purple-100">数据</Badge>;
      default: return <Badge variant="secondary">{type}</Badge>;
    }
  };

  return (
    <div className="space-y-6 pb-10">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">权限管理</h1>
          <p className="text-muted-foreground text-sm font-medium">维护系统细粒度权限标识，实现功能与数据的精准管控。</p>
        </div>
        <Button className="rounded-xl h-11 px-6 shadow-lg shadow-primary/20" onClick={() => { setFormPerm({name:'', code:'', type:'API'}); setIsAddOpen(true); }}>
          <Plus className="mr-2 h-4 w-4" /> 新增权限
        </Button>
      </div>

      {/* 新增/编辑对话框 */}
      <Dialog open={isAddOpen || isEditOpen} onOpenChange={(v) => { if(!v) { setIsAddOpen(false); setIsAddEdit(false); } }}>
        <DialogContent className="sm:max-w-[425px] rounded-[2rem]">
          <DialogHeader>
            <DialogTitle className="text-2xl font-black">{isEditOpen ? '编辑权限' : '新增权限标识'}</DialogTitle>
            <DialogDescription>定义权限码，用于后端 API 校验或前端功能控制。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-6 py-4">
            <div className="space-y-2">
              <Label className="font-bold">权限名称</Label>
              <Input 
                placeholder="例如：删除用户" 
                value={formPerm.name} 
                onChange={e => setFormPerm({...formPerm, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold">权限类型</Label>
              <Select value={formPerm.type} onValueChange={(v: any) => setFormPerm({...formPerm, type: v})}>
                <SelectTrigger className="rounded-xl h-11">
                  <SelectValue placeholder="选择类型" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="MENU">功能菜单 (MENU)</SelectItem>
                  <SelectItem value="API">接口调用 (API)</SelectItem>
                  <SelectItem value="DATA">数据范围 (DATA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label className="font-bold">权限标识 (Code)</Label>
              <Input 
                placeholder="例如：user:delete" 
                value={formPerm.code}
                onChange={e => setFormPerm({...formPerm, code: e.target.value.toLowerCase()})}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => { setIsAddOpen(false); setIsAddEdit(false); }}>取消</Button>
            <Button onClick={isEditOpen ? handleUpdatePerm : handleCreatePerm} className="rounded-xl px-8">
              {isEditOpen ? '保存修改' : '确认创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认对话框 */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
         <DialogContent className="rounded-[2rem]">
            <DialogHeader>
               <DialogTitle className="text-xl font-black text-red-600">删除权限标识？</DialogTitle>
               <DialogDescription>这将移除 <strong>{selectedPerm?.name}</strong>，且所有依赖此权限的角色将立即失去相关访问能力。</DialogDescription>
            </DialogHeader>
            <DialogFooter>
               <Button variant="ghost" onClick={() => setIsDeleteOpen(false)}>取消</Button>
               <Button onClick={handleDeletePerm} className="bg-red-600 hover:bg-red-700 rounded-xl px-8">确认删除</Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-6">
        <div className="flex flex-col md:flex-row gap-4 items-center justify-between bg-white p-4 rounded-2xl border shadow-sm">
           <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full md:w-auto">
             <TabsList className="bg-slate-100/50 p-1 rounded-xl">
               <TabsTrigger value="ALL" className="rounded-lg px-4">全部</TabsTrigger>
               <TabsTrigger value="MENU" className="rounded-lg px-4">菜单</TabsTrigger>
               <TabsTrigger value="API" className="rounded-lg px-4">API</TabsTrigger>
               <TabsTrigger value="DATA" className="rounded-lg px-4">数据</TabsTrigger>
             </TabsList>
           </Tabs>
           
           <div className="relative w-full md:w-80">
             <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground opacity-50" />
             <Input 
               placeholder="搜索名称或权限标识..." 
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
                  <TableHead className="pl-8">权限名称</TableHead>
                  <TableHead>权限类型</TableHead>
                  <TableHead>权限标识 (Code)</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead className="text-right pr-8">操作</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell className="pl-8"><Skeleton className="h-6 w-32" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                      <TableCell><Skeleton className="h-4 w-40 font-mono" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                      <TableCell className="text-right pr-8"><Skeleton className="ml-auto h-8 w-8 rounded-md" /></TableCell>
                    </TableRow>
                  ))
                ) : filteredPermissions.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-64 text-center text-muted-foreground italic">
                      未找到匹配的权限配置
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredPermissions.map(p => (
                    <TableRow key={p.id} className="group hover:bg-slate-50/50 transition-colors">
                      <TableCell className="pl-8 py-4">
                        <div className="flex items-center gap-3">
                          <div className="p-2 bg-slate-100 rounded-lg text-slate-500 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                            {getTypeIcon(p.type)}
                          </div>
                          <span className="font-bold text-sm text-slate-700">{p.name}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        {getTypeBadge(p.type)}
                      </TableCell>
                      <TableCell>
                        <code className="text-xs bg-slate-50 px-2 py-1 rounded border border-slate-100 font-mono text-slate-500">
                          {p.code}
                        </code>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                           <div className={`h-1.5 w-1.5 rounded-full ${p.status === 'ACTIVE' ? 'bg-green-500' : 'bg-slate-300'}`} />
                           <span className="text-xs font-medium text-slate-600">{p.status === 'ACTIVE' ? '启用' : '禁用'}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-right pr-8">
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity">
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-40 rounded-xl p-2 shadow-2xl">
                            <DropdownMenuItem onClick={() => openEdit(p)} className="rounded-lg cursor-pointer">
                              <Edit className="h-4 w-4 mr-2 text-blue-500" /> 编辑
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => openDelete(p)} className="rounded-lg cursor-pointer text-destructive focus:bg-destructive/5 focus:text-destructive">
                               <Trash2 className="h-4 w-4 mr-2" /> 删除权限
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
        </Card>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
         <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-2xl">
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-bold flex items-center gap-2">
               <Globe className="h-4 w-4 text-blue-500" />
               菜单权限
             </CardTitle>
           </CardHeader>
           <CardContent>
             <p className="text-xs text-muted-foreground leading-relaxed">
               控制侧边栏导航条目的可见性。通常一个菜单对应一个权限标识。
             </p>
           </CardContent>
         </Card>
         <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-2xl">
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-bold flex items-center gap-2">
               <Code className="h-4 w-4 text-green-500" />
               API 权限
             </CardTitle>
           </CardHeader>
           <CardContent>
             <p className="text-xs text-muted-foreground leading-relaxed">
               控制后端接口的访问权限。在后端 Controller 或 Route Handler 中通过权限标识拦截请求。
             </p>
           </CardContent>
         </Card>
         <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-2xl">
           <CardHeader className="pb-2">
             <CardTitle className="text-sm font-bold flex items-center gap-2">
               <Database className="h-4 w-4 text-purple-500" />
               数据权限
             </CardTitle>
           </CardHeader>
           <CardContent>
             <p className="text-xs text-muted-foreground leading-relaxed">
               标识特殊的业务数据范围控制。配合 RBAC 数据沙箱逻辑，实现行级数据过滤。
             </p>
           </CardContent>
         </Card>
      </div>
    </div>
  );
}

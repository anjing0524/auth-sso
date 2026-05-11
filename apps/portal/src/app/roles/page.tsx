/**
 * 角色权限管理页面 - 现代化重构版
 * 基于 shadcn/ui，提供高效的角色定义与权限分配体验
 */
'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { 
  Shield, 
  Plus, 
  Search, 
  MoreHorizontal, 
  Edit, 
  CheckCircle2, 
  Lock, 
  ShieldAlert,
  ChevronRight,
  Database,
  Globe,
  Settings2,
  X,
  User
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
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

interface Role {
  id: string;
  publicId: string;
  name: string;
  code: string;
  dataScopeType: 'ALL' | 'DEPT' | 'DEPT_AND_SUB' | 'SELF' | 'CUSTOM';
  status: 'ACTIVE' | 'DISABLED';
}

interface Pagination {
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface Permission {
  id: string;
  name: string;
  code: string;
  type: 'MENU' | 'API' | 'DATA';
  resource: string | null;
  action: string | null;
  status: 'ACTIVE' | 'DISABLED';
}

interface Client {
  id: string;
  publicId: string;
  name: string;
  clientId: string;
}

const DATA_SCOPE_CONFIG: Record<string, { label: string, color: string }> = {
  ALL: { label: '全量数据', color: 'bg-red-100 text-red-700' },
  DEPT: { label: '本部门', color: 'bg-blue-100 text-blue-700' },
  DEPT_AND_SUB: { label: '部门及子部', color: 'bg-indigo-100 text-indigo-700' },
  SELF: { label: '仅本人', color: 'bg-slate-100 text-slate-700' },
  CUSTOM: { label: '自定义', color: 'bg-orange-100 text-orange-700' },
};

export default function RolesPage() {
  const [roles, setRoles] = useState<Role[]>([]);
  const [pagination, setPagination] = useState<Pagination>({ total: 0, page: 1, pageSize: 10, totalPages: 0 });
  const [permissions, setPermissions] = useState<Permission[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [rolePermissions, setRolePermissions] = useState<Set<string>>(new Set());
  const [roleClients, setRoleClients] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [selectedRole, setSelectedRole] = useState<Role | null>(null);
  const [keyword, setKeyword] = useState('');

  // 新增角色状态 (Drawer/Sheet)
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [newRole, setNewRole] = useState({ name: '', code: '', dataScopeType: 'SELF' as Role['dataScopeType'] });

  const fetchRoles = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const response = await fetch(`/api/roles?page=${page}&pageSize=10${keyword ? `&keyword=${keyword}` : ''}`);
      const data = await response.json();
      if (response.ok) {
        setRoles(data.data);
        setPagination(data.pagination);
        if (data.data.length > 0 && !selectedRole) {
          setSelectedRole(data.data[0]);
          fetchRolePermissions(data.data[0].id);
          fetchRoleClients(data.data[0].id);
        }
      }
    } catch (error) {
      console.error('Failed to fetch roles:', error);
    } finally {
      setLoading(false);
    }
  }, [keyword, selectedRole]);

  const fetchPermissions = useCallback(async () => {
    try {
      const response = await fetch('/api/permissions');
      const data = await response.json();
      if (response.ok) setPermissions(data.data);
    } catch (error) {
      console.error('Failed to fetch permissions:', error);
    }
  }, []);

  const fetchClients = useCallback(async () => {
    try {
      const response = await fetch('/api/clients');
      const data = await response.json();
      if (response.ok) setClients(data.data);
    } catch (error) {
      console.error('Failed to fetch clients:', error);
    }
  }, []);

  const fetchRolePermissions = useCallback(async (roleId: string) => {
    try {
      const response = await fetch(`/api/roles/${roleId}/permissions`);
      const data = await response.json();
      if (response.ok) setRolePermissions(new Set(data.data.map((p: Permission) => p.id)));
    } catch (error) {
      console.error('Failed to fetch role permissions:', error);
    }
  }, []);

  const fetchRoleClients = useCallback(async (roleId: string) => {
    try {
      const response = await fetch(`/api/roles/${roleId}/clients`);
      const data = await response.json();
      if (response.ok) setRoleClients(new Set(data.data.map((c: any) => c.clientId)));
    } catch (error) {
      console.error('Failed to fetch role clients:', error);
    }
  }, []);

  useEffect(() => {
    fetchRoles();
    fetchPermissions();
    fetchClients();
  }, [fetchRoles, fetchPermissions, fetchClients]);

  const handleSelectRole = (role: Role) => {
    setSelectedRole(role);
    fetchRolePermissions(role.id);
    fetchRoleClients(role.id);
  };

  const handleCreateRole = async () => {
    if (!newRole.name || !newRole.code) return toast.error('请填写完整信息');
    try {
      const response = await fetch('/api/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRole)
      });
      if (response.ok) {
        toast.success('角色创建成功');
        setIsSheetOpen(false);
        setNewRole({ name: '', code: '', dataScopeType: 'SELF' });
        fetchRoles(1);
      } else {
        const err = await response.json();
        toast.error(err.message || '创建失败');
      }
    } catch (error) {
      toast.error('网络请求失败');
    }
  };

  const togglePermission = async (permissionId: string) => {
    if (!selectedRole) return;
    const newPermissions = new Set(rolePermissions);
    const isRemoving = newPermissions.has(permissionId);
    if (isRemoving) {
      newPermissions.delete(permissionId);
    } else {
      newPermissions.add(permissionId);
    }
    
    setRolePermissions(newPermissions);
    
    try {
      const response = await fetch(`/api/roles/${selectedRole.id}/permissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissionIds: Array.from(newPermissions) })
      });
      if (!response.ok) throw new Error('Failed to update');
      toast.success(isRemoving ? '权限已移除' : '权限授予成功');
    } catch (error) {
      console.error('Failed to update permissions:', error);
      toast.error('权限更新失败');
      fetchRolePermissions(selectedRole.id);
    }
  };

  const toggleClient = async (clientId: string) => {
    if (!selectedRole) return;
    const newClients = new Set(roleClients);
    const isRemoving = newClients.has(clientId);
    if (isRemoving) {
      newClients.delete(clientId);
    } else {
      newClients.add(clientId);
    }
    
    setRoleClients(newClients);
    
    try {
      const response = await fetch(`/api/roles/${selectedRole.id}/clients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientIds: Array.from(newClients) })
      });
      if (!response.ok) throw new Error('Failed to update');
      toast.success(isRemoving ? '应用访问已取消' : '应用授权成功');
    } catch (error) {
      console.error('Failed to update clients:', error);
      toast.error('应用授权更新失败');
      fetchRoleClients(selectedRole.id);
    }
  };

  const permissionsByType = permissions.reduce((acc, p) => {
    if (!acc[p.type]) acc[p.type] = [];
    acc[p.type].push(p);
    return acc;
  }, {} as Record<string, Permission[]>);

  return (
    <div className="h-full flex flex-col gap-6 pb-10">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">角色权限</h1>
          <p className="text-muted-foreground text-sm font-medium">定义访问策略、分配功能权限及数据查询范围。</p>
        </div>
        <Button className="rounded-xl h-11 px-6 shadow-lg shadow-primary/20" onClick={() => setIsSheetOpen(true)}>
          <Plus className="mr-2 h-4 w-4" /> 新建角色
        </Button>
      </div>

      {/* 新建角色抽屉 (Sheet) */}
      <Sheet open={isSheetOpen} onOpenChange={setIsSheetOpen}>
        <SheetContent className="sm:max-w-[450px]">
          <SheetHeader className="pb-6 border-b">
            <SheetTitle className="text-2xl font-black">新建系统角色</SheetTitle>
            <SheetDescription>定义新的安全角色及其默认数据访问范围。</SheetDescription>
          </SheetHeader>
          <div className="grid gap-6 py-8">
            <div className="space-y-2">
              <Label className="font-bold text-slate-700">角色名称</Label>
              <Input 
                className="h-11 rounded-xl"
                placeholder="例如：运营专员" 
                value={newRole.name} 
                onChange={e => setNewRole({...newRole, name: e.target.value})}
              />
            </div>
            <div className="space-y-2">
              <Label className="font-bold text-slate-700">角色编码 (唯一标识)</Label>
              <Input 
                className="h-11 rounded-xl font-mono"
                placeholder="例如：OPERATOR" 
                value={newRole.code}
                onChange={e => setNewRole({...newRole, code: e.target.value.toUpperCase()})}
              />
              <p className="text-[11px] text-muted-foreground italic px-1">通常使用大写字母和下划线，如: ADMIN_VIEWER</p>
            </div>
            <div className="space-y-4 pt-2">
              <div className="flex items-center justify-between">
                <Label className="font-bold text-slate-700">默认数据范围</Label>
                <Badge variant="secondary" className="text-[10px] uppercase tracking-tighter">Required</Badge>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {['ALL', 'DEPT', 'DEPT_AND_SUB', 'SELF'].map((type) => (
                  <div 
                    key={type}
                    onClick={() => setNewRole({...newRole, dataScopeType: type as any})}
                    className={`p-3 rounded-xl border-2 cursor-pointer transition-all ${
                      newRole.dataScopeType === type 
                        ? 'border-primary bg-primary/5 ring-4 ring-primary/5' 
                        : 'border-slate-100 hover:border-slate-200 bg-slate-50/50'
                    }`}
                  >
                    <div className="font-bold text-xs mb-1">
                      {type === 'ALL' ? '全量数据' : type === 'DEPT' ? '本部门' : type === 'DEPT_AND_SUB' ? '本部门及子部' : '仅本人'}
                    </div>
                    <div className="text-[10px] text-muted-foreground leading-tight">
                      {type === 'ALL' ? '无限制访问' : type === 'DEPT' ? '限制同级部门' : type === 'DEPT_AND_SUB' ? '向下穿透' : '极高隐私'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <SheetFooter className="absolute bottom-0 left-0 right-0 p-6 border-t bg-slate-50/50">
            <Button variant="ghost" className="flex-1 rounded-xl" onClick={() => setIsSheetOpen(false)}>取消</Button>
            <Button onClick={handleCreateRole} className="flex-1 rounded-xl shadow-lg shadow-primary/20">确认创建</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      <div className="flex-1 grid grid-cols-12 gap-8 min-h-0">
        {/* 左侧角色列表 */}
        <div className="col-span-4 flex flex-col gap-4">
          <div className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground opacity-50" />
            <Input
              placeholder="搜索角色名称或编码..."
              className="pl-10 pr-10 h-11 rounded-xl bg-white border-slate-200 focus:ring-2 focus:ring-primary/10 transition-all"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
          </div>          
          <Card className="flex-1 border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem] flex flex-col">
            <CardContent className="p-2 space-y-1 overflow-auto flex-1">
              {loading && roles.length === 0 ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className="p-4 flex gap-4 items-center opacity-40">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <div className="flex-1 space-y-2">
                      <Skeleton className="h-4 w-24" />
                      <Skeleton className="h-3 w-16" />
                    </div>
                  </div>
                ))
              ) : roles.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center py-20 opacity-40">
                  <ShieldAlert className="h-12 w-12 text-slate-300 mb-4" />
                  <p className="text-sm font-bold text-slate-500">未找到任何角色</p>
                </div>
              ) : (
                roles.map((role) => (
                  <div 
                    key={role.id}
                    onClick={() => handleSelectRole(role)}
                    className={`group relative flex items-center gap-4 p-4 rounded-2xl cursor-pointer transition-all duration-300 ${
                      selectedRole?.id === role.id 
                        ? 'bg-primary text-primary-foreground shadow-xl shadow-primary/20 scale-[1.02] z-10' 
                        : 'hover:bg-slate-50 text-slate-600'
                    }`}
                  >
                    <div className={`h-11 w-11 rounded-xl flex items-center justify-center transition-colors ${
                      selectedRole?.id === role.id ? 'bg-white/20' : 'bg-slate-100 group-hover:bg-white'
                    }`}>
                      <Shield className={`h-5 w-5 ${selectedRole?.id === role.id ? 'text-white' : 'text-slate-400'}`} />
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-sm">{role.name}</span>
                        <ChevronRight className={`h-4 w-4 transition-transform ${
                          selectedRole?.id === role.id ? 'translate-x-0' : '-translate-x-2 opacity-0 group-hover:opacity-100 group-hover:translate-x-0'
                        }`} />
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <code className={`text-[10px] font-mono font-medium px-1.5 py-0.5 rounded ${
                          selectedRole?.id === role.id ? 'bg-white/10 text-white/80' : 'bg-slate-200 text-slate-500'
                        }`}>{role.code}</code>
                        <Badge className={`text-[9px] h-4 rounded-md font-black ${
                          selectedRole?.id === role.id 
                            ? 'bg-white text-primary border-none' 
                            : DATA_SCOPE_CONFIG[role.dataScopeType]?.color || 'bg-slate-100 text-slate-600'
                        }`}>
                          {DATA_SCOPE_CONFIG[role.dataScopeType]?.label || role.dataScopeType}
                        </Badge>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
            {/* 分页控制器 */}
            <div className="p-3 border-t bg-slate-50/50 flex items-center justify-between">
               <span className="text-[10px] font-bold text-slate-400">TOTAL {pagination.total}</span>
               <div className="flex gap-1">
                 <Button 
                   variant="outline" 
                   size="icon" 
                   className="h-7 w-7 rounded-lg" 
                   disabled={pagination.page <= 1}
                   onClick={() => fetchRoles(pagination.page - 1)}
                 >
                   <ChevronRight className="h-3 w-3 rotate-180" />
                 </Button>
                 <div className="h-7 px-2 flex items-center bg-white border rounded-lg text-[10px] font-black">
                   {pagination.page} / {pagination.totalPages || 1}
                 </div>
                 <Button 
                   variant="outline" 
                   size="icon" 
                   className="h-7 w-7 rounded-lg"
                   disabled={pagination.page >= pagination.totalPages}
                   onClick={() => fetchRoles(pagination.page + 1)}
                 >
                   <ChevronRight className="h-3 w-3" />
                 </Button>
               </div>
            </div>
          </Card>
        </div>

        {/* 右侧权限详情 */}
        <div className="col-span-8 h-full min-h-0 flex flex-col gap-4">
          {selectedRole ? (
            <Card className="flex-1 border-none shadow-xl ring-1 ring-border/50 rounded-[2rem] overflow-hidden flex flex-col bg-white">
              <CardHeader className="border-b bg-slate-50/50 pb-6 flex flex-row items-center justify-between">
                <div>
                  <CardTitle className="text-xl font-black tracking-tight text-slate-800 flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-primary animate-pulse" />
                    权限资源映射: <span className="text-primary">{selectedRole.name}</span>
                  </CardTitle>
                  <CardDescription className="font-medium mt-1">控制该角色可访问的功能模块、API 接口及受信任的业务子系统。</CardDescription>
                </div>
                <div className="flex gap-2">
                  <Badge variant="outline" className="rounded-md font-mono text-[10px]">{rolePermissions.size} 个已激活</Badge>
                </div>
              </CardHeader>
              <CardContent className="p-0 flex-1 overflow-auto max-h-[600px]">
                 <div className="h-full">
                   <Table>
                     <TableHeader className="bg-slate-50/50 sticky top-0 z-10">
                       <TableRow>
                         <TableHead className="pl-6 w-[200px]">权限名称</TableHead>
                         <TableHead>类型</TableHead>
                         <TableHead>资源标识</TableHead>
                         <TableHead className="text-right pr-6">授权状态</TableHead>
                       </TableRow>
                     </TableHeader>
                      <TableBody>
                        {Object.keys(permissionsByType).length === 0 && clients.length === 0 ? (
                          <TableRow>
                            <TableCell colSpan={4} className="h-40 text-center opacity-40">
                              <Settings2 className="h-8 w-8 mx-auto mb-2 text-slate-300" />
                              <p className="text-xs font-bold text-slate-500">暂无可选权限或应用资源</p>
                            </TableCell>
                          </TableRow>
                        ) : (
                          <>
                            {Object.entries(permissionsByType).map(([type, perms]) => (
                              <React.Fragment key={type}>
                                <TableRow className="bg-slate-100/30 hover:bg-slate-100/30 border-none">
                                  <TableCell colSpan={4} className="py-2 pl-6">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                      {type === 'MENU' ? '功能菜单' : type === 'API' ? '接口调用' : '数据沙箱'}
                                    </span>
                                  </TableCell>
                                </TableRow>
                                {perms.map(p => (
                                  <TableRow key={p.id} className="group hover:bg-slate-50/80 transition-colors">
                                    <TableCell className="pl-6 font-semibold text-sm">{p.name}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2 opacity-60">
                                         {type === 'MENU' ? <Globe className="h-3 w-3" /> : <Database className="h-3 w-3" />}
                                         <span className="text-xs">{p.type}</span>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 font-mono">
                                        {p.code}
                                      </code>
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                      <Button 
                                        variant={rolePermissions.has(p.id) ? 'success' : 'outline'} 
                                        size="sm"
                                        className={`h-7 w-20 text-[10px] font-bold rounded-lg transition-all ${rolePermissions.has(p.id) ? 'shadow-lg shadow-green-500/10' : 'opacity-40 hover:opacity-100'}`}
                                        onClick={() => togglePermission(p.id)}
                                      >
                                        {rolePermissions.has(p.id) ? '已授予' : '未授权'}
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </React.Fragment>
                            ))}

                            {/* 应用授权 */}
                            {clients.length > 0 && (
                              <>
                                <TableRow className="bg-slate-100/30 hover:bg-slate-100/30 border-none">
                                  <TableCell colSpan={4} className="py-2 pl-6">
                                    <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
                                      受信任应用 (客户端)
                                    </span>
                                  </TableCell>
                                </TableRow>
                                {clients.map(c => (
                                  <TableRow key={c.id} className="group hover:bg-slate-50/80 transition-colors">
                                    <TableCell className="pl-6 font-semibold text-sm">{c.name}</TableCell>
                                    <TableCell>
                                      <div className="flex items-center gap-2 opacity-60">
                                         <Shield className="h-3 w-3" />
                                         <span className="text-xs">CLIENT</span>
                                      </div>
                                    </TableCell>
                                    <TableCell>
                                      <code className="text-[10px] bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-slate-500 font-mono">
                                        {c.clientId}
                                      </code>
                                    </TableCell>
                                    <TableCell className="text-right pr-6">
                                      <Button 
                                        variant={roleClients.has(c.clientId) ? 'success' : 'outline'} 
                                        size="sm"
                                        className={`h-7 w-20 text-[10px] font-bold rounded-lg transition-all ${roleClients.has(c.clientId) ? 'shadow-lg shadow-green-500/10' : 'opacity-40 hover:opacity-100'}`}
                                        onClick={() => toggleClient(c.clientId)}
                                      >
                                        {roleClients.has(c.clientId) ? '可访问' : '无权访问'}
                                      </Button>
                                    </TableCell>
                                  </TableRow>
                                ))}
                              </>
                            )}
                          </>
                        )}
                      </TableBody>
                   </Table>
                 </div>
              </CardContent>
            </Card>
          ) : (
            <div className="flex-1 flex items-center justify-center border-2 border-dashed border-slate-200 rounded-[2rem] bg-slate-50/50">
              <div className="text-center space-y-4 opacity-40">
                <div className="mx-auto h-20 w-20 rounded-full bg-slate-200 flex items-center justify-center">
                  <Lock className="h-8 w-8 text-slate-400" />
                </div>
                <p className="text-sm font-bold text-slate-500">选择一个角色来管理其权限资源</p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

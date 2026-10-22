'use client';

/**
 * 权限列表交互组件 — Tab 过滤、搜索、增删改弹窗
 * 写操作通过 Server Actions 直调
 */
import React, { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  ShieldCheck, Plus, Edit, Trash2, Globe, Code, Folder,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  TableCell, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { ICON_MAP } from '@/lib/icon-map';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { enableStatus } from '@/lib/status-label';
import { createPermissionAction, updatePermissionAction, deletePermissionAction } from '../actions';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { FieldError } from '@/components/shared/field-error';

import { SearchInput } from '@/components/shared/search-input';
import { TableToolbar } from '@/components/shared/table-toolbar';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { PERMISSION_PERMISSIONS } from '@auth-sso/contracts';
interface PermissionRow {
  id: string;
  name: string;
  code: string;
  type: string;
  status: string;
  description?: string | null;
  /** DIRECTORY/PAGE 专属 */
  path?: string | null;
  icon?: string | null;
  visible?: boolean | null;
  parentId?: string | null;
  sort?: number;
  createdAt: string;
  /** API 权限的归属应用（client 准入绑定；菜单权限恒为 null） */
  clientId?: string | null;
}

interface Props {
  /** 当前页数据（服务端分页/过滤） */
  permissions: PermissionRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  /** 父级菜单候选（DIRECTORY/PAGE），用于“新建菜单项”时选择父级 */
  menuOptions?: PermissionRow[];
  activeTab: string;
  /** URL 同步的搜索关键词初始值 */
  initialKeyword?: string;
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  DIRECTORY: <Folder className="h-3 w-3 text-info" />,
  PAGE: <Globe className="h-3 w-3 text-primary" />,
  API: <Code className="h-3 w-3 text-success" />,
};

const TYPE_LABELS: Record<string, string> = {
  API: '接口',
  PAGE: '页面',
  DIRECTORY: '目录',
};

const TABS: Array<{ value: string; label: string }> = [
  { value: 'ALL', label: '全部' },
  { value: 'DIRECTORY', label: '目录' },
  { value: 'PAGE', label: '页面' },
  { value: 'API', label: '接口' },
];

export default function PermissionsTable({ permissions, pagination, activeTab, initialKeyword = '', menuOptions = [] }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();

  /** 统一构造 URL：type / keyword / page 都是服务端查询参数（可分享、可后退） */
  const buildHref = (nextPage: number, nextKeyword = keyword, nextType = activeTab) => {
    const params = new URLSearchParams();
    if (nextType !== 'ALL') params.set('type', nextType);
    if (nextKeyword) params.set('keyword', nextKeyword);
    if (nextPage > 1) params.set('page', String(nextPage));
    const qs = params.toString();
    return `/permissions${qs ? `?${qs}` : ''}`;
  };

  // 搜索防抖：400ms 后按服务端查询刷新（与 UserFilters 同语义）
  useEffect(() => {
    if (keyword === initialKeyword) return;
    const timer = setTimeout(() => {
      startTransition(() => router.push(buildHref(1, keyword)));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅关键词变化时防抖；URL 由 buildHref 现算
  }, [keyword]);

  // 弹窗
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<PermissionRow | null>(null);
  /** 删除影响面（打开确认弹窗时按需读取，不缓存） */
  const [deleteImpact, setDeleteImpact] = useState<{ descendants: number; roles: number; users: number } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    code: '',
    type: 'API' as string,
    description: '',
    path: '',
    icon: '',
    visible: true,
    parentId: '' as string,
    sort: 0,
  });
  const emptyForm = { name: '', code: '', type: 'API' as string, description: '', path: '', icon: '', visible: true, parentId: '', sort: 0 };
  const isMenu = form.type !== 'API';
  /** 具体错误码（如 PERMISSION_ALREADY_EXISTS）落到对应输入框（#92） */
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['code']);

  const handleTabChange = (tab: string) => {
    startTransition(() => router.push(buildHref(1, keyword, tab)));
  };

  const handleSearch = (value: string) => {
    setKeyword(value);
  };

  const openEdit = (p: PermissionRow) => {
    setSelected(p);
    setForm({
      name: p.name,
      code: p.code,
      type: p.type,
      description: p.description ?? '',
      path: p.path ?? '',
      icon: p.icon ?? '',
      visible: p.visible ?? true,
      parentId: p.parentId ?? '',
      sort: p.sort ?? 0,
    });
    setIsEditOpen(true);
  };

  /** 菜单类型（DIRECTORY/PAGE）需要树/路由/图标/排序/显隐；API 只需名称+编码 */
  const menuPayload = () => ({
    path: form.path || undefined,
    icon: form.icon || undefined,
    visible: form.visible,
    parentId: form.parentId || null,
    sort: Number(form.sort) || 0,
  });

  const handleCreate = async () => {
    if (!form.name || !form.code) { toast.error('请填写完整信息'); return; }
    if (form.type === 'PAGE' && !form.path.trim()) { toast.error('页面类型必须填写路由路径'); return; }
    clearFailure();
    setSaving(true);
    const r = await createPermissionAction(
      form.type === 'API'
        ? { name: form.name, code: form.code, type: 'API', description: form.description || undefined }
        : { name: form.name, code: form.code, type: form.type as 'DIRECTORY' | 'PAGE', description: form.description || undefined, ...menuPayload() },
    );
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsAddOpen(false); setForm(emptyForm); router.refresh(); }
    else { reportFailure(r); }
  };

  const handleUpdate = async () => {
    if (!selected) return;
    clearFailure();
    setSaving(true);
    const r = await updatePermissionAction(
      selected.id,
      form.type === 'API'
        ? { name: form.name, code: form.code, type: 'API', description: form.description || null }
        : { name: form.name, code: form.code, type: form.type, description: form.description || null, ...menuPayload() },
    );
    setSaving(false);
    if (r.success) { toast.success(r.message); setIsEditOpen(false); router.refresh(); }
    else { reportFailure(r); }
  };

  const openDeleteDialog = (p: PermissionRow) => {
    setSelected(p);
    setIsDeleteOpen(true);
    setDeleteImpact(null);
    setImpactLoading(true);
    void fetch(`/api/permissions/${p.id}/impact`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && typeof data.roles === 'number') setDeleteImpact(data);
      })
      .catch(() => { /* 影响面只是辅助信息，失败不阻断删除 */ })
      .finally(() => setImpactLoading(false));
  };

  const handleDelete = async () => {
    if (!selected) return;
    const r = await deletePermissionAction(selected.id);
    if (r.success) { toast.success(r.message); setIsDeleteOpen(false); router.refresh(); }
    else { reportFailure(r); }
  };

  const columns = [
    { key: 'name', header: '名称 / 菜单' },
    { key: 'code', header: '权限编码' },
    { key: 'type', header: '类型' },
    { key: 'status', header: '状态' },
    { key: 'actions', header: '操作', className: 'text-right' },
  ];

  const cardHeader = (
    <TableToolbar
      left={<SearchInput placeholder="搜索权限名称或编码..." value={keyword} onChange={handleSearch} />}
      right={
        <PermissionGuard permission={PERMISSION_PERMISSIONS.CREATE}>
          <Button onClick={() => { setForm(emptyForm); setIsAddOpen(true); }}>
            <Plus className="h-4 w-4" /> 新建权限 / 菜单
          </Button>
        </PermissionGuard>
      }
    />
  );

  /** 类型筛选独立成行（与审计日志页签同形态，不再挤在工具条里） */
  const tabsBar = (
    <Tabs value={activeTab} onValueChange={handleTabChange} className="w-fit">
      <TabsList>
        {TABS.map((tab) => (
          <TabsTrigger key={tab.value} value={tab.value}>{tab.label}</TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  const renderRow = (p: PermissionRow) => (
    <TableRow key={p.id} className="hover:bg-muted/50">
      <TableCell className="font-medium">
        <span className="block max-w-[240px] truncate" title={p.name}>{p.name}</span>
        {p.type !== 'API' && (
          <span
            className="block max-w-[240px] truncate text-xs font-normal text-muted-foreground"
            title={`${p.path ?? '未设置路径'}${p.parentId ? ` · 父级 ${menuOptions.find((m) => m.id === p.parentId)?.name ?? '—'}` : ' · 顶层'}`}
          >
            {p.path ?? '未设置路径'}
            {p.parentId ? ` · 父级 ${menuOptions.find((m) => m.id === p.parentId)?.name ?? '—'}` : ' · 顶层'}
          </span>
        )}
      </TableCell>
      <TableCell>
        <code className="rounded-md bg-muted px-2 py-0.5 text-xs">{p.code}</code>
        {p.type === 'API' && (
          <span className="ml-2 text-[11px] text-muted-foreground" title="归属应用（决定角色能否通过该 Client 的 OAuth 准入）">
            归属应用：{p.clientId ?? '未绑定'}
          </span>
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline" className="gap-1">
          {TYPE_ICONS[p.type] || null} {TYPE_LABELS[p.type] ?? p.type}
        </Badge>
      </TableCell>
      <TableCell>
        <Badge variant={enableStatus(p.status).variant}>{enableStatus(p.status).label}</Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          <PermissionGuard permission={PERMISSION_PERMISSIONS.UPDATE}>
            <Button variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label="编辑" title="编辑" onClick={() => openEdit(p)}>
              <Edit className="h-4 w-4" /><span>编辑</span>
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={PERMISSION_PERMISSIONS.DELETE}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="删除"
              title="删除"
              className="h-8 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => openDeleteDialog(p)}
            >
              <Trash2 className="h-4 w-4" /><span>删除</span>
            </Button>
          </PermissionGuard>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <div className="shrink-0">{tabsBar}</div>
      <div className="flex min-h-0 flex-1 flex-col">
      <DataTable
        fill
        columns={columns}
        data={permissions}
        loading={isPending}
        emptyState={
          <EmptyState
            variant="simple"
            icon="ShieldCheck"
            title="暂无权限"
            description="新增权限点以控制功能访问"
            action={{ label: '新建权限/菜单', onClick: () => { setForm(emptyForm); setIsAddOpen(true); } }}
          />
        }
        renderRow={renderRow}
        cardHeader={cardHeader}
      />

      <TablePagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPageChange={(next) => startTransition(() => router.push(buildHref(next)))}
      />
      </div>

      {/* 新增对话框 */}
      <Dialog open={isAddOpen} onOpenChange={setIsAddOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-primary" /> {form.type === 'API' ? '新建接口权限' : '新建菜单项'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>权限名称</Label><Input value={form.name} maxLength={100} onChange={e => setForm({...form, name: e.target.value})} placeholder="用户列表" /></div>
            <div className="space-y-2"><Label>描述（可选）</Label><Input value={form.description} maxLength={500} onChange={e => setForm({...form, description: e.target.value})} placeholder="用于说明该权限/菜单的用途" /></div>
            <div className="space-y-2"><Label>权限编码</Label><Input value={form.code} maxLength={150} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} placeholder="user:list" /></div>
            <FieldError failure={fieldError} field="code" />
            {isMenu && (
              <>
                <div className="space-y-2">
                  <Label>父级菜单</Label>
                  <Select value={form.parentId || 'ROOT'} onValueChange={(v) => setForm({ ...form, parentId: v === 'ROOT' ? '' : v })}>
                    <SelectTrigger aria-label="父级菜单"><SelectValue>{menuOptions.find((m) => m.id === form.parentId)?.name ?? '顶层菜单'}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ROOT">顶层菜单</SelectItem>
                      {menuOptions.filter((m) => m.id !== selected?.id).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}{m.type === 'DIRECTORY' ? '（目录）' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>路由路径{form.type === 'PAGE' ? '（必填）' : '（可选）'}</Label>
                  <Input value={form.path} maxLength={200} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/users" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>图标</Label>
                    <Select value={form.icon || 'LayoutGrid'} onValueChange={(v) => setForm({ ...form, icon: v })}>
                      <SelectTrigger aria-label="菜单图标"><SelectValue>{form.icon || 'LayoutGrid'}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {Object.keys(ICON_MAP).map((name) => (<SelectItem key={name} value={name}>{name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>排序</Label>
                    <Input type="number" value={form.sort} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v === true })} />
                  在侧边栏显示
                </label>
              </>
            )}
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                <SelectTrigger aria-label="权限类型"><SelectValue>{TYPE_LABELS[form.type] ?? form.type}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">接口（API）</SelectItem>
                  <SelectItem value="PAGE">页面（PAGE）</SelectItem>
                  <SelectItem value="DIRECTORY">目录（DIRECTORY）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsAddOpen(false)}>取消</Button>
            <Button onClick={handleCreate} disabled={saving}>{saving ? '创建中...' : '创建'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 编辑对话框 */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{form.type === 'API' ? '编辑接口权限' : '编辑菜单项'}</DialogTitle></DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2"><Label>权限名称</Label><Input value={form.name} onChange={e => setForm({...form, name: e.target.value})} /></div>
            <div className="space-y-2"><Label>权限编码</Label><Input value={form.code} aria-invalid={fieldError?.field === 'code'} onChange={e => setForm({...form, code: e.target.value})} /></div>
            <FieldError failure={fieldError} field="code" />
            {isMenu && (
              <>
                <div className="space-y-2">
                  <Label>父级菜单</Label>
                  <Select value={form.parentId || 'ROOT'} onValueChange={(v) => setForm({ ...form, parentId: v === 'ROOT' ? '' : v })}>
                    <SelectTrigger aria-label="父级菜单"><SelectValue>{menuOptions.find((m) => m.id === form.parentId)?.name ?? '顶层菜单'}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ROOT">顶层菜单</SelectItem>
                      {menuOptions.filter((m) => m.id !== selected?.id).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}{m.type === 'DIRECTORY' ? '（目录）' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>路由路径{form.type === 'PAGE' ? '（必填）' : '（可选）'}</Label>
                  <Input value={form.path} maxLength={200} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/users" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>图标</Label>
                    <Select value={form.icon || 'LayoutGrid'} onValueChange={(v) => setForm({ ...form, icon: v })}>
                      <SelectTrigger aria-label="菜单图标"><SelectValue>{form.icon || 'LayoutGrid'}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {Object.keys(ICON_MAP).map((name) => (<SelectItem key={name} value={name}>{name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>排序</Label>
                    <Input type="number" value={form.sort} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v === true })} />
                  在侧边栏显示
                </label>
              </>
            )}
            <div className="space-y-2">
              <Label>类型</Label>
              <Select value={form.type} onValueChange={v => setForm({...form, type: v})}>
                <SelectTrigger aria-label="权限类型"><SelectValue>{TYPE_LABELS[form.type] ?? form.type}</SelectValue></SelectTrigger>
                <SelectContent>
                  <SelectItem value="API">接口（API）</SelectItem>
                  <SelectItem value="PAGE">页面（PAGE）</SelectItem>
                  <SelectItem value="DIRECTORY">目录（DIRECTORY）</SelectItem>
                </SelectContent>
              </Select>
            {isMenu && (
              <>
                <div className="space-y-2">
                  <Label>父级菜单</Label>
                  <Select value={form.parentId || 'ROOT'} onValueChange={(v) => setForm({ ...form, parentId: v === 'ROOT' ? '' : v })}>
                    <SelectTrigger aria-label="父级菜单"><SelectValue>{menuOptions.find((m) => m.id === form.parentId)?.name ?? '顶层菜单'}</SelectValue></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ROOT">顶层菜单</SelectItem>
                      {menuOptions.filter((m) => m.id !== selected?.id).map((m) => (
                        <SelectItem key={m.id} value={m.id}>{m.name}{m.type === 'DIRECTORY' ? '（目录）' : ''}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>路由路径{form.type === 'PAGE' ? '（必填）' : '（可选）'}</Label>
                  <Input value={form.path} maxLength={200} onChange={e => setForm({ ...form, path: e.target.value })} placeholder="/users" />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>图标</Label>
                    <Select value={form.icon || 'LayoutGrid'} onValueChange={(v) => setForm({ ...form, icon: v })}>
                      <SelectTrigger aria-label="菜单图标"><SelectValue>{form.icon || 'LayoutGrid'}</SelectValue></SelectTrigger>
                      <SelectContent>
                        {Object.keys(ICON_MAP).map((name) => (<SelectItem key={name} value={name}>{name}</SelectItem>))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>排序</Label>
                    <Input type="number" value={form.sort} onChange={e => setForm({ ...form, sort: Number(e.target.value) })} />
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={form.visible} onCheckedChange={(v) => setForm({ ...form, visible: v === true })} />
                  在侧边栏显示
                </label>
              </>
            )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsEditOpen(false)}>取消</Button>
            <Button onClick={handleUpdate} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 删除确认 */}
      <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>确认删除</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            确认删除 &quot;{selected?.name}&quot;？关联角色的绑定将同步清除
            {selected?.type !== 'API' ? '；删除目录/页面会级联删除其子菜单' : ''}。
          </p>
          {impactLoading ? (
            <p className="text-xs text-muted-foreground">正在统计影响面…</p>
          ) : deleteImpact ? (
            <div className="rounded-lg border border-destructive/20 bg-destructive/5 px-3 py-2 text-xs text-destructive">
              影响面：{deleteImpact.roles} 个角色、{deleteImpact.users} 个用户
              {deleteImpact.descendants > 0 ? `，并级联删除 ${deleteImpact.descendants} 个子菜单` : ''}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsDeleteOpen(false)}>取消</Button>
            <Button variant="destructive" onClick={handleDelete}>确认删除</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

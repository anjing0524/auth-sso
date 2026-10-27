'use client';

/**
 * 权限列表交互组件 — Tab 过滤、搜索、增删改弹窗
 * 写操作通过 Server Actions 直调
 */
import React, { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Plus, Edit, Trash2, Globe, Code, Folder,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  TableCell, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { enableStatus } from '@/lib/status-label';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { deletePermissionAction } from '../actions';
import { bulkDeletePermissionsAction } from '../bulk-actions';

import { SearchInput } from '@/components/shared/search-input';
import { TableToolbar } from '@/components/shared/table-toolbar';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { ALL_PERMISSIONS, PERMISSION_PERMISSIONS } from '@auth-sso/contracts';
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
  /** 状态筛选：'' | ACTIVE | DISABLED */
  initialStatus?: string;
  /** 归属应用筛选：'' | NONE | clientId */
  initialClientId?: string;
  clients?: Array<{ id: string; name: string }>;
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

export default function PermissionsTable({ permissions, pagination, activeTab, initialKeyword = '', initialStatus = '', initialClientId = '', clients = [], menuOptions = [] }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [isPending, startTransition] = useTransition();

  /** 统一构造 URL：type / keyword / page 都是服务端查询参数（可分享、可后退） */
  const buildHref = (
    nextPage: number,
    nextKeyword = keyword,
    nextType = activeTab,
    nextStatus = initialStatus,
    nextClientId = initialClientId,
  ) => {
    const params = new URLSearchParams();
    if (nextType !== 'ALL') params.set('type', nextType);
    if (nextKeyword) params.set('keyword', nextKeyword);
    if (nextStatus) params.set('status', nextStatus);
    if (nextClientId) params.set('clientId', nextClientId);
    if (nextPage > 1) params.set('page', String(nextPage));
    const qs = params.toString();
    return `/permissions${qs ? `?${qs}` : ''}`;
  };

  const returnTo = buildHref(pagination.page, keyword, activeTab, initialStatus, initialClientId);
  const createReturnTo = buildHref(1, keyword, activeTab, initialStatus, initialClientId);

  // 搜索防抖：400ms 后按服务端查询刷新（与 UserFilters 同语义）
  useEffect(() => {
    if (keyword === initialKeyword) return;
    const timer = setTimeout(() => {
      startTransition(() => router.push(buildHref(1, keyword)));
    }, 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅关键词变化时防抖；URL 由 buildHref 现算
  }, [keyword]);

  // 删除确认（新建/编辑已页面化：弹窗不允许滚动）
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<PermissionRow | null>(null);
  // 批量删除：只删除当前页可见选中项，避免跨页误删
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulking, setBulking] = useState(false);
  const visibleChecked = permissions.filter((p) => checkedIds.has(p.id));
  const isBuiltinPermission = (code: string) => (ALL_PERMISSIONS as readonly string[]).includes(code);
  const deletablePermissions = permissions.filter((p) => !isBuiltinPermission(p.code));
  /** 删除影响面（打开确认弹窗时按需读取，不缓存） */
  const [deleteImpact, setDeleteImpact] = useState<{ descendants: number; roles: number; users: number } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const { reportFailure } = useFieldFailure();
  const handleTabChange = (tab: string) => {
    startTransition(() => router.push(buildHref(1, keyword, tab, initialStatus, initialClientId)));
  };

  const handleSearch = (value: string) => {
    setKeyword(value);
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
    {
      key: 'select',
      className: 'w-8',
      header: (
        <PermissionGuard permission={PERMISSION_PERMISSIONS.DELETE}>
          <Checkbox
            aria-label="全选本页权限"
            checked={deletablePermissions.length > 0 && deletablePermissions.every((p) => checkedIds.has(p.id))}
            disabled={deletablePermissions.length === 0}
            title={deletablePermissions.length === 0 ? '当前页没有可删除的权限' : undefined}
            onCheckedChange={(checked) => setCheckedIds(checked === true ? new Set(deletablePermissions.map((p) => p.id)) : new Set())}
          />
        </PermissionGuard>
      ),
    },
    { key: 'name', header: '名称' },
    { key: 'code', header: '权限编码', className: 'hidden md:table-cell' },
    { key: 'type', header: '类型', className: 'hidden min-[1100px]:table-cell' },
    { key: 'status', header: '状态' },
    { key: 'actions', header: '操作', className: 'text-right' },
  ];

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

  // 标题/页签/搜索同处一行：页签是筛选器，不与工具栏各占一行
  const cardHeader = (
    <TableToolbar
      className="md:items-start"
      left={
        <div className="flex flex-wrap items-center gap-1.5">
          <h1 className="type-section-title shrink-0 text-foreground">权限管理</h1>
          {tabsBar}
          <SearchInput className="md:w-[190px] xl:w-64" placeholder="搜索名称或编码" value={keyword} onChange={handleSearch} />
          <div className="order-3 flex w-full flex-wrap items-center gap-2 min-[1100px]:order-2 min-[1100px]:w-auto">
            <Select value={initialStatus || 'ALL'} onValueChange={(v) => startTransition(() => router.push(buildHref(1, keyword, activeTab, v === 'ALL' ? '' : v, initialClientId)))}>
              <SelectTrigger aria-label="过滤权限状态" className="w-[calc(50%-0.25rem)] md:w-28">
                <SelectValue>
                  {initialStatus === 'ACTIVE' ? '已启用' : initialStatus === 'DISABLED' ? '已禁用' : '全部状态'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部状态</SelectItem>
                <SelectItem value="ACTIVE">已启用</SelectItem>
                <SelectItem value="DISABLED">已禁用</SelectItem>
              </SelectContent>
            </Select>
            <Select value={initialClientId || 'ALL'} onValueChange={(v) => startTransition(() => router.push(buildHref(1, keyword, activeTab, initialStatus, v === 'ALL' ? '' : v)))}>
              <SelectTrigger aria-label="过滤归属应用" className="w-[calc(50%-0.25rem)] md:w-32">
                <SelectValue>{initialClientId === 'NONE' ? '未绑定应用' : clients.find((c) => c.id === initialClientId)?.name ?? '全部应用'}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部应用</SelectItem>
                <SelectItem value="NONE">未绑定应用</SelectItem>
                {clients.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.name}（{c.id}）</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      }
      right={
        <PermissionGuard permission={PERMISSION_PERMISSIONS.CREATE}>
          <Button asChild>
            <Link href={`/permissions/new?returnTo=${encodeURIComponent(createReturnTo)}`}><Plus className="h-4 w-4" /> 新建权限</Link>
          </Button>
        </PermissionGuard>
      }
    />
  );

  const renderRow = (p: PermissionRow) => (
    <TableRow key={p.id} className={`hover:bg-muted/50 ${checkedIds.has(p.id) ? 'bg-primary/[0.03]' : ''}`}>
      <TableCell className="w-8 pr-0">
        <PermissionGuard permission={PERMISSION_PERMISSIONS.DELETE}>
          <Checkbox
            aria-label={`选择权限 ${p.name}`}
            checked={checkedIds.has(p.id)}
            disabled={isBuiltinPermission(p.code)}
            title={isBuiltinPermission(p.code) ? '内置权限不可删除' : undefined}
            onCheckedChange={(checked) => setCheckedIds((prev) => {
              const next = new Set(prev);
              if (checked === true) next.add(p.id); else next.delete(p.id);
              return next;
            })}
          />
        </PermissionGuard>
      </TableCell>
      <TableCell className="font-medium">
        <span className="flex items-center gap-1.5">
          <span className="block max-w-[120px] truncate md:max-w-[210px]" title={p.name}>{p.name}</span>
          {isBuiltinPermission(p.code) && (
            <Badge variant="secondary" className="h-4 shrink-0 px-1 text-[9px]" title="服务端代码引用，不可删除；可修改名称/状态">
              内置
            </Badge>
          )}
        </span>
        <span className="mt-0.5 block max-w-[135px] truncate font-mono text-[10px] font-normal text-muted-foreground md:hidden" title={p.code}>
          {TYPE_LABELS[p.type] ?? p.type} · {p.code}
        </span>
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
      <TableCell className="hidden md:table-cell">
        <code className="rounded-md bg-muted px-2 py-0.5 text-xs">{p.code}</code>
        {p.type === 'API' && (
          <span className="ml-2 text-[11px] text-muted-foreground" title="归属应用（决定角色能否通过该 Client 的 OAuth 准入）">
            归属应用：{p.clientId ?? '未绑定'}
          </span>
        )}
      </TableCell>
      <TableCell className="hidden min-[1100px]:table-cell">
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
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label={`编辑权限 ${p.name}`} title="编辑">
              <Link href={`/permissions/${p.id}/edit?returnTo=${encodeURIComponent(returnTo)}`}><Edit className="h-4 w-4" /><span className="hidden md:inline">编辑</span></Link>
            </Button>
          </PermissionGuard>
          {!isBuiltinPermission(p.code) && (
          <PermissionGuard permission={PERMISSION_PERMISSIONS.DELETE}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`删除权限 ${p.name}`}
              title="删除"
              className="h-8 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
              onClick={() => openDeleteDialog(p)}
            >
              <Trash2 className="h-4 w-4" /><span className="hidden md:inline">删除</span>
            </Button>
          </PermissionGuard>
          )}
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
      <DataTable
        columns={columns}
        data={permissions}
        loading={isPending}
        emptyState={
          keyword.trim() || activeTab !== 'ALL' || initialStatus !== '' || initialClientId !== '' ? (
            <EmptyState
              variant="simple"
              kind="filtered"
              icon="ShieldCheck"
              clearAction={{ label: '查看全部', href: '/permissions' }}
            />
          ) : (
            <EmptyState
              variant="simple"
              icon="ShieldCheck"
              title="暂无权限"
              description="新增权限点以控制功能访问"
              action={{ label: '新建权限', href: `/permissions/new?returnTo=${encodeURIComponent(createReturnTo)}` }}
            />
          )
        }
        renderRow={renderRow}
        cardHeader={<>
          {cardHeader}
          {visibleChecked.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 border-b bg-primary/[0.04] px-3 py-1.5">
              <span className="text-[12px] font-medium">已选 {visibleChecked.length} 个权限</span>
              <Button size="sm" variant="destructive" className="h-7" onClick={() => setBulkOpen(true)}>批量删除</Button>
              <Button size="sm" variant="ghost" className="h-7" onClick={() => setCheckedIds(new Set())}>取消选择</Button>
            </div>
          )}
        </>}
      />

      <TablePagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPageChange={(next) => startTransition(() => router.push(buildHref(next)))}
      />
      </div>

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

      {/* 批量删除确认：目录/页面会级联子菜单，内置权限服务端会拒绝 */}
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>批量删除 {visibleChecked.length} 个权限？</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            内置权限会被跳过；删除目录/页面会级联删除其子菜单，并清除角色绑定、刷新受影响用户权限缓存。
          </p>
          <ul className="space-y-0.5 text-[12px] text-muted-foreground">
            {visibleChecked.slice(0, 8).map((p) => (
              <li key={p.id} className="truncate">{p.name} <span className="font-mono text-[11px]">({p.code})</span></li>
            ))}
            {visibleChecked.length > 8 && <li>… 其余 {visibleChecked.length - 8} 个</li>}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setBulkOpen(false)} disabled={bulking}>取消</Button>
            <Button
              variant="destructive"
              disabled={bulking}
              onClick={async () => {
                setBulking(true);
                try {
                  const res = await bulkDeletePermissionsAction(visibleChecked.map((p) => p.id));
                  if (res.success) {
                    toast.success(res.message ?? '批量删除完成');
                    setBulkOpen(false);
                    setCheckedIds(new Set());
                    router.refresh();
                  } else {
                    reportFailure(res, '批量删除失败');
                  }
                } finally {
                  setBulking(false);
                }
              }}
            >
              {bulking ? '删除中...' : '确认批量删除'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

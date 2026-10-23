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
import {
  TableCell, TableRow,
} from '@/components/ui/table';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { TablePagination } from '@/components/shared/table-pagination';
import { enableStatus } from '@/lib/status-label';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { deletePermissionAction } from '../actions';

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

  // 删除确认（新建/编辑已页面化：弹窗不允许滚动）
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [selected, setSelected] = useState<PermissionRow | null>(null);
  /** 删除影响面（打开确认弹窗时按需读取，不缓存） */
  const [deleteImpact, setDeleteImpact] = useState<{ descendants: number; roles: number; users: number } | null>(null);
  const [impactLoading, setImpactLoading] = useState(false);
  const { reportFailure } = useFieldFailure();
  const handleTabChange = (tab: string) => {
    startTransition(() => router.push(buildHref(1, keyword, tab)));
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
    { key: 'name', header: '名称' },
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
          <Button asChild>
            <Link href="/permissions/new"><Plus className="h-4 w-4" /> 新建权限</Link>
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
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label={`编辑权限 ${p.name}`} title="编辑">
              <Link href={`/permissions/${p.id}/edit`}><Edit className="h-4 w-4" /><span>编辑</span></Link>
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={PERMISSION_PERMISSIONS.DELETE}>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`删除权限 ${p.name}`}
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
      <div className="flex shrink-0 flex-wrap items-center gap-3">
        <h1 className="type-section-title text-foreground">权限管理</h1>
        {tabsBar}
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
      <DataTable
        columns={columns}
        data={permissions}
        loading={isPending}
        emptyState={
          keyword.trim() || activeTab !== 'ALL' ? (
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
              action={{ label: '新建权限', href: '/permissions/new' }}
            />
          )
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

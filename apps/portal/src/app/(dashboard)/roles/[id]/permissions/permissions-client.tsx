'use client';

/**
 * 角色权限配置（产品方案 v3：作用域树 + 批量授权）
 *
 * 用户任务：给一个角色配齐"某应用"或"某菜单目录"下的权限。
 * 旧交互（逐个勾选 + 反复滚动/搜索）量化为 39 次点击/应用；
 * 现在：左侧选作用域 → 右侧组全选（1 击）→ 保存（1 击），支持搜索/仅看已选/折叠。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Layers, Loader2, Save, Sparkles } from 'lucide-react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';

import { updateRolePermissionsAction } from '../../actions';

interface PermissionItem {
  id: string;
  name: string;
  code: string;
  type: string;
  parentId?: string | null;
  clientId?: string | null;
  status?: string;
}

export interface RolePermissionsPageProps {
  role: { id: string; name: string; isSystem?: boolean };
  /** 返回角色列表（保留筛选） */
  returnHref?: string;
}

const TYPE_LABELS: Record<string, string> = { API: '接口', PAGE: '页面', DIRECTORY: '目录' };

/**
 * 权限模板：把"常用角色组合"变成一键起点，再用已有的待新增/待移除差异确认。
 * 只列真实存在的权限码（按当前权限清单过滤），不存在的不算数。
 */
const PERMISSION_TEMPLATES: Array<{ id: string; name: string; description: string; codes: string[] }> = [
  {
    id: 'audit-viewer', name: '审计只读', description: '进入审计日志并查看事件',
    codes: ['portal:menu:audit-logs', 'portal:audit:read'],
  },
  {
    id: 'audit-investigator', name: '审计调查员', description: '查看 + 导出审计日志（取证）',
    codes: ['portal:menu:audit-logs', 'portal:audit:read', 'portal:audit:export'],
  },
  {
    id: 'user-admin', name: '用户管理员', description: '找人、建号、改资料/重置密码',
    codes: [
      'portal:menu:users', 'portal:user:list', 'portal:user:read', 'portal:user:create',
      'portal:user:update', 'portal:user:reset_password',
      'portal:department:list', 'portal:department:read',
    ],
  },
  {
    id: 'client-admin', name: '应用管理员', description: '应用注册/配置/密钥轮换',
    codes: [
      'portal:menu:clients', 'portal:client:list', 'portal:client:read', 'portal:client:create',
      'portal:client:update', 'portal:client:delete', 'portal:client:rotate_secret',
    ],
  },
  {
    id: 'dept-viewer', name: '组织架构查看', description: '只读查看部门树',
    codes: ['portal:menu:departments', 'portal:department:list', 'portal:department:read'],
  },
];

interface ScopeNode {
  id: string;
  label: string;
  kind: 'all' | 'selected' | 'app' | 'dir' | 'page';
  count: number;
  itemIds: string[];
  children: ScopeNode[];
  depth: number;
}

export default function RolePermissionsPage({ role, returnHref = '/roles' }: RolePermissionsPageProps) {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  /** 读取时的已授权快照：用于差异（待新增/待移除）与保存确认 */
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [scopeId, setScopeId] = useState('all');
  const [onlySelected, setOnlySelected] = useState(false);
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'ACTIVE' | 'DISABLED'>('ALL');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { reportFailure } = useFieldFailure();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const collectAllPermissions = async (): Promise<PermissionItem[]> => {
        const firstRes = await fetch('/api/permissions?pageSize=100&page=1');
        const firstData = await firstRes.json();
        const first: PermissionItem[] = Array.isArray(firstData) ? firstData : (firstData.data ?? []);
        const totalPages: number = firstData?.pagination?.totalPages ?? 1;
        const rest: PermissionItem[] = [];
        for (let page = 2; page <= Math.min(totalPages, 50); page += 1) {
          const res = await fetch(`/api/permissions?pageSize=100&page=${page}`);
          const data = await res.json();
          rest.push(...(Array.isArray(data) ? data : (data.data ?? [])));
        }
        return [...first, ...rest];
      };
      const [all, assignedRaw] = await Promise.all([
        collectAllPermissions(),
        fetch(`/api/roles/${role.id}/permissions`).then((r) => r.json()),
      ]);
      const assigned: PermissionItem[] = Array.isArray(assignedRaw) ? assignedRaw : (assignedRaw.data ?? []);
      setPermissions(all);
      const ids = new Set(assigned.map((p) => p.id));
      setAssignedIds(ids);
      setSavedIds(new Set(ids));
    } catch {
      toast.error('加载权限数据失败');
    } finally {
      setLoading(false);
    }
  }, [role.id]);

  useEffect(() => {
    queueMicrotask(() => { void loadData(); });
  }, [loadData]);

  /** 作用域树：全部 / 已选 / 应用(API) / 菜单目录树(目录+页面) */
  const tree = useMemo<ScopeNode[]>(() => {
    const byParent = new Map<string | null, PermissionItem[]>();
    const ids = new Set(permissions.map((p) => p.id));
    for (const p of permissions) {
      if (p.type === 'API') continue;
      const key = p.parentId && ids.has(p.parentId) ? p.parentId : null;
      byParent.set(key, [...(byParent.get(key) ?? []), p]);
    }
    const collectMenu = (p: PermissionItem, depth: number): ScopeNode => {
      const children = (byParent.get(p.id) ?? []).map((c) => collectMenu(c, depth + 1));
      return {
        id: p.id,
        label: p.name,
        kind: p.type === 'DIRECTORY' ? 'dir' : 'page',
        count: 1 + children.reduce((n, c) => n + c.count, 0),
        itemIds: [p.id, ...children.flatMap((c) => c.itemIds)],
        children,
        depth,
      };
    };
    const menuRoots = (byParent.get(null) ?? []).map((p) => collectMenu(p, 0));

    const apps = new Map<string, PermissionItem[]>();
    for (const p of permissions.filter((x) => x.type === 'API')) {
      const app = p.clientId ?? 'unknown';
      apps.set(app, [...(apps.get(app) ?? []), p]);
    }
    const appNodes: ScopeNode[] = [...apps.entries()].map(([app, items]) => ({
      id: `app:${app}`,
      label: app === 'portal' ? '应用：门户（portal）' : `应用：${app}`,
      kind: 'app',
      count: items.length,
      itemIds: items.map((p) => p.id),
      children: [],
      depth: 0,
    }));

    return [
      { id: 'all', label: '全部权限', kind: 'all', count: permissions.length, itemIds: permissions.map((p) => p.id), children: [], depth: 0 },
      { id: 'selected', label: '已选权限', kind: 'selected', count: assignedIds.size, itemIds: [...assignedIds], children: [], depth: 0 },
      ...appNodes,
      ...menuRoots,
    ];
  }, [permissions, assignedIds]);

  const scope = useMemo(() => {
    const find = (nodes: ScopeNode[]): ScopeNode | null => {
      for (const n of nodes) {
        if (n.id === scopeId) return n;
        const hit = find(n.children);
        if (hit) return hit;
      }
      return null;
    };
    return find(tree) ?? tree[0]!;
  }, [tree, scopeId]);

  const { addedIds, removedIds } = useMemo(() => {
    const added = new Set<string>();
    const removed = new Set<string>();
    for (const id of assignedIds) if (!savedIds.has(id)) added.add(id);
    for (const id of savedIds) if (!assignedIds.has(id)) removed.add(id);
    return { addedIds: added, removedIds: removed };
  }, [assignedIds, savedIds]);
  const changeCount = addedIds.size + removedIds.size;
  const leaveGuard = useUnsavedChangesGuard(changeCount > 0);

  const templateItems = useMemo(
    () => PERMISSION_TEMPLATES.map((t) => {
      const ids = permissions.filter((p) => t.codes.includes(p.code)).map((p) => p.id);
      return { ...t, ids };
    }),
    [permissions],
  );

  const scopedItems = useMemo(() => {
    const set = new Set(scope.itemIds);
    const byId = new Map(permissions.map((p) => [p.id, p]));
    const depthOf = (p: PermissionItem) => {
      let d = 0;
      let cur = p;
      const guard = new Set<string>();
      while (cur.parentId && byId.has(cur.parentId) && !guard.has(cur.id)) {
        guard.add(cur.id);
        cur = byId.get(cur.parentId)!;
        d += 1;
      }
      return d;
    };
    const kw = keyword.trim().toLowerCase();
    return permissions
      .filter((p) => set.has(p.id))
      .filter((p) => (onlySelected ? assignedIds.has(p.id) : true))
      .filter((p) => (onlyChanged ? addedIds.has(p.id) || removedIds.has(p.id) : true))
      .filter((p) => (statusFilter === 'ALL' ? true : (p.status ?? 'ACTIVE') === statusFilter))
      .filter((p) => (kw ? p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw) : true))
      .map((p) => ({ ...p, depth: p.type === 'API' ? 0 : depthOf(p) }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code));
  }, [permissions, scope, assignedIds, savedIds, keyword, onlySelected, onlyChanged, addedIds, removedIds, statusFilter]);

  const scopeItemIds = scopedItems.map((p) => p.id);
  const allScopeSelected = scopeItemIds.length > 0 && scopeItemIds.every((id) => assignedIds.has(id));

  const setIds = (ids: string[], checked: boolean) => {
    setAssignedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };
  const toggle = (id: string) => setIds([id], !assignedIds.has(id));

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateRolePermissionsAction(role.id, Array.from(assignedIds));
      if (res.success) {
        setSavedIds(new Set(assignedIds));
        setConfirmOpen(false);
        toast.success(`已更新角色「${role.name}」的权限（+${addedIds.size} / -${removedIds.size}）`);
      } else {
        reportFailure(res);
      }
    } finally {
      setSaving(false);
    }
  };

  const renderTree = (nodes: ScopeNode[], depth = 0): React.ReactNode =>
    nodes.map((node) => {
      const isCollapsed = collapsed.has(node.id);
      const hasChildren = node.children.length > 0;
      const selectedCount = node.itemIds.filter((id) => assignedIds.has(id)).length;
      return (
        <div key={node.id}>
          <div
            className={`flex items-center rounded transition-colors hover:bg-muted/60 ${
              scopeId === node.id ? 'bg-primary/10 font-medium text-foreground' : 'text-foreground'
            }`}
          >
            {hasChildren ? (
              <button
                type="button"
                aria-label={isCollapsed ? `展开 ${node.label}` : `折叠 ${node.label}`}
                onClick={() =>
                  setCollapsed((prev) => {
                    const next = new Set(prev);
                    if (next.has(node.id)) next.delete(node.id);
                    else next.add(node.id);
                    return next;
                  })
                }
                className="ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted"
              >
                {isCollapsed ? <ChevronRight className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </button>
            ) : (
              <span className="ml-0.5 inline-block h-5 w-5 shrink-0" />
            )}
            <button
              type="button"
              onClick={() => setScopeId(node.id)}
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 pr-2 text-left text-[13px]"
              style={{ paddingLeft: 2 + depth * 12 }}
            >
              {node.kind === 'app' && <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate">{node.label}</span>
              {node.kind !== 'selected' && (
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{selectedCount}/{node.count}</span>
              )}
            </button>
          </div>
          {hasChildren && !isCollapsed && renderTree(node.children, depth + 1)}
        </div>
      );
    });

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        backHref={returnHref}
        backLabel="返回角色列表"
        icon="Key"
        title="配置功能权限"
        description={`角色：${role.name}｜左侧选作用域，右侧一键全选后保存`}
      />

      {role.isSystem && (
        <div className="rounded-lg border border-border/70 bg-muted/50 px-3 py-2 text-[11px] leading-5 text-foreground">
          系统角色由平台维护，权限只读；如需调整请创建自定义角色。下方勾选项与保存按钮均已禁用。
        </div>
      )}

      {/* 窄屏：作用域树折叠为下拉 */}
      <div className="lg:hidden">
        <select
          aria-label="权限作用域"
          value={scopeId}
          onChange={(e) => setScopeId(e.target.value)}
          className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-[13px]"
        >
          {tree.map((n) => (
            <option key={n.id} value={n.id}>{n.label}（{n.count}）</option>
          ))}
        </select>
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm ring-0">
        <aside className="hidden w-60 shrink-0 flex-col border-r lg:flex">
          <div className="border-b bg-muted/30 px-3 py-1.5 text-[11px] font-medium text-muted-foreground">作用域</div>
          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-1.5">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : (
              <>
                {renderTree(tree.slice(0, 2))}
                <div className="mt-2 px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground">接口应用</div>
                {renderTree(tree.filter((n) => n.kind === 'app'))}
                <div className="mt-2 px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground">菜单目录</div>
                {renderTree(tree.filter((n) => n.kind === 'dir' || n.kind === 'page'))}
              </>
            )}
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-1.5">
            <SearchInput placeholder="搜索当前作用域内权限..." value={keyword} onChange={setKeyword} />
            <Badge variant="secondary" className="h-6">{loading ? '加载中' : `${scope.label} · ${scopedItems.length} 项`}</Badge>
            <Button variant="ghost" size="sm" onClick={() => setOnlySelected((v) => !v)}>
              {onlySelected ? '显示全部' : '仅看已选'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setOnlyChanged((v) => !v)}>
              {onlyChanged ? '显示全部' : '仅看变更'}
            </Button>
            <div className="flex items-center gap-1">
              {([['ALL', '全部'], ['ACTIVE', '已启用'], ['DISABLED', '已禁用']] as const).map(([v, t]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={statusFilter === v}
                  onClick={() => setStatusFilter(v)}
                  className={`h-6 rounded px-1.5 text-[11px] transition-colors ${statusFilter === v ? 'bg-primary/10 font-medium text-foreground' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {t}
                </button>
              ))}
            </div>
            {/* 作用域级批量操作与当前作用域绑定，放在右侧避免与筛选混排 */}
            <div className="ml-auto flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={role.isSystem || scopeItemIds.length === 0}
                onClick={() => setIds(scopeItemIds, !allScopeSelected)}
              >
                {allScopeSelected ? '取消本域全选' : '全选本域'}
              </Button>
              <Button variant="ghost" size="sm" disabled={role.isSystem || scopeItemIds.length === 0} onClick={() => setIds(scopeItemIds, false)}>
                清空本域
              </Button>
            </div>
          </div>

          <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-24"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
            ) : scopedItems.length === 0 ? (
              <p className="py-16 text-center text-sm text-muted-foreground">
                {onlySelected ? '当前作用域还没有已选权限' : '没有匹配的权限'}
              </p>
            ) : (
              <div className="grid xl:grid-cols-2">
                {scopedItems.map((p) => (
                  <label
                    key={p.id}
                    className={`flex cursor-pointer items-center gap-2.5 border-b border-border/30 px-3 py-1.5 hover:bg-muted/40 ${
                      addedIds.has(p.id) ? 'bg-success/5' : removedIds.has(p.id) ? 'bg-destructive/5' : ''
                    }`}
                  >
                    <Checkbox checked={assignedIds.has(p.id)} onCheckedChange={() => toggle(p.id)} disabled={role.isSystem} />
                    <span className="min-w-0 flex-1" style={{ paddingLeft: p.depth * 12 }}>
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[13px]">{p.name}</span>
                        <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                          {TYPE_LABELS[p.type] ?? p.type}
                        </span>
                        {(p.status ?? 'ACTIVE') !== 'ACTIVE' && (
                          <span className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] text-destructive">已禁用</span>
                        )}
                        {addedIds.has(p.id) && (
                          <span className="shrink-0 rounded bg-badge-success-bg px-1 text-[10px] text-badge-success-fg">待新增</span>
                        )}
                        {removedIds.has(p.id) && (
                          <span className="shrink-0 rounded bg-destructive/10 px-1 text-[10px] text-destructive">待移除</span>
                        )}
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* 底部固定操作栏：差异摘要 + 模板/取消/保存（列表独立滚动，不挤压内容） */}
          <div className="flex flex-wrap items-center gap-2 border-t bg-card px-3 py-2">
            <span className="text-xs text-muted-foreground">
              总已选 <span className="font-semibold tabular-nums text-foreground">{assignedIds.size}</span>
            </span>
            <span className="flex items-center gap-1 text-[11px]">
              <span className="rounded bg-badge-success-bg px-1.5 py-0.5 font-medium text-badge-success-fg">待新增 {addedIds.size > 0 ? `+${addedIds.size}` : '0'}</span>
              <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">待移除 {removedIds.size > 0 ? `-${removedIds.size}` : '0'}</span>
            </span>
            <div className="ml-auto flex items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={loading || role.isSystem}>
                    <Sparkles className="h-3.5 w-3.5" /> 权限模板
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-64">
                  <DropdownMenuLabel>套用常用组合（可继续调整）</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {templateItems.map((t) => (
                    <DropdownMenuItem
                      key={t.id}
                      disabled={role.isSystem || t.ids.length === 0}
                      onClick={() => {
                        if (role.isSystem) return;
                        setAssignedIds(new Set(t.ids));
                        setOnlyChanged(true);
                        toast.success(`已套用「${t.name}」模板（${t.ids.length} 项），保存后生效`);
                      }}
                    >
                      <div className="flex w-full items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium">{t.name}</p>
                          <p className="truncate text-[11px] text-muted-foreground">{t.description}</p>
                        </div>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{t.ids.length} 项</span>
                      </div>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button variant="outline" size="sm" asChild><Link href="/roles">取消</Link></Button>
              <Button
                size="sm"
                onClick={() => setConfirmOpen(true)}
                disabled={loading || saving || role.isSystem || changeCount === 0}
              >
                <Save className="h-3.5 w-3.5" />
                {saving ? '保存中...' : role.isSystem ? '系统角色只读' : changeCount === 0 ? '无变更' : `保存变更（${changeCount}）`}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* 保存前确认：明确影响面（待新增/待移除），避免“点了保存才发现改多/改少” */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认保存权限变更？</DialogTitle>
            <DialogDescription>
              角色「{role.name}」：将新增 {addedIds.size} 项、移除 {removedIds.size} 项权限；保存后绑定该角色的用户权限即时生效。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-[12px]">
            {addedIds.size > 0 && (
              <div>
                <p className="mb-1 font-medium text-badge-success-fg">待新增（{addedIds.size}）</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {permissions.filter((p) => addedIds.has(p.id)).slice(0, 8).map((p) => (
                    <li key={p.id} className="truncate font-mono">+ {p.code}</li>
                  ))}
                  {addedIds.size > 8 && <li className="text-muted-foreground">… 其余 {addedIds.size - 8} 项</li>}
                </ul>
              </div>
            )}
            {removedIds.size > 0 && (
              <div>
                <p className="mb-1 font-medium text-destructive">待移除（{removedIds.size}）</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {permissions.filter((p) => removedIds.has(p.id)).slice(0, 8).map((p) => (
                    <li key={p.id} className="truncate font-mono">- {p.code}</li>
                  ))}
                  {removedIds.size > 8 && <li className="text-muted-foreground">… 其余 {removedIds.size - 8} 项</li>}
                </ul>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={saving}>取消</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '确认保存'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {leaveGuard}
    </div>
  );
}

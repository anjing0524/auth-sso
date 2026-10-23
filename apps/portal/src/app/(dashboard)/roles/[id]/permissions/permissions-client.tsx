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
import { ChevronDown, ChevronRight, Layers, Loader2, Save } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { useFieldFailure } from '@/hooks/use-field-failure';

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
}

const TYPE_LABELS: Record<string, string> = { API: '接口', PAGE: '页面', DIRECTORY: '目录' };

interface ScopeNode {
  id: string;
  label: string;
  kind: 'all' | 'selected' | 'app' | 'dir' | 'page';
  count: number;
  itemIds: string[];
  children: ScopeNode[];
  depth: number;
}

export default function RolePermissionsPage({ role }: RolePermissionsPageProps) {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [scopeId, setScopeId] = useState('all');
  const [onlySelected, setOnlySelected] = useState(false);
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
      setAssignedIds(new Set(assigned.map((p) => p.id)));
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
      .filter((p) => (statusFilter === 'ALL' ? true : (p.status ?? 'ACTIVE') === statusFilter))
      .filter((p) => (kw ? p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw) : true))
      .map((p) => ({ ...p, depth: p.type === 'API' ? 0 : depthOf(p) }))
      .sort((a, b) => a.type.localeCompare(b.type) || a.code.localeCompare(b.code));
  }, [permissions, scope, assignedIds, keyword, onlySelected, statusFilter]);

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
      if (res.success) toast.success(`已更新角色「${role.name}」的权限（${assignedIds.size} 项）`);
      else reportFailure(res);
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
              scopeId === node.id ? 'bg-primary/10 font-medium text-primary' : 'text-foreground'
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
        backHref="/roles"
        backLabel="返回角色列表"
        icon="Key"
        title="配置功能权限"
        description={`角色：${role.name}｜左侧选作用域，右侧一键全选后保存`}
      />

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
                <div className="mt-2 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">接口应用</div>
                {renderTree(tree.filter((n) => n.kind === 'app'))}
                <div className="mt-2 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground/70">菜单目录</div>
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
            <div className="flex items-center gap-1">
              {([['ALL', '全部'], ['ACTIVE', '已启用'], ['DISABLED', '已禁用']] as const).map(([v, t]) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={statusFilter === v}
                  onClick={() => setStatusFilter(v)}
                  className={`h-6 rounded px-1.5 text-[11px] transition-colors ${statusFilter === v ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted'}`}
                >
                  {t}
                </button>
              ))}
            </div>
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
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                总已选 <span className="font-semibold tabular-nums text-foreground">{assignedIds.size}</span>
              </span>
              <Button variant="outline" size="sm" asChild><Link href="/roles">取消</Link></Button>
              <Button size="sm" onClick={handleSave} disabled={loading || saving || role.isSystem}>
                <Save className="h-3.5 w-3.5" />
                {saving ? '保存中...' : role.isSystem ? '系统角色只读' : '保存'}
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
                    className="flex cursor-pointer items-center gap-2.5 border-b border-border/30 px-3 py-1.5 hover:bg-muted/40"
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
                      </span>
                      <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.code}</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

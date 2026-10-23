'use client';

/**
 * 角色权限配置页（v2：按应用/菜单目录分组 + 组级全选）
 *
 * 真实用户步骤量化（2026-10-23 用户反馈）：
 * 旧交互 = 每个权限一次点击；给一个角色配齐某应用 45 项需 45 次点击 + 反复滚动/搜索。
 * 新交互 = 组头一次全选（1 击）+ 保存（1 击）；支持「全选所有」「清空」、搜索、折叠。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Loader2, Save } from 'lucide-react';

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
}

export interface RolePermissionsPageProps {
  role: { id: string; name: string; isSystem?: boolean };
}

const TYPE_LABELS: Record<string, string> = {
  API: '接口',
  PAGE: '页面',
  DIRECTORY: '目录',
};

interface Group {
  key: string;
  label: string;
  hint: string;
  items: Array<PermissionItem & { depth: number }>;
}

export default function RolePermissionsPage({ role }: RolePermissionsPageProps) {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
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

  /** 菜单权限按「根目录」分组并计算层级缩进；API 权限按应用（clientId）分组 */
  const groups = useMemo<Group[]>(() => {
    const byId = new Map(permissions.map((p) => [p.id, p]));
    const rootOf = (p: PermissionItem): PermissionItem => {
      let cur = p;
      const guard = new Set<string>();
      while (cur.parentId && byId.has(cur.parentId) && !guard.has(cur.id)) {
        guard.add(cur.id);
        cur = byId.get(cur.parentId)!;
      }
      return cur;
    };
    const depthOf = (p: PermissionItem): number => {
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

    const menuGroups = new Map<string, Group>();
    for (const p of permissions.filter((x) => x.type !== 'API')) {
      const root = rootOf(p);
      const key = `menu:${root.id}`;
      const g = menuGroups.get(key) ?? { key, label: `目录：${root.name}`, hint: '菜单/页面', items: [] };
      g.items.push({ ...p, depth: p.id === root.id ? 0 : depthOf(p) });
      menuGroups.set(key, g);
    }
    for (const g of menuGroups.values()) {
      g.items.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }

    const apiGroups = new Map<string, Group>();
    for (const p of permissions.filter((x) => x.type === 'API')) {
      const app = p.clientId ?? 'unknown';
      const key = `api:${app}`;
      const g = apiGroups.get(key) ?? {
        key,
        label: app === 'portal' ? '应用：门户（portal）' : `应用：${app}`,
        hint: '接口',
        items: [],
      };
      g.items.push({ ...p, depth: 0 });
      apiGroups.set(key, g);
    }
    for (const g of apiGroups.values()) {
      g.items.sort((a, b) => a.code.localeCompare(b.code));
    }

    return [...apiGroups.values(), ...menuGroups.values()];
  }, [permissions]);

  const kw = keyword.trim().toLowerCase();
  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          items: kw
            ? g.items.filter((p) => p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw))
            : g.items,
        }))
        .filter((g) => g.items.length > 0),
    [groups, kw],
  );

  const allVisibleIds = useMemo(() => visibleGroups.flatMap((g) => g.items.map((p) => p.id)), [visibleGroups]);
  const allVisibleSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => assignedIds.has(id));

  const toggle = (id: string) => {
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const setGroup = (ids: string[], checked: boolean) => {
    setAssignedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (checked) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  };

  const toggleCollapse = (key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateRolePermissionsAction(role.id, Array.from(assignedIds));
      if (res.success) {
        toast.success(`已更新角色「${role.name}」的权限（${assignedIds.size} 项）`);
      } else {
        reportFailure(res);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        backHref="/roles"
        backLabel="返回角色列表"
        icon="Key"
        title="配置功能权限"
        description={`角色：${role.name}｜按应用/目录分组，组头一键全选`}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm ring-0">
        <div className="flex flex-wrap items-center gap-2 border-b bg-muted/30 px-3 py-2">
          <SearchInput placeholder="搜索权限名称或编码..." value={keyword} onChange={setKeyword} />
          <Badge variant="secondary" className="h-6">{loading ? '加载中' : `共 ${permissions.length} 项`}</Badge>
          <span className="text-xs text-muted-foreground">
            已选 <span className="font-semibold tabular-nums text-foreground">{assignedIds.size}</span> 项
          </span>
          <Button
            variant="ghost"
            size="sm"
            disabled={role.isSystem || allVisibleIds.length === 0}
            onClick={() => setGroup(allVisibleIds, !allVisibleSelected)}
          >
            {allVisibleSelected ? '取消全选' : '全选所有'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={role.isSystem || assignedIds.size === 0}
            onClick={() => setAssignedIds(new Set())}
          >
            清空
          </Button>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/roles">取消</Link>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading || saving || role.isSystem}>
              <Save className="h-3.5 w-3.5" />
              {saving ? '保存中...' : role.isSystem ? '系统角色只读' : '保存'}
            </Button>
          </div>
        </div>

        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : visibleGroups.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">没有匹配的权限</p>
          ) : (
            <div className="space-y-2">
              {visibleGroups.map((group) => {
                const groupIds = group.items.map((p) => p.id);
                const allChecked = groupIds.every((id) => assignedIds.has(id));
                const isCollapsed = collapsed.has(group.key) && !kw;
                return (
                  <section key={group.key} className="overflow-hidden rounded-md border border-border/60">
                    <div className="flex items-center gap-2 bg-muted/20 px-2.5 py-1.5">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(group.key)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                        aria-label={isCollapsed ? '展开分组' : '折叠分组'}
                      >
                        {isCollapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                      </button>
                      <Checkbox
                        checked={allChecked}
                        onCheckedChange={(v) => setGroup(groupIds, v === true)}
                        disabled={role.isSystem}
                        aria-label={`全选 ${group.label}`}
                      />
                      <span className="text-[13px] font-medium">{group.label}</span>
                      <span className="text-[11px] text-muted-foreground">{group.hint} · 已选 {groupIds.filter((id) => assignedIds.has(id)).length}/{group.items.length}</span>
                      <button
                        type="button"
                        className="ml-auto text-xs font-medium text-primary hover:underline disabled:opacity-50"
                        disabled={role.isSystem}
                        onClick={() => setGroup(groupIds, !allChecked)}
                      >
                        {allChecked ? '取消全选' : '全选本组'}
                      </button>
                    </div>
                    {!isCollapsed && (
                      <div className="grid xl:grid-cols-2">
                        {group.items.map((p) => (
                          <label
                            key={p.id}
                            className="flex cursor-pointer items-center gap-2.5 border-b border-border/30 px-3 py-1.5 last:border-b-0 hover:bg-muted/40"
                          >
                            <Checkbox
                              checked={assignedIds.has(p.id)}
                              onCheckedChange={() => toggle(p.id)}
                              disabled={role.isSystem}
                            />
                            <span className="min-w-0 flex-1" style={{ paddingLeft: p.depth * 12 }}>
                              <span className="flex items-center gap-1.5">
                                <span className="truncate text-[13px]">{p.name}</span>
                                <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                                  {TYPE_LABELS[p.type] ?? p.type}
                                </span>
                              </span>
                              <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.code}</span>
                            </span>
                          </label>
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

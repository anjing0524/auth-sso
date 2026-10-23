'use client';

/**
 * 角色权限配置页（由 233 行对话框迁移而来）
 *
 * 为什么不再用弹窗：345 项权限、三种类型分组、搜索 + 全选 + 逐项勾选 —— 弹窗内容远超
 * 「少量确认/短表单」的边界，滚动嵌套在弹窗里既难操作也看不清整体；页面化后可用整屏
 * 双列布局 + 固定保存条，符合"重内容用页面、轻确认用弹窗"的交互边界。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
}

export interface RolePermissionsPageProps {
  role: { id: string; name: string; isSystem?: boolean };
}

const TYPE_LABELS: Record<string, string> = {
  API: '接口权限',
  PAGE: '页面权限',
  DIRECTORY: '目录权限',
};
const TYPE_ORDER = ['API', 'PAGE', 'DIRECTORY'];

export default function RolePermissionsPage({ role }: RolePermissionsPageProps) {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { reportFailure } = useFieldFailure();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 权限总量可能远超单页上限（MAX_PAGE_SIZE=100）：按页拉全量，否则只能看到前 100 项。
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

  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return permissions;
    return permissions.filter(
      (p) => p.name.toLowerCase().includes(kw) || p.code.toLowerCase().includes(kw),
    );
  }, [permissions, keyword]);

  const grouped = useMemo(() => {
    return TYPE_ORDER.map((type) => ({
      type,
      items: filtered.filter((p) => p.type === type),
    })).filter((g) => g.items.length > 0);
  }, [filtered]);

  const toggle = (id: string) => {
    setAssignedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleGroup = (items: PermissionItem[], checked: boolean) => {
    setAssignedIds((prev) => {
      const next = new Set(prev);
      for (const item of items) {
        if (checked) next.add(item.id);
        else next.delete(item.id);
      }
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
        description={`角色：${role.name}｜菜单可见性由页面/目录权限决定，保存后即时生效`}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm ring-0">
        {/* 工具条：搜索 + 已选统计 + 保存（重内容页的主操作固定在顶部与底部都可触达） */}
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-3 py-2">
          <SearchInput placeholder="搜索权限名称或编码..." value={keyword} onChange={setKeyword} />
          <Badge variant="secondary" className="h-6">{loading ? '加载中' : `共 ${permissions.length} 项`}</Badge>
          <span className="text-xs text-muted-foreground">已选 <span className="font-semibold tabular-nums text-foreground">{assignedIds.size}</span> 项</span>
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

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">没有匹配的权限</p>
          ) : (
            <div className="grid gap-3 xl:grid-cols-2">
              {grouped.map((group) => {
                const allChecked = group.items.every((p) => assignedIds.has(p.id));
                return (
                  <section key={group.type} className="overflow-hidden rounded-lg border border-border/60">
                    <div className="flex items-center justify-between border-b bg-muted/20 px-3 py-1.5">
                      <h2 className="text-xs font-semibold text-muted-foreground">
                        {TYPE_LABELS[group.type] ?? group.type}（{group.items.length}）
                      </h2>
                      <button
                        type="button"
                        className="text-xs font-medium text-primary hover:underline"
                        onClick={() => toggleGroup(group.items, !allChecked)}
                        disabled={role.isSystem}
                      >
                        {allChecked ? '取消全选' : '全选'}
                      </button>
                    </div>
                    <div>
                      {group.items.map((p) => (
                        <label
                          key={p.id}
                          className="flex cursor-pointer items-center gap-2.5 border-b border-border/40 px-3 py-1.5 last:border-b-0 hover:bg-muted/40"
                        >
                          <Checkbox
                            checked={assignedIds.has(p.id)}
                            onCheckedChange={() => toggle(p.id)}
                            disabled={role.isSystem}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px]">{p.name}</span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">{p.code}</span>
                          </span>
                        </label>
                      ))}
                    </div>
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

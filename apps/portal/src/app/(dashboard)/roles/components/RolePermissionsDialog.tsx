'use client';

/**
 * 角色权限授予对话框（FR-ROL-05 / C-ROL-PA）
 *
 * 背景：后端读能力（GET /api/roles/:id/permissions）与权限注册表早已存在，但**没有 UI**
 * 也没有写路径（`ROLE_PERMISSION_ASSIGN` 曾只是预留审计码）——PRD 与矩阵却把它算作已交付。
 * 本对话框补齐 UI：按类型分组勾选（接口/页面/目录），保存走 Server Action
 * （写编排与 REST 面共用 `lib/role-permission-assignment.ts`）。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { KeyRound, Loader2, Search } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useFieldFailure } from '@/hooks/use-field-failure';

import { updateRolePermissionsAction } from '../actions';

interface PermissionItem {
  id: string;
  name: string;
  code: string;
  type: string;
}

export interface RolePermissionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: { id: string; name: string; isSystem?: boolean };
}

const TYPE_LABELS: Record<string, string> = {
  API: '接口权限',
  PAGE: '页面权限',
  DIRECTORY: '目录权限',
};
const TYPE_ORDER = ['API', 'PAGE', 'DIRECTORY'];

export default function RolePermissionsDialog({ open, onOpenChange, role }: RolePermissionsDialogProps) {
  const [permissions, setPermissions] = useState<PermissionItem[]>([]);
  const [assignedIds, setAssignedIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { reportFailure } = useFieldFailure();

  const loadData = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      // 权限总量可能远超单页上限（MAX_PAGE_SIZE=100）：按页拉全量，否则对话框只能看到前 100 项，
      // 规模数据下无法分配其余权限（2026-10-21 实测 345 项只加载 200 项）。
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
      // `/api/roles/:id/permissions` 是 restSuccess(array) ⇒ **裸数组**
      const assigned: PermissionItem[] = Array.isArray(assignedRaw) ? assignedRaw : (assignedRaw.data ?? []);
      setPermissions(all);
      setAssignedIds(new Set(assigned.map((p) => p.id)));
    } catch {
      toast.error('加载权限数据失败');
    } finally {
      setLoading(false);
    }
  }, [open, role.id]);

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
        onOpenChange(false);
      } else {
        reportFailure(res);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            配置功能权限
          </DialogTitle>
          <DialogDescription>
            为角色 <Badge variant="secondary" className="mx-0.5">{role.name}</Badge> 勾选功能权限；
            菜单可见性由页面/目录权限决定，保存后绑定该角色的用户权限即时生效。
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索权限名称或编码..."
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            aria-label="搜索权限"
          />
        </div>

        <div className="max-h-[380px] space-y-4 overflow-y-auto pr-1">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : grouped.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的权限</p>
          ) : (
            grouped.map((group) => {
              const allChecked = group.items.every((p) => assignedIds.has(p.id));
              return (
                <section key={group.type} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold text-muted-foreground">
                      {TYPE_LABELS[group.type] ?? group.type}（{group.items.length}）
                    </h3>
                    <button
                      type="button"
                      className="text-xs font-medium text-primary hover:underline"
                      onClick={() => toggleGroup(group.items, !allChecked)}
                    >
                      {allChecked ? '取消全选' : '全选'}
                    </button>
                  </div>
                  <div className="rounded-lg border border-border/60">
                    {group.items.map((p) => (
                      <label
                        key={p.id}
                        className="flex cursor-pointer items-center gap-3 border-b border-border/40 px-3 py-2.5 last:border-b-0 hover:bg-muted/50"
                      >
                        <Checkbox
                          checked={assignedIds.has(p.id)}
                          onCheckedChange={() => toggle(p.id)}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{p.name}</span>
                          <span className="block truncate font-mono text-xs text-muted-foreground">
                            {p.code}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={handleSave} disabled={loading || saving || role.isSystem}>
            {saving ? '保存中...' : `保存（已选 ${assignedIds.size} 项）`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

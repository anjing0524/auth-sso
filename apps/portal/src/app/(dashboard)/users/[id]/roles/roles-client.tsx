'use client';

/**
 * 用户角色分配页（由 207 行对话框迁移而来）
 *
 * 内容量判断：需要加载该部门全部角色（可达上百个）+ 预勾选 + 保存，属于"多选+批量写"，
 * 弹窗里的 320px 滚动区已不够用；页面化后可搜索、整屏滚动、固定保存条。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Loader2, Save, Shield } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { useFieldFailure } from '@/hooks/use-field-failure';

import { updateUserRolesAction } from '../../actions';

interface Role {
  id: string;
  name: string;
  code: string;
  deptId: string;
  isSystem?: boolean;
  status?: string;
}

export interface UserRolesPageProps {
  user: {
    id: string;
    name: string;
    deptId: string | null;
    deptName: string | null;
  };
}

export default function UserRolesPage({ user }: UserRolesPageProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { reportFailure } = useFieldFailure();

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      // 角色可能超过单页上限（MAX_PAGE_SIZE=100）：按页拉全量（与角色权限页同一修法）。
      const collectAllRoles = async (): Promise<Role[]> => {
        const firstRes = await fetch('/api/roles?pageSize=100&page=1');
        if (!firstRes.ok) throw new Error(`加载角色失败（HTTP ${firstRes.status}）`);
        const firstData = await firstRes.json();
        const first: Role[] = firstData.data ?? [];
        const totalPages: number = firstData?.pagination?.totalPages ?? 1;
        const rest: Role[] = [];
        for (let page = 2; page <= Math.min(totalPages, 50); page += 1) {
          const res = await fetch(`/api/roles?pageSize=100&page=${page}`);
          if (!res.ok) break;
          const data = await res.json();
          rest.push(...(data.data ?? []));
        }
        return [...first, ...rest];
      };

      const [allRoles, userRolesRes] = await Promise.all([
        collectAllRoles(),
        fetch(`/api/users/${user.id}/roles`),
      ]);
      const userRolesData = await userRolesRes.json();

      // 仅展示用户所属部门的 ACTIVE 角色（R-USER-ROLE 部门约束）
      const filtered = user.deptId
        ? allRoles.filter((r) => r.deptId === user.deptId && (r.status ?? 'ACTIVE') === 'ACTIVE')
        : [];
      setRoles(filtered);

      // 两种信封：`/api/roles` 是 { data, pagination }；`/api/users/:id/roles` 是裸数组。
      const assigned: Array<{ id: string; roleId?: string }> = Array.isArray(userRolesData)
        ? userRolesData
        : (userRolesData.data ?? []);
      setAssignedRoleIds(new Set(assigned.map((r) => r.roleId ?? r.id)));
    } catch {
      toast.error('加载角色数据失败');
    } finally {
      setLoading(false);
    }
  }, [user.id, user.deptId]);

  useEffect(() => {
    queueMicrotask(() => { void loadData(); });
  }, [loadData]);

  const filteredRoles = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return roles;
    return roles.filter(
      (r) => r.name.toLowerCase().includes(kw) || r.code.toLowerCase().includes(kw),
    );
  }, [roles, keyword]);

  const toggleRole = (roleId: string) => {
    setAssignedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) next.delete(roleId);
      else next.add(roleId);
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const roleIds = Array.from(assignedRoleIds);
      const res = await updateUserRolesAction(user.id, roleIds);
      if (res.success) {
        toast.success(`已为用户「${user.name}」更新角色（${roleIds.length} 个）`);
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
        backHref={`/users/${user.id}`}
        backLabel="返回用户详情"
        icon="Users"
        title="分配角色"
        description={`用户：${user.name}${user.deptName ? `（${user.deptName}）` : '（未分配部门）'}｜仅展示所属部门的启用角色`}
      />

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm ring-0">
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-3 py-2">
          <SearchInput placeholder="搜索角色名称或编码..." value={keyword} onChange={setKeyword} />
          <Badge variant="secondary" className="h-6">{loading ? '加载中' : `可选 ${roles.length} 个`}</Badge>
          <span className="text-xs text-muted-foreground">已选 <span className="font-semibold tabular-nums text-foreground">{assignedRoleIds.size}</span> 个</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/users/${user.id}`}>取消</Link>
            </Button>
            <Button size="sm" onClick={handleSave} disabled={loading || saving || !user.deptId}>
              <Save className="h-3.5 w-3.5" />
              {saving ? '保存中...' : '保存变更'}
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : filteredRoles.length === 0 ? (
            <p className="py-16 text-center text-sm text-muted-foreground">
              {!user.deptId
                ? '请先为该用户分配部门，再分配角色'
                : keyword
                  ? '没有匹配的角色'
                  : '该部门下暂无可用角色，请先为部门创建角色'}
            </p>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {filteredRoles.map((role) => (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-2.5 rounded-md border border-border/60 px-3 py-2 transition-colors hover:bg-muted/40"
                >
                  <Checkbox
                    checked={assignedRoleIds.has(role.id)}
                    onCheckedChange={() => toggleRole(role.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{role.name}</span>
                      {role.isSystem && (
                        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">系统</Badge>
                      )}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">{role.code}</span>
                  </span>
                  <Shield className="h-3.5 w-3.5 shrink-0 text-muted-foreground/50" aria-hidden="true" />
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

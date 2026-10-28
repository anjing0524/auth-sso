'use client';

/**
 * 用户角色分配页（由 207 行对话框迁移而来）
 *
 * 内容量判断：需要加载该部门全部角色（可达上百个）+ 预勾选 + 保存，属于"多选+批量写"，
 * 弹窗里的 320px 滚动区已不够用；页面化后可搜索、整屏滚动、固定保存条。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Loader2, Save } from 'lucide-react';

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { PageHeader } from '@/components/shared/page-header';
import { SearchInput } from '@/components/shared/search-input';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';

import { updateUserRolesAction } from '../../actions';

interface Role {
  id: string;
  name: string;
  code: string;
  deptId: string;
  isSystem?: boolean;
  status?: string;
  /** 角色当前绑定的权限数（0 = 分配后用户无法登录门户） */
  permissionCount?: number;
}

export interface UserRolesPageProps {
  user: {
    id: string;
    name: string;
    deptId: string | null;
    deptName: string | null;
  };
  /** 返回详情/列表（保留来源上下文） */
  returnHref?: string;
}

export default function UserRolesPage({ user, isSelf = false, returnHref }: UserRolesPageProps & { isSelf?: boolean }) {
  const router = useRouter();
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState<Set<string>>(new Set());
  /** 读取时的已分配快照：用于差异（待新增/待移除）与保存确认 */
  const [savedRoleIds, setSavedRoleIds] = useState<Set<string>>(new Set());
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [onlySelected, setOnlySelected] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const { reportFailure } = useFieldFailure();
  const readOnly = isSelf;

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
      const ids = new Set(assigned.map((r) => r.roleId ?? r.id));
      setAssignedRoleIds(new Set(ids));
      setSavedRoleIds(new Set(ids));
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

  const { addedIds, removedIds } = useMemo(() => {
    const added = new Set<string>();
    const removed = new Set<string>();
    for (const id of assignedRoleIds) if (!savedRoleIds.has(id)) added.add(id);
    for (const id of savedRoleIds) if (!assignedRoleIds.has(id)) removed.add(id);
    return { addedIds: added, removedIds: removed };
  }, [assignedRoleIds, savedRoleIds]);
  const changeCount = addedIds.size + removedIds.size;
  const leaveGuard = useUnsavedChangesGuard(changeCount > 0);
  const displayRoles = onlySelected ? filteredRoles.filter((r) => assignedRoleIds.has(r.id)) : filteredRoles;
  const selectedRoles = roles.filter((r) => assignedRoleIds.has(r.id));
  const selectedPermTotal = selectedRoles.reduce((sum, r) => sum + (r.permissionCount ?? 0), 0);
  const allSelectedRolesEmpty = selectedRoles.length > 0 && selectedRoles.every((r) => (r.permissionCount ?? 0) === 0);

  const toggleRole = (roleId: string) => {
    if (readOnly) return;
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
        setSavedRoleIds(new Set(assignedRoleIds));
        setConfirmOpen(false);
        router.refresh();
        toast.success(`已更新角色（+${addedIds.size} / -${removedIds.size}）`);
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
        backHref={returnHref ?? `/users/${user.id}`}
        backLabel="返回用户详情"
        icon="Users"
        title="分配角色"
        description={`用户：${user.name}${user.deptName ? `（${user.deptName}）` : '（未分配部门）'}｜仅展示所属部门的启用角色；用户需至少有一个含权限的角色才能登录门户`}
      />

      {readOnly && (
        <div className="rounded-lg border border-badge-warning-fg/30 bg-badge-warning-bg px-3 py-2 text-[11px] text-badge-warning-fg">
          这是你自己的账号，不能修改自己的角色（防止移除最后一个管理角色后自我锁死）。请由其他管理员操作。
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border/70 bg-card shadow-sm ring-0">
        <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-3 py-2">
          <SearchInput placeholder="搜索角色名称或编码" value={keyword} onChange={setKeyword} />
          <Badge variant="secondary" className="h-6">{loading ? '加载中' : `可选 ${roles.length} 个`}</Badge>
          <Button
            variant="ghost"
            size="sm"
            aria-pressed={onlySelected}
            className={onlySelected ? 'bg-muted text-foreground' : undefined}
            onClick={() => setOnlySelected((v) => !v)}
          >
            仅看已选
          </Button>
          <Button
            variant="ghost" size="sm" disabled={readOnly || loading || filteredRoles.length === 0}
            title={readOnly ? '没有分配角色的权限' : loading ? '加载中…' : filteredRoles.length === 0 ? '当前筛选没有可选角色' : undefined}
            onClick={() => setAssignedRoleIds((prev) => new Set([...prev, ...filteredRoles.map((r) => r.id)]))}
          >
            全选当前筛选
          </Button>
          <Button variant="ghost" size="sm" disabled={readOnly || loading || assignedRoleIds.size === 0} title={readOnly ? '没有分配角色的权限' : loading ? '加载中…' : assignedRoleIds.size === 0 ? '当前没有已选角色' : undefined} onClick={() => setAssignedRoleIds(new Set())}>
            清空全部
          </Button>
          <span className="flex items-center gap-1 text-[11px]">
            <span className="rounded bg-badge-success-bg px-1.5 py-0.5 font-medium text-badge-success-fg">待新增 +{addedIds.size}</span>
            <span className="rounded bg-destructive/10 px-1.5 py-0.5 font-medium text-destructive">待移除 -{removedIds.size}</span>
          </span>
          <span className="text-xs text-muted-foreground">已选 <span className="font-semibold tabular-nums text-foreground">{assignedRoleIds.size}</span> 个</span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href={`/users/${user.id}`}>取消</Link>
            </Button>
            <Button size="sm" onClick={() => setConfirmOpen(true)} disabled={readOnly || loading || saving || !user.deptId || changeCount === 0} title={readOnly ? '不能修改自己的角色' : loading ? '加载中…' : saving ? '保存中…' : !user.deptId ? '用户未分配部门，无法分配角色' : changeCount === 0 ? '没有未保存的修改' : undefined}>
              <Save className="h-3.5 w-3.5" />
              {saving ? '保存中...' : changeCount > 0 ? `保存变更（${changeCount}）` : '保存变更'}
            </Button>
          </div>
        </div>

        {allSelectedRolesEmpty && (
          <div className="border-b bg-destructive/10 px-3 py-1.5 text-[11px] text-destructive">
            所选角色均没有任何权限（合计 0 项）：保存后该用户将无法登录门户。请继续为角色配置权限或改选其他角色。
          </div>
        )}
        {!allSelectedRolesEmpty && selectedRoles.length > 0 && (
          <div className="border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
            所选 {selectedRoles.length} 个角色合计 {selectedPermTotal} 项权限
          </div>
        )}
        <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto p-3">
          {loading ? (
            <div className="flex items-center justify-center py-24">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : displayRoles.length === 0 ? (
            <div className="space-y-3 py-16 text-center">
              <p className="text-sm text-muted-foreground">
                {!user.deptId
                  ? '请先为该用户分配部门，再分配角色'
                  : keyword
                    ? '没有匹配的角色'
                    : '该部门下暂无可用角色，请先为部门创建角色'}
              </p>
              {keyword ? (
                <Button size="sm" variant="outline" onClick={() => setKeyword('')}>清除搜索</Button>
              ) : (
                <Button asChild size="sm" variant="outline">
                  {user.deptId ? (
                    <Link href={`/roles?deptId=${user.deptId}`}>前往角色管理</Link>
                  ) : (
                    <Link href={`/users/${user.id}`}>返回用户详情分配部门</Link>
                  )}
                </Button>
              )}
            </div>
          ) : (
            <div className="grid gap-2 xl:grid-cols-2">
              {displayRoles.map((role) => (
                <label
                  key={role.id}
                  className={`flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 transition-colors hover:bg-muted/40 ${
                    addedIds.has(role.id) ? 'border-success/30 bg-success/5' : removedIds.has(role.id) ? 'border-destructive/30 bg-destructive/5' : 'border-border/60'
                  }`}
                >
                  <Checkbox
                    checked={assignedRoleIds.has(role.id)}
                    disabled={readOnly}
                    onCheckedChange={() => toggleRole(role.id)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[13px] font-medium">{role.name}</span>
                      {role.isSystem && (
                        <Badge variant="secondary" className="h-5 shrink-0 px-1.5 text-[10px] font-normal">系统</Badge>
                      )}
                      {addedIds.has(role.id) && <Badge variant="success" className="h-5 shrink-0 px-1.5 text-[10px]">待新增</Badge>}
                      {removedIds.has(role.id) && <Badge variant="destructive" className="h-5 shrink-0 px-1.5 text-[10px]">待移除</Badge>}
                    </span>
                    <span className="block truncate font-mono text-[11px] text-muted-foreground">
                      {role.code}
                      <span className={`ml-1.5 rounded px-1 text-[10px] ${(role.permissionCount ?? 0) === 0 ? 'bg-destructive/10 text-destructive' : 'bg-muted text-muted-foreground'}`}>
                        {(role.permissionCount ?? 0) === 0 ? '0 权限' : `${role.permissionCount} 项`}
                      </span>
                    </span>
                  </span>

                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>确认保存角色变更？</DialogTitle>
            <DialogDescription>
              用户「{user.name}」：将新增 {addedIds.size} 个、移除 {removedIds.size} 个角色；保存后权限即时生效。
              {allSelectedRolesEmpty && ' 注意：所选角色均无权限，保存后该用户将无法登录门户。'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-[12px]">
            {addedIds.size > 0 && (
              <div>
                <p className="mb-1 font-medium text-badge-success-fg">待新增（{addedIds.size}）</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {[...addedIds].slice(0, 6).map((id) => {
                    const r = roles.find((x) => x.id === id);
                    return r ? <li key={id} className="truncate">{r.name} <span className="font-mono text-[11px]">({r.code})</span></li> : null;
                  })}
                  {addedIds.size > 6 && <li className="text-muted-foreground">… 其余 {addedIds.size - 6} 个</li>}
                </ul>
              </div>
            )}
            {removedIds.size > 0 && (
              <div>
                <p className="mb-1 font-medium text-destructive">待移除（{removedIds.size}）</p>
                <ul className="space-y-0.5 text-muted-foreground">
                  {[...removedIds].slice(0, 6).map((id) => {
                    const r = roles.find((x) => x.id === id);
                    return r ? <li key={id} className="truncate">{r.name} <span className="font-mono text-[11px]">({r.code})</span></li> : null;
                  })}
                  {removedIds.size > 6 && <li className="text-muted-foreground">… 其余 {removedIds.size - 6} 个</li>}
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

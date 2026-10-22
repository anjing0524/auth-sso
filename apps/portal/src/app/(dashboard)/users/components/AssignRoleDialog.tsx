'use client';

/**
 * 用户角色分配对话框
 *
 * 从 UserTable 行操作菜单的「分配角色」按钮触发，
 * 展示该用户所属部门下的可选角色列表，支持勾选/取消。
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { updateUserRolesAction } from '../actions';
import { Shield, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';

interface UserInfo {
  id: string;
  name: string;
  deptId: string | null;
  deptName: string | null;
}

interface Role {
  id: string;
  name: string;
  code: string;
  deptId: string;
  isSystem?: boolean;
  status?: string;
}

interface AssignRoleDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: UserInfo;
}

export default function AssignRoleDialog({ open, onOpenChange, user }: AssignRoleDialogProps) {
  const [roles, setRoles] = useState<Role[]>([]);
  const [assignedRoleIds, setAssignedRoleIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const { reportFailure } = useFieldFailure();

  // 加载可选角色 + 用户已有角色
  const loadData = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      // 角色可能超过单页上限（MAX_PAGE_SIZE=100）：pageSize=500 会被服务端夹到 100，
      // 规模数据下超出部分无法分配。这里按页拉全量（与权限对话框同一修法）。
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

      // 两种信封：`/api/roles` 是 { data, pagination }；`/api/users/:id/roles` 是 restSuccess(array) ⇒ 裸数组。
      // 此前只读 `userRolesData.data`（恒 undefined）⇒ 已有角色显示为未勾选、保存即清空（真实缺陷）。
      const assigned: Array<{ id: string; roleId?: string }> = Array.isArray(userRolesData)
        ? userRolesData
        : (userRolesData.data ?? []);
      setAssignedRoleIds(new Set(assigned.map((r) => r.roleId ?? r.id)));
    } catch {
      toast.error('加载角色数据失败');
    } finally {
      setLoading(false);
    }
  }, [open, user.id, user.deptId]);

  useEffect(() => {
    queueMicrotask(() => { void loadData(); });
  }, [loadData]);

  const toggleRole = (roleId: string) => {
    setAssignedRoleIds((prev) => {
      const next = new Set(prev);
      if (next.has(roleId)) {
        next.delete(roleId);
      } else {
        next.add(roleId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const roleIds = Array.from(assignedRoleIds);
      // 内部页面写操作走 Server Action（不再 fetch REST 路由）：
      // 编排与 REST 面共用 lib/user-role-assignment 的同一份实现
      const res = await updateUserRolesAction(user.id, roleIds);
      if (res.success) {
        toast.success(`已为用户「${user.name}」更新角色（${roleIds.length} 个）`);
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
            <Shield className="h-5 w-5 text-primary" />
            分配角色
          </DialogTitle>
          <DialogDescription>
            为用户 <Badge variant="secondary" className="mx-0.5">{user.name}</Badge>
            {user.deptName ? <>（{user.deptName}）</> : '（未分配部门）'} 选择角色。
            仅展示该用户所属部门的角色。
          </DialogDescription>
        </DialogHeader>

        <div className="py-4 max-h-[320px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : roles.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              {user.deptId
                ? '该部门下暂无可用角色，请先为部门创建角色'
                : '请先为该用户分配部门，再分配角色'}
            </p>
          ) : (
            <div className="space-y-1">
              {roles.map((role) => (
                <label
                  key={role.id}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors hover:bg-muted/60"
                >
                  <Checkbox
                    checked={assignedRoleIds.has(role.id)}
                    onCheckedChange={() => toggleRole(role.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">
                      {role.name}
                      {role.isSystem && <span className="ml-2 rounded border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">系统</span>}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">{role.code}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button

            onClick={handleSave}
            disabled={loading || saving}
          >
            {saving ? '保存中...' : '保存变更'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

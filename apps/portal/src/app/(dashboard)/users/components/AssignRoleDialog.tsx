'use client';

/**
 * 用户角色分配对话框
 *
 * 从 UserTable 行操作菜单的「分配角色」按钮触发，
 * 展示该用户所属部门下的可选角色列表，支持勾选/取消。
 */

import { useState, useEffect, useCallback } from 'react';
import { toast } from 'sonner';
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

  // 加载可选角色 + 用户已有角色
  const loadData = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const [rolesRes, userRolesRes] = await Promise.all([
        fetch('/api/roles?pageSize=500'),
        fetch(`/api/users/${user.id}/roles`),
      ]);
      const rolesData = await rolesRes.json();
      const userRolesData = await userRolesRes.json();

      // 仅展示用户所属部门（或同部门）的角色（R-USER-ROLE 部门约束）
      const allRoles: Role[] = rolesData.data ?? [];
      const filtered = user.deptId
        ? allRoles.filter((r) => r.deptId === user.deptId)
        : [];

      setRoles(filtered);

      const assigned: Array<{ id: string; roleId?: string }> = userRolesData.data ?? [];
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
      const res = await fetch(`/api/users/${user.id}/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleIds }),
      });
      const body = await res.json();
      if (res.ok && (body.success || body.data)) {
        toast.success(`已为用户「${user.name}」更新角色（${roleIds.length} 个）`);
        onOpenChange(false);
      } else {
        toast.error(body.message || '角色分配失败');
      }
    } catch {
      toast.error('网络错误，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-xl font-black text-foreground">
            <Shield className="h-5 w-5 text-primary" />
            分配角色
          </DialogTitle>
          <DialogDescription className="text-muted-foreground font-medium">
            为用户 <Badge variant="secondary" className="mx-0.5 font-bold">{user.name}</Badge>
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
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 cursor-pointer transition-colors"
                >
                  <Checkbox
                    checked={assignedRoleIds.has(role.id)}
                    onCheckedChange={() => toggleRole(role.id)}
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold text-foreground truncate">{role.name}</p>
                    <p className="text-[10px] font-mono text-muted-foreground">{role.code}</p>
                  </div>
                </label>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="flex gap-3">
          <Button
            variant="ghost"
            className="flex-1 rounded-xl"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            取消
          </Button>
          <Button
            className="flex-1 rounded-xl shadow-lg shadow-primary/20"
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

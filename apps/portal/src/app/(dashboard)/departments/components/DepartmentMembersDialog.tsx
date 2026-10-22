'use client';

/**
 * 查看部门成员（FR-DEP-05 / F-DEP-M）
 *
 * 后端 `GET /api/departments/:id/members` 与 `getDepartmentMembers` 早已存在，
 * 但页面上没有任何入口——补齐 UI。
 */
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, Users } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { accountStatus } from '@/lib/status-label';

interface Member {
  id: string;
  name: string;
  username: string;
  email: string;
  status: string;
}

/** 头像兜底：中文取首字，拉丁取前两位（与用户列表一致） */
function avatarFallback(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  return /[\u4e00-\u9fa5]/.test(trimmed)
    ? trimmed.charAt(0)
    : trimmed.substring(0, 2).toUpperCase();
}

export function DepartmentMembersDialog({
  open,
  onOpenChange,
  departmentId,
  departmentName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  departmentId: string;
  departmentName: string;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!open) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/departments/${departmentId}/members`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      // restSuccess(array) ⇒ 裸数组；兼容 { data } 信封
      setMembers((Array.isArray(json) ? json : (json.data ?? [])) as Member[]);
    } catch {
      toast.error('加载部门成员失败');
    } finally {
      setLoading(false);
    }
  }, [open, departmentId]);

  useEffect(() => {
    queueMicrotask(() => { void load(); });
  }, [load]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            部门成员
          </DialogTitle>
          <DialogDescription>
            「{departmentName}」直属成员（共 {loading ? '…' : members.length} 人）
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[360px] space-y-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : members.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">该部门暂无直属成员</p>
          ) : (
            members.map((member) => (
              <div key={member.id} className="flex items-center gap-3 rounded-lg px-2 py-2.5 hover:bg-muted/50">
                <Avatar className="h-8 w-8">
                  <AvatarFallback className="bg-primary/5 text-xs text-primary">
                    {avatarFallback(member.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{member.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{member.email}</div>
                </div>
                <Badge variant={accountStatus(member.status).variant}>
                  {accountStatus(member.status).label}
                </Badge>
              </div>
            ))
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>关闭</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

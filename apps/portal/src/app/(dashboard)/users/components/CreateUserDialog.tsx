'use client';

/**
 * 新建用户弹窗（薄包装）
 *
 * 长表单已抽到 CreateUserForm 并页面化到 /users/new；这里只负责弹窗开关，
 * 保留给工作台 /users?create=1 的快捷入口与现有对话框测试。
 */

import { useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { USER_PERMISSIONS } from '@auth-sso/contracts';
import { CreateUserForm } from './CreateUserForm';

interface CreateUserDialogProps {
  departments: { id: string; name: string }[];
  canAssignRole?: boolean;
  autoOpen?: boolean;
  initialDeptId?: string;
}

export default function CreateUserDialog({ departments, canAssignRole = false, autoOpen = false, initialDeptId }: CreateUserDialogProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isOpen, setIsOpen] = useState(autoOpen);

  const closeDialog = () => {
    setIsOpen(false);
    if (!autoOpen) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete('create');
    const qs = params.toString();
    router.replace(`/users${qs ? `?${qs}` : ''}`);
  };

  return (
    <>
      <PermissionGuard permission={USER_PERMISSIONS.CREATE}>
        <Button aria-label="新建用户" onClick={() => setIsOpen(true)}>
          <UserPlus className="h-4 w-4" /> 新建用户
        </Button>
      </PermissionGuard>

      <Dialog open={isOpen} onOpenChange={(open) => { setIsOpen(open); if (!open) closeDialog(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>新建用户</DialogTitle>
            <DialogDescription className="font-medium text-muted-foreground">
              长表单请使用完整页面；此处保留快捷创建入口。
            </DialogDescription>
          </DialogHeader>
          <CreateUserForm
            departments={departments}
            canAssignRole={canAssignRole}
            initialDeptId={initialDeptId}
            onCancel={closeDialog}
            onSuccess={() => { closeDialog(); router.refresh(); }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

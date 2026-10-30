'use client';

import { useRouter } from 'next/navigation';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** 进入页面化新建用户表单；保留 button 语义，避免把导航入口变成弹窗。 */
export function CreateUserButton({ deptId }: { deptId?: string }) {
  const router = useRouter();
  return (
    <Button onClick={() => router.push(`/users/new${deptId ? `?deptId=${deptId}` : ''}`)}>
      <UserPlus className="h-4 w-4" /> 新建用户
    </Button>
  );
}

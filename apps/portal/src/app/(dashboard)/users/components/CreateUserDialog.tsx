'use client';

/**
 * 创建新用户弹窗组件
 * 基于 React 19 useActionState 与 Form Actions 绑定薄控制器 Server Action
 */

import { useState, useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionGuard } from '@/components/ui/permission-guard';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select';
import { createUserAction } from '../actions';

/**
 * 局部组件：基于 React 19 useFormStatus 感知表单提交态
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}
      className="flex-1 rounded-xl shadow-lg shadow-primary/20"
    >
      {pending ? '正在创建...' : '确认创建'}
    </Button>
  );
}

interface CreateUserDialogProps {
  /** 部门列表，用于下拉选择 */
  departments: { id: string; name: string }[];
}

export default function CreateUserDialog({ departments }: CreateUserDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [deptId, setDeptId] = useState('');

  // 绑定 React 19 Action
  const [state, formAction, isPending] = useActionState(
    async (prevState: any, formData: FormData) => {
      formData.set('deptId', deptId);
      return await createUserAction(prevState, formData);
    },
    null
  );

  // 感知 Action 结果并响应（依赖原始值避免不必要的 effect 重跑）
  useEffect(() => {
    if (!state) return;
    if (state.success) {
      toast.success(state.message || '用户创建成功');
      setIsOpen(false);
      setDeptId(''); // 重置部门选择
    } else {
      toast.error(state.message || '创建用户失败');
    }
  }, [state?.success, state?.message]);

  return (
    <>
      <PermissionGuard permission="user:create">
        <Button
          className="rounded-xl h-11 px-6 shadow-lg shadow-primary/20"
          onClick={() => setIsOpen(true)}
        >
          <UserPlus className="mr-2 h-4 w-4" /> 新增用户
        </Button>
      </PermissionGuard>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent className="sm:max-w-[500px] rounded-2xl">
          <form action={formAction}>
            <DialogHeader className="pb-6 border-b">
              <DialogTitle className="text-2xl font-black text-slate-900">创建新用户</DialogTitle>
              <DialogDescription className="text-slate-500 font-medium">
                输入用户的基本信息以创建新的系统账号。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 py-8">
              <div className="space-y-2">
                <Label htmlFor="name" className="font-bold text-slate-700">显示名称</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  className="h-11 rounded-xl focus:ring-2 focus:ring-primary/10 transition-all"
                  placeholder="例如：张三"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username" className="font-bold text-slate-700">登录账号 (Username)</Label>
                <Input
                  id="username"
                  name="username"
                  required
                  className="h-11 rounded-xl font-mono"
                  placeholder="例如：zhangsan"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" className="font-bold text-slate-700">电子邮箱</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  required
                  className="h-11 rounded-xl"
                  placeholder="zhangsan@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="font-bold text-slate-700">初始密码</Label>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  required
                  defaultValue="password123"
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deptId" className="font-bold text-slate-700">所属部门</Label>
                <Select value={deptId} onValueChange={setDeptId}>
                  <SelectTrigger className="h-11 rounded-xl">
                    <SelectValue placeholder="选择用户所在部门（可选）" />
                  </SelectTrigger>
                  <SelectContent className="rounded-xl">
                    <SelectItem value="ALL">不分配部门</SelectItem>
                    {departments.map(dept => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="border-t bg-slate-50/50 flex gap-3 pt-4">
              <Button
                type="button"
                variant="ghost"
                className="flex-1 rounded-xl"
                onClick={() => setIsOpen(false)}
                disabled={isPending}
              >
                取消
              </Button>
              <SubmitButton />
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

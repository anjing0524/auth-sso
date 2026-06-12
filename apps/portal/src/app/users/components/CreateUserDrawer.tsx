'use client';

/**
 * 创建新用户抽屉组件
 * 基于 React 19 useActionState 与 Form Actions 绑定薄控制器 Server Action
 */

import React, { useState, useEffect, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { toast } from 'sonner';
import { UserPlus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PermissionGuard } from '@/components/ui/permission-guard';
import { 
  Sheet, 
  SheetContent, 
  SheetHeader, 
  SheetTitle, 
  SheetDescription,
  SheetFooter
} from '@/components/ui/sheet';
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

interface CreateUserDrawerProps {
  /** 部门列表，用于下拉选择 */
  departments: { id: string; name: string }[];
}

export default function CreateUserDrawer({ departments }: CreateUserDrawerProps) {
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

  // 感知 Action 结果并响应
  useEffect(() => {
    if (!state) return;
    if (state.success) {
      toast.success(state.message || '用户创建成功');
      setIsOpen(false);
      setDeptId(''); // 重置部门选择
    } else {
      toast.error(state.message || '创建用户失败');
    }
  }, [state]);

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

      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent className="sm:max-w-[500px]">
          <form action={formAction} className="h-full flex flex-col justify-between">
            <div>
              <SheetHeader className="pb-6 border-b">
                <SheetTitle className="text-2xl font-black text-slate-900">创建新用户</SheetTitle>
                <SheetDescription className="text-slate-500 font-medium">
                  输入用户的基本信息以创建新的系统账号。
                </SheetDescription>
              </SheetHeader>
              
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
            </div>

            <SheetFooter className="absolute bottom-0 left-0 right-0 p-6 border-t bg-slate-50/50 flex gap-3">
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
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

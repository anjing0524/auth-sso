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
import { PermissionGuard } from '@/components/shared/permission-guard';
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
import { USER_PERMISSIONS, type ApiResponse } from '@auth-sso/contracts';
import { createUserAction } from '../actions';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { FieldError } from '@/components/shared/field-error';
import { userFacingMessage } from './user-error-copy';

/**
 * 局部组件：基于 React 19 useFormStatus 感知表单提交态
 */
function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      disabled={pending}

    >
      {pending ? '创建中...' : '创建'}
    </Button>
  );
}

interface CreateUserDialogProps {
  /** 部门列表，用于下拉选择 */
  departments: { id: string; name: string }[];
}

export default function CreateUserDialog({ departments }: CreateUserDialogProps) {
  const [isOpen, setIsOpen] = useState(false);
  /**
   * 部门**必填**：ADR-002 的数据范围 = 角色部门子树，`users.dept_id = NULL` 的用户
   * 不在任何角色子树内 ⇒ 创建后对所有管理员都不可见（审计 P1-2 实测）。
   * 因此默认选中第一个部门，不再提供「不分配部门」。
   */
  const [deptId, setDeptId] = useState(departments[0]?.id ?? '');
  /**
   * **受控字段**：React 19 的 `<form action={fn}>` 在 action 结束后会自动 reset 表单。
   * 若不接管 value，一次校验失败就会把用户填的姓名/账号/邮箱/密码全部清空
   * （实测：重复邮箱报错后第二次点"创建"只会被 HTML5 required 静默拦住，看起来"功能坏了"）。
   */
  const [values, setValues] = useState({ name: '', username: '', email: '', password: '' });
  const setField = (field: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [field]: e.target.value }));

  // 绑定 React 19 Action：state 类型 = Action 返回值（ApiResponse）。
  // 提交走 createUserAction 的 FormData 双签名路径（firstArg 显式 null）——
  // 此前把 useActionState 的 state（首轮 null，其后为 ApiResponse）直接透传给
  // firstArg，类型上是"ApiResponse 冒充 CreateUserInput"的失配。
  const [state, formAction, isPending] = useActionState<
    ApiResponse<{ id: string }> | null,
    FormData
  >(
    async (_prevState, formData) => {
      formData.set('deptId', deptId);
      return await createUserAction(null, formData);
    },
    null
  );

  // 服务端给的是**具体**码（#82 接通、#92 消费）：能落到本表单某个输入框的就落到那里，
  // 落不到的（403/500，或本表单没有该字段）才走 toast——两者不重复提示。
  // 字段清单是**参数**：本表单只有 username/email/password（不采集 mobile）。
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['username', 'email', 'password']);

  // 感知 Action 结果并响应：`state` 每次提交完成都会有新身份 ⇒ 用它作依赖；
  // `reportFailure` 已由 hook 用 useCallback 稳定（依赖它不会造成多余重跑）
  useEffect(() => {
    if (!state) return;
    queueMicrotask(() => {
      if (state.success) {
        toast.success(`用户创建成功；登录邮箱：${values.email}`);
        setIsOpen(false);
        setDeptId('');
        setValues({ name: '', username: '', email: '', password: '' });
      } else {
        // 就地显示还是 toast，由 hook 按"本表单字段清单"判断（不依赖上一次的状态）
        reportFailure({ error: state.error, message: userFacingMessage({ error: state.error, message: state.message }, '创建用户失败') });
      }
    });
  }, [state, reportFailure]);

  return (
    <>
      <PermissionGuard permission={USER_PERMISSIONS.CREATE}>
        <Button
          aria-label="新建用户"
          onClick={() => { clearFailure(); setValues({ name: '', username: '', email: '', password: '' }); setIsOpen(true); }}
        >
          <UserPlus className="h-4 w-4" /> 新建用户
        </Button>
      </PermissionGuard>

      <Dialog open={isOpen} onOpenChange={setIsOpen}>
        <DialogContent>
          <form action={formAction} className="space-y-3">
            <DialogHeader>
              <DialogTitle>新建用户</DialogTitle>
              <DialogDescription className="text-muted-foreground font-medium">
                创建后请把<strong>登录邮箱</strong>告知用户；用户名用于审计与接口标识。
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3">
              <div className="space-y-2">
                <Label htmlFor="name" >显示名称</Label>
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={100}
                  placeholder="例如：张三"
                  value={values.name}
                  onChange={setField('name')}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="username" >用户名（唯一标识）</Label>
                <Input
                  aria-invalid={fieldError?.field === 'username'}
                  id="username"
                  name="username"
                  required
                  maxLength={50}
                  className="font-mono"
                  placeholder="例如：zhangsan"
                  value={values.username}
                  onChange={setField('username')}
                />
                <FieldError failure={fieldError} field="username" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email" >电子邮箱</Label>
                <Input
                  aria-invalid={fieldError?.field === 'email'}
                  id="email"
                  name="email"
                  type="email"
                  required
                  maxLength={255}
                  placeholder="zhangsan@example.com"
                  value={values.email}
                  onChange={setField('email')}
                />
                <FieldError failure={fieldError} field="email" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" >初始密码</Label>
                <Input
                  aria-invalid={fieldError?.field === 'password'}
                  id="password"
                  name="password"
                  type="password"
                  required
                  autoComplete="new-password"
                  value={values.password}
                  onChange={setField('password')}
                />
                <FieldError failure={fieldError} field="password" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="deptId" >所属部门</Label>
                <Select value={deptId} onValueChange={setDeptId}>
                  <SelectTrigger aria-label="所属部门">
                    <SelectValue>
                      {departments.find(d => d.id === deptId)?.name ?? departments[0]?.name}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {departments.map(dept => (
                      <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
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

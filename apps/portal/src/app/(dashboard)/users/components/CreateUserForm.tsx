'use client';

/**
 * 新建用户表单（页面与弹窗共用）
 *
 * 产品规则：长表单优先页面化（/users/new）；CreateUserDialog 仅作为薄包装保留，
 * 不再承载独立表单逻辑。
 */

import { useEffect, useRef, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequiredLegend, RequiredMark } from '@/components/shared/required-mark';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createUserAction } from '../actions';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { FieldError } from '@/components/shared/field-error';
import { userFacingMessage } from './user-error-copy';
import type { ApiResponse } from '@auth-sso/contracts';

function SubmitButton() {
  const { pending } = useFormStatus();
  return <Button type="submit" disabled={pending}>{pending ? '创建中...' : '创建'}</Button>;
}

interface CreateUserFormProps {
  departments: { id: string; name: string }[];
  canAssignRole?: boolean;
  initialDeptId?: string;
  successHref?: string;
  onSuccess?: (createdId?: string) => void;
  onCancel?: () => void;
  cancelHref?: string;
}

export function CreateUserForm({
  departments,
  canAssignRole = false,
  initialDeptId,
  successHref,
  onSuccess,
  onCancel,
  cancelHref,
}: CreateUserFormProps) {
  const router = useRouter();
  const defaultDeptId = initialDeptId && departments.some((d) => d.id === initialDeptId)
    ? initialDeptId
    : departments[0]?.id ?? '';
  const [deptId, setDeptId] = useState(defaultDeptId);
  const [values, setValues] = useState({ name: '', username: '', email: '', password: '' });
  const setField = (field: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [field]: e.target.value }));

  const [state, formAction, isPending] = useActionState<ApiResponse<{ id: string }> | null, FormData>(
    async (_prevState, formData) => {
      formData.set('deptId', deptId);
      return await createUserAction(null, formData);
    },
    null,
  );

  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['username', 'email', 'password']);
  const onSuccessRef = useRef(onSuccess);
  useEffect(() => { onSuccessRef.current = onSuccess; }, [onSuccess]);

  useEffect(() => {
    if (!state) return;
    queueMicrotask(() => {
      if (state.success) {
        const createdId = state.data?.id;
        toast.success(`用户创建成功；登录邮箱：${values.email}`, {
          ...(canAssignRole && createdId
            ? { action: { label: '分配角色', onClick: () => router.push(`/users/${createdId}/roles`) } }
            : {}),
        });
        if (successHref) router.push(successHref);
        onSuccessRef.current?.(createdId);
      } else {
        reportFailure({ error: state.error, message: userFacingMessage({ error: state.error, message: state.message }, '创建用户失败') });
      }
    });
  }, [state, reportFailure, values.email, canAssignRole, router, successHref]);

  useEffect(() => {
    if (!fieldError) return;
    const inputId = fieldError.field === 'username'
      ? 'create-user-username'
      : fieldError.field === 'email'
        ? 'create-user-email'
        : fieldError.field === 'password'
          ? 'create-user-password'
          : null;
    if (inputId) requestAnimationFrame(() => document.getElementById(inputId)?.focus());
  }, [fieldError]);

  return (
    <form action={formAction} className="space-y-4" onSubmit={() => clearFailure()}>
      <p className="text-[11px] text-muted-foreground">
        创建后请把<strong>登录邮箱</strong>告知用户；用户名用于审计与接口标识。<RequiredLegend />
      </p>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5 sm:col-span-2">
          <div className="flex items-center gap-1"><Label htmlFor="create-user-name">显示名称</Label><RequiredMark /></div>
          <Input id="create-user-name" name="name" required maxLength={100} placeholder="例如：张三" value={values.name} onChange={setField('name')} />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1"><Label htmlFor="create-user-username">用户名（唯一标识）</Label><RequiredMark /></div>
          <Input
            aria-invalid={fieldError?.field === 'username'}
            aria-describedby={fieldError?.field === 'username' ? 'create-user-username-error' : undefined}
            id="create-user-username" name="username" required maxLength={50} className="font-mono"
            placeholder="例如：zhangsan" value={values.username} onChange={setField('username')}
          />
          <p className="text-[11px] text-muted-foreground">3–50 位，创建后不可修改。</p>
          <FieldError failure={fieldError} field="username" id="create-user-username-error" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1"><Label htmlFor="create-user-email">电子邮箱</Label><RequiredMark /></div>
          <Input
            aria-invalid={fieldError?.field === 'email'}
            aria-describedby={fieldError?.field === 'email' ? 'create-user-email-error' : undefined}
            id="create-user-email" name="email" type="email" required maxLength={255}
            placeholder="zhangsan@example.com" value={values.email} onChange={setField('email')}
          />
          <FieldError failure={fieldError} field="email" id="create-user-email-error" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1"><Label htmlFor="create-user-password">初始密码</Label><RequiredMark /></div>
          <Input
            aria-invalid={fieldError?.field === 'password'}
            aria-describedby={fieldError?.field === 'password' ? 'create-user-password-error' : undefined}
            id="create-user-password" name="password" type="password" required autoComplete="new-password"
            value={values.password} onChange={setField('password')}
          />
          <p className="text-[11px] text-muted-foreground">至少 10 位，含大写/小写字母、数字、特殊字符中的至少三类</p>
          <FieldError failure={fieldError} field="password" id="create-user-password-error" />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1"><Label htmlFor="create-user-deptId">所属部门</Label><RequiredMark /></div>
          <Select value={deptId} onValueChange={setDeptId}>
            <SelectTrigger id="create-user-deptId" aria-label="所属部门" aria-required="true">
              <SelectValue>{departments.find((d) => d.id === deptId)?.name ?? departments[0]?.name}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {departments.map((dept) => <SelectItem key={dept.id} value={dept.id}>{dept.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>取消</Button>
        ) : cancelHref ? (
          <Button asChild variant="outline"><Link href={cancelHref}>取消</Link></Button>
        ) : null}
        <SubmitButton />
      </div>
    </form>
  );
}

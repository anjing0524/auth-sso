'use client';

/**
 * 新建用户表单（页面与弹窗共用）
 *
 * 产品规则：长表单页面化（/users/new），不再放入弹窗。
 *
 * 2026-11-06 走查修复：
 * - PM-02：接入 useUnsavedChangesGuard（任一字段非空或部门与初始值不同即视为脏）；
 * - PM-05：初始密码支持可见性切换与「生成强密码」，并说明首登强制改密（既有行为）；
 * - UX-06：操作区统一为 FormActionBar；
 * - UX-24：控件补齐 name / autocomplete 语义。
 */

import { useEffect, useRef, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Eye, EyeOff, Save, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RequiredLegend, RequiredMark } from '@/components/shared/required-mark';
import { FormActionBar } from '@/components/shared/form-action-bar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { createUserAction } from '../actions';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';
import { FieldError } from '@/components/shared/field-error';
import { userFacingMessage } from './user-error-copy';
import type { ApiResponse } from '@auth-sso/contracts';

const PASSWORD_LOWER = 'abcdefghijkmnopqrstuvwxyz';
const PASSWORD_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const PASSWORD_DIGITS = '23456789';
const PASSWORD_SYMBOLS = '!@#$%^&*-_=+';

function randomIndex(max: number): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0]! % max;
}

/**
 * 生成满足领域密码策略（≥10 位、四类字符中至少三类）的随机密码。
 * 固定取 16 位并先为四类各取一位，再洗牌，保证复杂度同时不削弱随机性。
 */
export function generateStrongPassword(length = 16): string {
  const sets = [PASSWORD_LOWER, PASSWORD_UPPER, PASSWORD_DIGITS, PASSWORD_SYMBOLS];
  const chars = sets.map((set) => set[randomIndex(set.length)]!);
  const pool = sets.join('');
  while (chars.length < Math.max(length, sets.length)) {
    chars.push(pool[randomIndex(pool.length)]!);
  }
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = randomIndex(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      <Save className="h-3.5 w-3.5" />
      {pending ? '创建中...' : '创建'}
    </Button>
  );
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

const EMPTY_VALUES: { name: string; username: string; email: string; password: string } = {
  name: '', username: '', email: '', password: '',
};

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
  const [values, setValues] = useState({ ...EMPTY_VALUES });
  const [passwordVisible, setPasswordVisible] = useState(false);
  const setField = (field: keyof typeof values) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setValues((prev) => ({ ...prev, [field]: e.target.value }));

  // PM-02：与其它表单页同一语义——填过任何字段或改过部门即需离开确认。
  const isDirty = Object.values(values).some((value) => value.trim() !== '') || deptId !== defaultDeptId;
  const leaveGuard = useUnsavedChangesGuard(isDirty);

  const handleGeneratePassword = () => {
    const password = generateStrongPassword();
    setValues((prev) => ({ ...prev, password }));
    setPasswordVisible(true);
    toast.success('已生成强密码，请保存后告知用户');
  };

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
    <form action={formAction} className="flex min-h-0 flex-1 flex-col gap-3" onSubmit={() => clearFailure()}>
      <Card className="mx-auto w-full max-w-2xl gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
        <CardContent className="space-y-4 p-4 sm:p-6">
          <p className="text-[11px] text-muted-foreground">
            创建后请把<strong>登录邮箱</strong>告知用户；用户名用于审计与接口标识。<RequiredLegend />
          </p>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2 sm:col-span-2">
              <div className="flex items-center gap-1"><Label htmlFor="create-user-name">显示名称</Label><RequiredMark /></div>
              <Input
                id="create-user-name"
                name="name"
                autoComplete="name"
                required
                maxLength={100}
                placeholder="例如：张三"
                value={values.name}
                onChange={setField('name')}
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1"><Label htmlFor="create-user-username">用户名（唯一标识）</Label><RequiredMark /></div>
              <Input
                aria-invalid={fieldError?.field === 'username'}
                aria-describedby={fieldError?.field === 'username' ? 'create-user-username-error' : undefined}
                id="create-user-username" name="username" autoComplete="username" required maxLength={50} className="font-mono"
                placeholder="例如：zhangsan" value={values.username} onChange={setField('username')}
              />
              <p className="text-[11px] text-muted-foreground">3–50 位，创建后不可修改。</p>
              <FieldError failure={fieldError} field="username" id="create-user-username-error" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1"><Label htmlFor="create-user-email">电子邮箱</Label><RequiredMark /></div>
              <Input
                aria-invalid={fieldError?.field === 'email'}
                aria-describedby={fieldError?.field === 'email' ? 'create-user-email-error' : undefined}
                id="create-user-email" name="email" type="email" autoComplete="email" required maxLength={255}
                placeholder="zhangsan@example.com" value={values.email} onChange={setField('email')}
              />
              <FieldError failure={fieldError} field="email" id="create-user-email-error" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1"><Label htmlFor="create-user-password">初始密码</Label><RequiredMark /></div>
              <div className="flex flex-wrap items-start gap-2">
                <div className="relative min-w-0 flex-1">
                  <Input
                    aria-invalid={fieldError?.field === 'password'}
                    aria-describedby={fieldError?.field === 'password' ? 'create-user-password-error' : undefined}
                    id="create-user-password" name="password"
                    type={passwordVisible ? 'text' : 'password'}
                    autoComplete="new-password" required
                    className="pr-9"
                    value={values.password} onChange={setField('password')}
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={passwordVisible ? '隐藏密码' : '显示密码'}
                    aria-pressed={passwordVisible}
                    title={passwordVisible ? '隐藏密码' : '显示密码'}
                    className="absolute right-1 top-1/2 -translate-y-1/2"
                    onClick={() => setPasswordVisible((visible) => !visible)}
                  >
                    {passwordVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                  </Button>
                </div>
                <Button type="button" variant="outline" size="sm" className="h-9 shrink-0" onClick={handleGeneratePassword}>
                  <Sparkles className="h-3.5 w-3.5" /> 生成强密码
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground">
                至少 10 位，含大写/小写字母、数字、特殊字符中的至少三类。新用户首次登录会被强制修改密码；邮件邀请尚未接入，请创建后线下告知用户。
              </p>
              <FieldError failure={fieldError} field="password" id="create-user-password-error" />
            </div>
            <div className="space-y-2">
              <div className="flex items-center gap-1"><Label htmlFor="create-user-deptId">所属部门</Label><RequiredMark /></div>
              <input type="hidden" name="deptId" value={deptId} />
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
        </CardContent>
      </Card>

      <FormActionBar
        isDirty={isDirty}
        hint={<span className="text-[11px] text-muted-foreground">创建后需要为该用户分配角色才能访问业务应用。</span>}
      >
        {onCancel ? (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isPending}>取消</Button>
        ) : cancelHref ? (
          <Button asChild variant="outline"><Link href={cancelHref}>取消</Link></Button>
        ) : null}
        <SubmitButton />
      </FormActionBar>

      {leaveGuard}
    </form>
  );
}

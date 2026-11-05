'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { changeOwnPasswordAction } from '@/app/(dashboard)/profile/actions';

interface ForcePasswordChangeFormProps {
  name: string;
  email: string | null;
}

/** 首登强制改密表单：当前密码 + 新密码 + 确认；成功后整页回登录页。 */
export function ForcePasswordChangeForm({ name, email }: ForcePasswordChangeFormProps) {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致');
      return;
    }
    setPending(true);
    try {
      const result = await changeOwnPasswordAction({ currentPassword, newPassword });
      if (!result.success) {
        setError(result.message);
        return;
      }
      // 改密已撤销全部会话；整页返回登录页，确保旧 JWT Cookie 不再被登录页读取。
      window.location.replace(new URL('/login', window.location.origin).toString());
    } catch (err) {
      setError(err instanceof Error ? err.message : '改密失败，请稍后重试');
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-[#F4F7FB] px-6">
      <section className="w-full max-w-[420px] rounded-lg border border-border/70 bg-white p-6 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
          Security check
        </p>
        <h1 className="mt-2 text-[22px] font-semibold tracking-tight text-foreground">请先修改初始密码</h1>
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {name}（{email ?? '当前账号'}）使用的是初始密码或管理员重置后的临时密码。
          完成修改前，工作台与写操作均不可用。
        </p>

        <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="force-current-password">当前密码</Label>
            <Input
              id="force-current-password"
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="force-new-password">新密码</Label>
            <Input
              id="force-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
            />
            <p className="type-meta">至少 10 位，包含大写、小写、数字、符号中的 3 类。</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="force-confirm-password">确认新密码</Label>
            <Input
              id="force-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
            />
          </div>
          {error ? (
            <Alert variant="destructive" role="alert">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? '提交中...' : '修改密码并重新登录'}
          </Button>
        </form>
      </section>
    </main>
  );
}

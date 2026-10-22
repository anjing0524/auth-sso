'use client';

/**
 * 管理员重置用户密码（FR-USR-09 / B-USR-PW）
 *
 * 后端 `resetPasswordAction` 早已存在（含密码策略、历史密码校验、会话全量失效），
 * 但**没有 UI 入口**——属于"后端能力未接线"。本组件补上入口。
 */
import { useState } from 'react';
import { toast } from 'sonner';
import { KeyRound } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FieldError } from '@/components/shared/field-error';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useFieldFailure } from '@/hooks/use-field-failure';

import { resetPasswordAction } from '../actions';

export function ResetPasswordDialog({
  userId,
  userName,
}: {
  userId: string;
  userName: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [saving, setSaving] = useState(false);
  const { fieldError, reportFailure, clearFailure } = useFieldFailure(['password']);

  const submit = async () => {
    if (password !== confirm) {
      toast.error('两次输入的密码不一致');
      return;
    }
    clearFailure();
    setSaving(true);
    try {
      const res = await resetPasswordAction(userId, password);
      if (res.success) {
        toast.success(`已重置「${userName}」的密码，该用户所有会话已失效`);
        setOpen(false);
        setPassword('');
        setConfirm('');
      } else {
        reportFailure(res);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="outline" />}>
        <KeyRound className="h-4 w-4" /> 重置密码
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>重置用户密码</DialogTitle>
          <DialogDescription>
            为「{userName}」设置新密码。重置后该用户的所有活跃会话立即失效，须用新密码重新登录。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="reset-password">新密码</Label>
            <Input
              id="reset-password"
              type="password"
              autoComplete="new-password"
              placeholder="至少 8 位，含大小写字母与数字"
              value={password}
              aria-invalid={fieldError?.field === 'password'}
              onChange={(e) => setPassword(e.target.value)}
            />
            <FieldError failure={fieldError} field="password" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="reset-password-confirm">确认新密码</Label>
            <Input
              id="reset-password-confirm"
              type="password"
              autoComplete="new-password"
              placeholder="再次输入新密码"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            取消
          </Button>
          <Button onClick={submit} disabled={saving || !password || !confirm}>
            {saving ? '重置中...' : '确认重置'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

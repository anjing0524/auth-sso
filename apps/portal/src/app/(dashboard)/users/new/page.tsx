/**
 * 创建新用户页面
 *
 * 原因：useActionState 在此场景引入 wrapper 函数 + useEffect + 独立 SubmitButton 组件 +
 * hidden input 桥接，省掉的仅是一个 handleCreate 函数。净增复杂度，不是甜点区。
 * 保持 useState 受控表单 + 手动 handleCreate 的简洁模式。
 */
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  User as UserIcon, ArrowLeft, UserPlus, Eye, EyeOff,
} from 'lucide-react';
import Link from 'next/link';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

import { createUserAction } from '../actions';

export default function NewUserPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    username: '',
    email: '',
    password: '',
    deptId: null as string | null,
  });

  const handleCreate = async () => {
    if (!formData.name || !formData.username || !formData.email || !formData.password) {
      toast.error('请填写必填字段');
      return;
    }
    setSaving(true);
    try {
      const res = await createUserAction(formData);
      if (res.success) {
        toast.success('用户创建成功');
        router.push('/users');
      } else {
        toast.error(res.message || '创建失败');
      }
    } catch {
      toast.error('创建失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" asChild>
            <Link href="/users" aria-label="返回用户列表"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-foreground">新增用户</h1>
            <p className="text-muted-foreground text-sm font-medium">创建新的系统账户并分配初始角色。</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl">
        <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-2xl overflow-hidden bg-white mb-20">
          <CardHeader className="border-b bg-muted/50">
            <CardTitle className="text-lg font-black flex items-center gap-2">
              <UserIcon className="h-5 w-5 text-primary" /> 基本资料
            </CardTitle>
            <CardDescription>设置用户的基本身份信息和初始凭证。</CardDescription>
          </CardHeader>
          <CardContent className="p-8 space-y-6">
            <div className="grid gap-6 sm:grid-cols-2 sm:gap-8">
              <div className="space-y-2">
                <Label htmlFor="new-user-name" className="font-bold text-foreground/80">显示名称 <span className="text-destructive">*</span></Label>
                <Input id="new-user-name" placeholder="例如：张三" value={formData.name}
                  onChange={e => setFormData({...formData, name: e.target.value})}
                  className="h-11 rounded-lg focus:ring-2 focus:ring-primary/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-user-username" className="font-bold text-foreground/80">登录账号 <span className="text-destructive">*</span></Label>
                <Input id="new-user-username" placeholder="zhangsan" value={formData.username}
                  onChange={e => setFormData({...formData, username: e.target.value})}
                  className="h-11 rounded-lg focus:ring-2 focus:ring-primary/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-user-email" className="font-bold text-foreground/80">电子邮箱 <span className="text-destructive">*</span></Label>
                <Input id="new-user-email" type="email" placeholder="zhangsan@example.com" value={formData.email}
                  onChange={e => setFormData({...formData, email: e.target.value})}
                  className="h-11 rounded-lg focus:ring-2 focus:ring-primary/10" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-user-password" className="font-bold text-foreground/80">初始密码 <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input id="new-user-password" type={showPassword ? 'text' : 'password'} placeholder="••••••••"
                    value={formData.password}
                    onChange={e => setFormData({...formData, password: e.target.value})}
                    className="h-11 rounded-lg focus:ring-2 focus:ring-primary/10 pr-10" />
                  <button type="button" onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? '隐藏密码' : '显示密码'}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground/70">
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="fixed bottom-0 left-0 right-0 md:left-64 bg-card/80 backdrop-blur-md border-t border-border p-4 px-8 flex justify-end gap-4 z-50 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <Button variant="ghost" className="rounded-lg px-6" asChild>
          <Link href="/users">取消</Link>
        </Button>
        <Button onClick={handleCreate} disabled={saving} className="rounded-lg px-8 shadow-lg shadow-primary/20">
          {saving ? '创建中...' : <><UserPlus className="mr-2 h-4 w-4" /> 确认创建</>}
        </Button>
      </div>
    </div>
  );
}

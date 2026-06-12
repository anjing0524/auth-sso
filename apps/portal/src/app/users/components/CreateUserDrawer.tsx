'use client';

/**
 * 创建新用户抽屉组件
 * 基于客户端 Fetch 访问 API 路由，易于前后端分离与系统迁移
 */

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
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

interface CreateUserDrawerProps {
  /** 部门列表，用于下拉选择 */
  departments: { id: string; name: string }[];
}

export default function CreateUserDrawer({ departments }: CreateUserDrawerProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  
  // 表单状态双向绑定
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('password123');
  const [deptId, setDeptId] = useState('');

  /**
   * 重置表单状态
   */
  const resetForm = () => {
    setName('');
    setUsername('');
    setEmail('');
    setPassword('password123');
    setDeptId('');
  };

  /**
   * 客户端提交表单：发起原生 fetch 请求 API 路由
   */
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !username || !email || !password) {
      return toast.error('请填写完整信息');
    }

    setLoading(true);
    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          username,
          email,
          password,
          deptId: deptId === 'ALL' ? '' : deptId // 转换不分配部门
        })
      });

      const result = await response.json();

      if (response.ok) {
        toast.success('用户创建成功');
        setIsOpen(false);
        resetForm();
        // 关键：利用 Next.js 路由刷新机制，让 Server Component 重新加载最新数据，实现无感局部刷新
        router.refresh();
      } else {
        toast.error(result.message || '创建用户失败');
      }
    } catch (error) {
      console.error('Failed to create user:', error);
      toast.error('请求失败，请检查网络');
    } finally {
      setLoading(false);
    }
  };

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

      <Sheet open={isOpen} onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) resetForm();
      }}>
        <SheetContent className="sm:max-w-[500px]">
          <form onSubmit={handleSubmit} className="h-full flex flex-col justify-between">
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
                    value={name}
                    onChange={e => setName(e.target.value)}
                    required
                    className="h-11 rounded-xl focus:ring-2 focus:ring-primary/10 transition-all"
                    placeholder="例如：张三" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="username" className="font-bold text-slate-700">登录账号 (Username)</Label>
                  <Input 
                    id="username"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    required
                    className="h-11 rounded-xl font-mono"
                    placeholder="例如：zhangsan" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="font-bold text-slate-700">电子邮箱</Label>
                  <Input 
                    id="email"
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    required
                    className="h-11 rounded-xl"
                    placeholder="zhangsan@example.com" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="font-bold text-slate-700">初始密码</Label>
                  <Input 
                    id="password"
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
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
                disabled={loading}
              >
                取消
              </Button>
              <Button 
                type="submit"
                disabled={loading}
                className="flex-1 rounded-xl shadow-lg shadow-primary/20"
              >
                {loading ? '正在创建...' : '确认创建'}
              </Button>
            </SheetFooter>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
}

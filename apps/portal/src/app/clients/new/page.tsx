/**
 * 注册新 OAuth 应用页面 — Client Component 表单
 * 写操作通过 Server Actions (actions.ts) 直调
 */
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, AppWindow, Plus } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClientAction } from '../actions';

export default function NewClientPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    redirectUris: '',
    scopes: 'openid profile email',
    homepageUrl: '',
    logoUrl: '',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
    skipConsent: false,
  });

  const handleCreate = async () => {
    if (!formData.name || !formData.redirectUris) {
      toast.error('请填写必填字段');
      return;
    }

    setSaving(true);
    const result = await createClientAction({
      name: formData.name,
      redirectUris: formData.redirectUris.split('\n').filter(Boolean),
      scopes: formData.scopes,
      homepageUrl: formData.homepageUrl || null,
      logoUrl: formData.logoUrl || null,
      accessTokenTtl: formData.accessTokenTtl,
      refreshTokenTtl: formData.refreshTokenTtl,
      skipConsent: formData.skipConsent,
    });

    setSaving(false);

    if (result.success) {
      toast.success(result.message || '应用注册成功');
      router.push('/clients');
    } else {
      toast.error(result.message || '注册失败');
    }
  };

  return (
    <div className="space-y-8 pb-10">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" asChild>
            <Link href="/clients"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-slate-900">注册新应用</h1>
            <p className="text-muted-foreground text-sm font-medium">注册新的 OAuth 2.1 客户端以接入单点登录系统。</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" className="rounded-xl px-6" asChild>
            <Link href="/clients">取消</Link>
          </Button>
          <Button onClick={handleCreate} disabled={saving} className="rounded-xl px-8 shadow-lg shadow-primary/20">
            {saving ? '注册中...' : <><Plus className="mr-2 h-4 w-4" /> 确认注册</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-8 space-y-8">
          <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="border-b bg-slate-50/30">
              <CardTitle className="text-lg font-black flex items-center gap-2">
                <AppWindow className="h-5 w-5 text-primary" /> 基本配置
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-2 col-span-2">
                  <Label className="font-bold text-slate-700">应用名称 <span className="text-red-500">*</span></Label>
                  <Input
                    placeholder="我的业务系统"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="h-11 rounded-xl"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label className="font-bold text-slate-700">回调地址 (Redirect URIs) <span className="text-red-500">*</span></Label>
                  <Textarea
                    placeholder="http://localhost:3000/api/auth/callback&#10;证书和密钥由系统自动生成"
                    value={formData.redirectUris}
                    onChange={e => setFormData({...formData, redirectUris: e.target.value})}
                    className="min-h-[100px] rounded-xl"
                  />
                  <p className="text-xs text-muted-foreground">每行一个地址。Client ID 与 Secret 由系统自动生成，创建成功后展示。</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-4 space-y-6">
          <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black uppercase tracking-widest text-slate-400">高级安全设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label className="font-bold text-slate-700">默认权限范围 (Scopes)</Label>
                <Input
                  value={formData.scopes}
                  onChange={e => setFormData({...formData, scopes: e.target.value})}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="space-y-2">
                <Label className="font-bold text-slate-700">Access Token TTL (秒)</Label>
                <Input
                  type="number"
                  value={formData.accessTokenTtl}
                  onChange={e => setFormData({...formData, accessTokenTtl: parseInt(e.target.value)})}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="flex items-center space-x-2">
                <input
                  type="checkbox"
                  id="skipConsent"
                  checked={formData.skipConsent}
                  onChange={e => setFormData({ ...formData, skipConsent: e.target.checked })}
                  className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                />
                <label htmlFor="skipConsent" className="text-sm font-medium text-slate-700">
                  跳过用户授权确认
                </label>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

/**
 * 注册新 OAuth 应用页面 — Client Component 表单
 * 写操作通过 Server Actions (actions.ts) 直调
 */
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowLeft, AppWindow, Copy, KeyRound, Plus } from 'lucide-react';
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
  const [createdCredentials, setCreatedCredentials] = useState<{
    clientId: string;
    clientSecret: string;
  } | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    redirectUris: '',
    scopes: 'openid profile email',
    homepageUrl: '',
    logoUrl: '',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
  });

  const handleCreate = async () => {
    if (!formData.name || !formData.redirectUris) {
      toast.error('请填写必填字段');
      return;
    }

    setSaving(true);
    try {
      const result = await createClientAction({
        name: formData.name,
        redirectUris: formData.redirectUris.split('\n').filter(Boolean),
        scopes: formData.scopes,
        homepageUrl: formData.homepageUrl || null,
        logoUrl: formData.logoUrl || null,
        accessTokenTtl: formData.accessTokenTtl,
        refreshTokenTtl: formData.refreshTokenTtl,
      });

      if (result.success && result.data.clientSecret) {
        setCreatedCredentials({
          clientId: result.data.clientId,
          clientSecret: result.data.clientSecret,
        });
        toast.success(result.message || '应用注册成功');
      } else {
        toast.error(result.message || '注册失败');
      }
    } catch {
      toast.error('应用注册失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const copyCredential = async (value: string, label: string) => {
    await navigator.clipboard.writeText(value);
    toast.success(`${label} 已复制`);
  };

  if (createdCredentials) {
    return (
      <div className="mx-auto max-w-3xl space-y-8 pb-10">
        <div>
          <h1 className="text-3xl font-black tracking-tight">保存应用凭证</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Client Secret 仅在此页面展示一次。离开后无法再次查看，只能重新生成。
          </p>
        </div>
        <Card className="overflow-hidden rounded-2xl border-amber-500/30">
          <CardHeader className="border-b bg-amber-500/10">
            <CardTitle className="flex items-center gap-2 text-lg">
              <KeyRound className="size-5 text-amber-600" />
              一次性凭证
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6 p-6 sm:p-8">
            {([
              ['Client ID', createdCredentials.clientId],
              ['Client Secret', createdCredentials.clientSecret],
            ] as const).map(([label, value]) => (
              <div key={label} className="space-y-2">
                <p className="text-sm font-bold">{label}</p>
                <div className="flex items-start gap-2">
                  <code className="min-w-0 flex-1 break-all rounded-xl bg-muted p-3 text-sm">
                    {value}
                  </code>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label={`复制 ${label}`}
                    onClick={() => void copyCredential(value, label)}
                  >
                    <Copy className="size-4" />
                  </Button>
                </div>
              </div>
            ))}
            <Button
              className="w-full"
              onClick={() => router.push(`/clients/${createdCredentials.clientId}`)}
            >
              我已安全保存，进入应用详情
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-10">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" asChild>
            <Link href="/clients" aria-label="返回应用列表"><ArrowLeft className="h-5 w-5" /></Link>
          </Button>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-foreground">注册新应用</h1>
            <p className="text-muted-foreground text-sm font-medium">注册新的 OAuth 2.1 客户端以接入单点登录系统。</p>
          </div>
        </div>
        <div className="flex gap-3">
          <Button variant="ghost" className="rounded-lg px-6" asChild>
            <Link href="/clients">取消</Link>
          </Button>
          <Button onClick={handleCreate} disabled={saving} className="rounded-lg px-8 shadow-lg shadow-primary/20">
            {saving ? '注册中...' : <><Plus className="mr-2 h-4 w-4" /> 确认注册</>}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-8">
        <div className="col-span-12 space-y-8 lg:col-span-8">
          <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-2xl overflow-hidden bg-card">
            <CardHeader className="border-b bg-muted/50">
              <CardTitle className="text-lg font-black flex items-center gap-2">
                <AppWindow className="h-5 w-5 text-primary" /> 基本配置
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
              <div className="grid grid-cols-2 gap-8">
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="new-client-name" className="font-bold text-foreground/80">应用名称 <span className="text-destructive">*</span></Label>
                  <Input
                    id="new-client-name"
                    placeholder="我的业务系统"
                    value={formData.name}
                    onChange={e => setFormData({...formData, name: e.target.value})}
                    className="h-11 rounded-lg"
                  />
                </div>
                <div className="space-y-2 col-span-2">
                  <Label htmlFor="new-client-redirect-uris" className="font-bold text-foreground/80">回调地址 <span className="text-destructive">*</span></Label>
                  <Textarea
                    id="new-client-redirect-uris"
                    placeholder="https://your-app.example.com/api/auth/callback&#10;证书和密钥由系统自动生成"
                    value={formData.redirectUris}
                    onChange={e => setFormData({...formData, redirectUris: e.target.value})}
                    className="min-h-[100px] rounded-lg"
                  />
                  <p className="text-xs text-muted-foreground">每行一个地址。Client ID 与 Secret 由系统自动生成，创建成功后展示。</p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="col-span-12 space-y-6 lg:col-span-4">
          <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-2xl overflow-hidden bg-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-black uppercase tracking-widest text-muted-foreground">高级安全设置</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="new-client-scopes" className="font-bold text-foreground/80">默认权限范围（Scopes）</Label>
                <Input
                  id="new-client-scopes"
                  value={formData.scopes}
                  onChange={e => setFormData({...formData, scopes: e.target.value})}
                  className="h-11 rounded-lg"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-client-access-ttl" className="font-bold text-foreground/80">访问令牌有效期（秒）</Label>
                <Input
                  id="new-client-access-ttl"
                  type="number"
                  value={formData.accessTokenTtl}
                  onChange={e => setFormData({...formData, accessTokenTtl: parseInt(e.target.value)})}
                  className="h-11 rounded-lg"
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

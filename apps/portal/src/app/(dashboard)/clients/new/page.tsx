/**
 * 注册新 OAuth 应用页面 — Client Component 表单
 * 写操作通过 Server Actions (actions.ts) 直调
 */
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { AppWindow, Plus } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClientAction } from '../actions';

import { PageHeader } from '@/components/shared/page-header';
export default function NewClientPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const { reportFailure } = useFieldFailure();
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
    const result = await createClientAction({
      name: formData.name,
      redirectUris: formData.redirectUris.split('\n').filter(Boolean),
      scopes: formData.scopes,
      homepageUrl: formData.homepageUrl || null,
      logoUrl: formData.logoUrl || null,
      accessTokenTtl: formData.accessTokenTtl,
      refreshTokenTtl: formData.refreshTokenTtl,
    });

    setSaving(false);

    if (result.success) {
      toast.success(result.message || '应用注册成功');
      router.push('/clients');
    } else {
      reportFailure(result, '注册失败');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        backHref="/clients"
        title="注册新应用"
        description="注册新的 OAuth 2.1 客户端以接入单点登录系统。"
        actions={
          <>
            <Button variant="outline" asChild>
              <Link href="/clients">取消</Link>
            </Button>
            <Button onClick={handleCreate} disabled={saving}>
              {saving ? '注册中...' : <><Plus className="h-4 w-4" /> 确认注册</>}
            </Button>
          </>
        }
      />

      <div className="grid items-start gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="border-b">
            <CardTitle className="flex items-center gap-2">
              <AppWindow className="h-4 w-4 text-primary" /> 基本配置
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-5 pt-6">
            <div className="space-y-2">
              <Label htmlFor="client-name">应用名称 <span className="text-destructive">*</span></Label>
              <Input
                id="client-name"
                placeholder="我的业务系统"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-redirect-uris">回调地址（每行一个） <span className="text-destructive">*</span></Label>
              <Textarea
                id="client-redirect-uris"
                placeholder={'https://your-app.example.com/api/auth/callback\nhttp://localhost:3000/api/auth/callback'}
                value={formData.redirectUris}
                onChange={e => setFormData({ ...formData, redirectUris: e.target.value })}
                className="min-h-24"
              />
              <p className="text-xs text-muted-foreground">每行一个地址。Client ID 与 Secret 由系统自动生成，创建成功后展示。</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-homepage">主页 URL（可选）</Label>
              <Input
                id="client-homepage"
                type="url"
                placeholder="https://example.com"
                value={formData.homepageUrl}
                onChange={e => setFormData({ ...formData, homepageUrl: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle>高级安全设置</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="client-scopes">默认权限范围 (Scopes)</Label>
              <Input
                id="client-scopes"
                value={formData.scopes}
                onChange={e => setFormData({ ...formData, scopes: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-at-ttl">Access Token 有效期（秒）</Label>
              <Input
                id="client-at-ttl"
                type="number"
                min={60}
                value={formData.accessTokenTtl}
                onChange={e => setFormData({ ...formData, accessTokenTtl: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">默认 3600 秒（1 小时）</p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-rt-ttl">Refresh Token 有效期（秒）</Label>
              <Input
                id="client-rt-ttl"
                type="number"
                min={300}
                value={formData.refreshTokenTtl}
                onChange={e => setFormData({ ...formData, refreshTokenTtl: parseInt(e.target.value) || 0 })}
              />
              <p className="text-xs text-muted-foreground">默认 604800 秒（7 天）</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );

}

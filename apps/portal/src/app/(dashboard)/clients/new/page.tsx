/**
 * 注册新 OAuth 应用页面 — Client Component 表单
 * 写操作通过 Server Actions (actions.ts) 直调
 */
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { AppWindow, Plus, Copy, Check } from 'lucide-react';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { createClientAction } from '../actions';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { PageHeader } from '@/components/shared/page-header';
/** 回调地址必须是绝对 http(s) URL（与服务端 Zod `.url()` 同口径的前端近似） */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export default function NewClientPage() {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  /** 创建成功后的**一次性**凭证（H-C-03）：Secret 仅此刻可见 */
  const [created, setCreated] = useState<{ clientId: string; clientSecret: string | null } | null>(null);
  const [copied, setCopied] = useState(false);
  const [errors, setErrors] = useState<{ name?: string; redirectUris?: string }>({});
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

  /**
   * U-CLIENT02：前端格式校验（此前只有"必填 toast"，非法回调地址要等服务端往返后才报错，
   * 且错误落不到字段上）。与服务端 Zod 同口径做一层快速反馈。
   */
  const validate = (): boolean => {
    const next: { name?: string; redirectUris?: string } = {};
    const name = formData.name.trim();
    if (!name) next.name = '应用名称不能为空';
    else if (name.length > 100) next.name = '应用名称最多 100 个字符';

    const uris = formData.redirectUris.split('\n').map((u) => u.trim()).filter(Boolean);
    if (uris.length === 0) {
      next.redirectUris = '至少需要一个回调地址';
    } else {
      const invalid = uris.find((u) => !isHttpUrl(u) || u.length > 500);
      if (invalid) next.redirectUris = `回调地址格式不合法：${invalid.slice(0, 80)}`;
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleCreate = async () => {
    if (!validate()) return;

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
      // H-C-03：Secret 只在此刻可见（DB 只存 bcrypt），必须展示一次；
      // 此前只 toast + router.push，返回值里的 clientSecret 被丢弃 ⇒ 新应用无法使用。
      setCreated({ clientId: result.data.clientId, clientSecret: result.data.clientSecret });
    } else {
      reportFailure(result, '注册失败');
    }
  };

  const copySecret = async () => {
    if (!created?.clientSecret) return;
    try {
      await navigator.clipboard.writeText(created.clientSecret);
    } catch {
      // 回退：非安全上下文 / 权限被拒时用 execCommand
      const textarea = document.createElement('textarea');
      textarea.value = created.clientSecret;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    setCopied(true);
  };

  const closeCreated = () => {
    setCreated(null);
    setCopied(false);
    router.push('/clients');
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
                maxLength={100}
                aria-invalid={!!errors.name}
                value={formData.name}
                onChange={e => {
                  setFormData({ ...formData, name: e.target.value });
                  if (errors.name) setErrors((prev) => ({ ...prev, name: undefined }));
                }}
              />
              {errors.name ? (
                <p role="alert" className="text-xs font-medium text-destructive">{errors.name}</p>
              ) : null}
            </div>
            <div className="space-y-2">
              <Label htmlFor="client-redirect-uris">回调地址（每行一个） <span className="text-destructive">*</span></Label>
              <Textarea
                id="client-redirect-uris"
                placeholder={'https://your-app.example.com/api/auth/callback\nhttp://localhost:3000/api/auth/callback'}
                maxLength={2000}
                aria-invalid={!!errors.redirectUris}
                value={formData.redirectUris}
                onChange={e => {
                  setFormData({ ...formData, redirectUris: e.target.value });
                  if (errors.redirectUris) setErrors((prev) => ({ ...prev, redirectUris: undefined }));
                }}
                className="min-h-24"
              />
              {errors.redirectUris ? (
                <p role="alert" className="text-xs font-medium text-destructive">{errors.redirectUris}</p>
              ) : (
                <p className="text-xs text-muted-foreground">每行一个 http(s) URL。Client ID 与 Secret 由系统自动生成，创建成功后展示。</p>
              )}
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

      {/* H-C-03：注册成功的一次性凭证弹窗（Secret 仅显示一次，DB 只存 bcrypt） */}
      <Dialog open={!!created} onOpenChange={(open) => { if (!open) closeCreated(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AppWindow className="h-5 w-5 text-primary" /> 应用注册成功
            </DialogTitle>
            <DialogDescription>
              Client Secret <strong>只显示这一次</strong>，关闭后无法再次查看。请立即复制并妥善保存到接入方配置中。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Client ID</p>
              <code className="block break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">{created?.clientId}</code>
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">Client Secret</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">{created?.clientSecret ?? '-'}</code>
                <Button variant="outline" size="sm" onClick={copySecret} aria-label="复制 Client Secret">
                  {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
                  <span>{copied ? '已复制' : '复制'}</span>
                </Button>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={closeCreated}>我已保存，前往应用列表</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

}

/**
 * 注册新 OAuth 应用页面 — Client Component 表单
 * 写操作通过 Server Actions (actions.ts) 直调
 *
 * 2026-10-23 产品化重排（UX-GUIDELINES §3.3 表单页）：
 * - 三块任务区（应用身份 / 登录与回调 / 安全与令牌），而不是"左大卡 + 右小卡"的随意分区；
 * - 常用 scopes 用可点选 chip、Token 有效期给预设，减少手输入与记数字；
 * - 提交栏在窄屏固定在视口底部（长表单不需要滚回顶部找提交）。
 */
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { AppWindow, Check, Copy, Plus, ShieldCheck, Timer } from 'lucide-react';
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

/** 常用 scope 预设：点选写入空格分隔字符串（OAuth 标准写法） */
const SCOPE_PRESETS = [
  { value: 'openid', label: 'openid（身份）' },
  { value: 'profile', label: 'profile（资料）' },
  { value: 'email', label: 'email（邮箱）' },
  { value: 'offline_access', label: 'offline_access（离线刷新）' },
];

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

  const selectedScopes = new Set(formData.scopes.split(/\s+/).filter(Boolean));
  const toggleScope = (value: string) => {
    const next = new Set(selectedScopes);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    setFormData({ ...formData, scopes: [...next].join(' ') });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        backHref="/clients"
        title="注册新应用"
        description="注册 OAuth 2.1 客户端；Client ID / Secret 由系统生成，Secret 仅展示一次"
      />

      <div className="grid items-start gap-3 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {/* ① 应用身份 */}
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
            <CardHeader className="border-b bg-muted/30 px-3 py-2">
              <CardTitle className="flex items-center gap-2 type-card-title">
                <AppWindow className="h-4 w-4 text-primary" /> 应用身份
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 p-3 sm:grid-cols-2">
              <div className="space-y-1.5">
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
              <div className="space-y-1.5">
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

          {/* ② 登录与回调 */}
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
            <CardHeader className="border-b bg-muted/30 px-3 py-2">
              <CardTitle className="flex items-center gap-2 type-card-title">
                <ShieldCheck className="h-4 w-4 text-primary" /> 登录与回调
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <div className="space-y-1.5">
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
                  className="min-h-20"
                />
                {errors.redirectUris ? (
                  <p role="alert" className="text-xs font-medium text-destructive">{errors.redirectUris}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">每行一个 http(s) URL，必须与接入方配置完全一致（含端口与路径）。</p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-scopes">默认权限范围（Scopes）</Label>
                <div className="flex flex-wrap gap-1.5">
                  {SCOPE_PRESETS.map((s) => {
                    const active = selectedScopes.has(s.value);
                    return (
                      <button
                        key={s.value}
                        type="button"
                        aria-pressed={active}
                        onClick={() => toggleScope(s.value)}
                        className={`h-7 rounded-md border px-2 text-xs transition-colors ${
                          active ? 'border-primary/40 bg-primary/10 font-medium text-primary' : 'border-border text-muted-foreground hover:bg-muted'
                        }`}
                      >
                        {s.label}
                      </button>
                    );
                  })}
                </div>
                <Input
                  id="client-scopes"
                  value={formData.scopes}
                  onChange={e => setFormData({ ...formData, scopes: e.target.value })}
                  aria-label="Scopes（空格分隔）"
                  className="mt-1 font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground">点选常用值会自动写入；特殊 scope 可直接编辑上面的输入框。</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-3">
          {/* ③ 安全与令牌 */}
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
            <CardHeader className="border-b bg-muted/30 px-3 py-2">
              <CardTitle className="flex items-center gap-2 type-card-title">
                <Timer className="h-4 w-4 text-primary" /> 安全与令牌
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <div className="space-y-1.5">
                <Label htmlFor="client-at-ttl">Access Token 有效期（秒）</Label>
                <Input
                  id="client-at-ttl"
                  type="number"
                  min={60}
                  value={formData.accessTokenTtl}
                  onChange={e => setFormData({ ...formData, accessTokenTtl: parseInt(e.target.value) || 0 })}
                />
                <div className="flex gap-1.5">
                  {[{ v: 1800, t: '30 分钟' }, { v: 3600, t: '1 小时' }, { v: 86400, t: '24 小时' }].map((p) => {
                    const active = formData.accessTokenTtl === p.v;
                    return (
                      <Button key={p.v} type="button" variant={active ? 'default' : 'outline'} size="sm"
                        aria-pressed={active} className="h-6 px-2 text-[11px]"
                        onClick={() => setFormData({ ...formData, accessTokenTtl: p.v })}>
                        {p.t}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-rt-ttl">Refresh Token 有效期（秒）</Label>
                <Input
                  id="client-rt-ttl"
                  type="number"
                  min={300}
                  value={formData.refreshTokenTtl}
                  onChange={e => setFormData({ ...formData, refreshTokenTtl: parseInt(e.target.value) || 0 })}
                />
                <div className="flex gap-1.5">
                  {[{ v: 86400, t: '1 天' }, { v: 604800, t: '7 天' }, { v: 2592000, t: '30 天' }].map((p) => {
                    const active = formData.refreshTokenTtl === p.v;
                    return (
                      <Button key={p.v} type="button" variant={active ? 'default' : 'outline'} size="sm"
                        aria-pressed={active} className="h-6 px-2 text-[11px]"
                        onClick={() => setFormData({ ...formData, refreshTokenTtl: p.v })}>
                        {p.t}
                      </Button>
                    );
                  })}
                </div>
              </div>
              <div className="rounded-md border border-border/60 bg-muted/30 p-2.5 text-[11px] leading-5 text-muted-foreground">
                <p className="font-medium text-foreground">创建后注意</p>
                <p>Client Secret 只显示一次，请立即保存到接入方配置；丢失只能轮换。</p>
                <p>PKCE 强制 S256；回调地址按精确匹配校验。</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* 提交栏：窄屏固定底部，长表单不必回滚到顶部 */}
      <div className="sticky bottom-0 z-10 -mx-3 flex items-center justify-end gap-2 border-t bg-background/95 px-3 py-2 backdrop-blur lg:static lg:mx-0 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
        <Button variant="outline" size="sm" asChild>
          <Link href="/clients">取消</Link>
        </Button>
        <Button size="sm" onClick={handleCreate} disabled={saving}>
          {saving ? '注册中...' : <><Plus className="h-3.5 w-3.5" /> 确认注册</>}
        </Button>
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

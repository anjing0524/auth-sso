/**
 * Client 基本信息 Section — 按任务分区的编辑表单 + 凭证信息
 *
 * 2026-10-26 产品化重排（UX-GUIDELINES §3.2/§3.3）：
 * 原来"左侧一长列 + 右侧三张卡"没有任务分组；现在左侧按 资料/回调/令牌 三块，
 * 右侧集中凭证与状态，Scopes 用与新建页一致的 chip 预设。
 */
'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import type { ClientDTO as Client } from '../../data';

import { formatDate } from '@/lib/format-date';

export interface ClientInfoSectionProps {
  client: Client;
  formData: {
    name: string;
    redirectUris: string;
    scopes: string;
    homepageUrl: string;
    logoUrl: string;
    accessTokenTtl: number;
    refreshTokenTtl: number;
  };
  newSecret: string | null;
  onFormChange: (data: Partial<ClientInfoSectionProps['formData']>) => void;
  onRegenerateSecret: () => Promise<void> | void;
  onCopy: (text: string) => Promise<void> | void;
  /** Portal 自身客户端只读（登录链路依赖），禁止修改/轮换/禁用 */
  readOnly?: boolean;
}

const SCOPE_PRESETS = [
  { value: 'openid', label: 'openid（身份）' },
  { value: 'profile', label: 'profile（资料）' },
  { value: 'email', label: 'email（邮箱）' },
  { value: 'offline_access', label: 'offline_access（离线刷新）' },
];

function formatTTL(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

const CARD = 'gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0';
const HEAD = 'border-b bg-muted/30 px-3 py-2';

export function ClientInfoSection({
  client,
  formData,
  newSecret,
  onFormChange,
  onRegenerateSecret,
  onCopy,
  readOnly = false,
}: ClientInfoSectionProps) {
  const selectedScopes = new Set(formData.scopes.split(/\s+/).filter(Boolean));
  const toggleScope = (value: string) => {
    const next = new Set(selectedScopes);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onFormChange({ scopes: [...next].join(' ') });
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <div className="space-y-3 lg:col-span-2">
        <Card className={CARD}>
          <CardHeader className={HEAD}>
            <CardTitle className="type-card-title">应用资料</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3">
            {readOnly ? (
              <div className="rounded-md border border-badge-warning-fg/30 bg-badge-warning-bg px-2.5 py-2 text-[11px] leading-5 text-badge-warning-fg">
                这是 <strong>Portal 自身登录客户端</strong>：修改配置、轮换 Secret、禁用或注销都会中断全站登录，因此为只读。
              </div>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="client-name">名称</Label>
                <Input
                  id="client-name"
                  disabled={readOnly}
                  value={formData.name}
                  onChange={(e) => onFormChange({ name: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="client-homepage">主页 URL</Label>
                <Input
                  id="client-homepage"
                  disabled={readOnly}
                  type="url"
                  value={formData.homepageUrl}
                  onChange={(e) => onFormChange({ homepageUrl: e.target.value })}
                  placeholder="https://example.com"
                />
              </div>
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
                      disabled={readOnly}
                      onClick={() => toggleScope(s.value)}
                      className={`h-7 rounded-md border px-2 text-xs transition-colors disabled:opacity-50 ${
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
                disabled={readOnly}
                value={formData.scopes}
                onChange={(e) => onFormChange({ scopes: e.target.value })}
                placeholder="openid profile email"
                className="font-mono text-xs"
              />
            </div>
          </CardContent>
        </Card>

        <Card className={CARD}>
          <CardHeader className={HEAD}>
            <CardTitle className="type-card-title">登录与回调</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3">
            <div className="space-y-1.5">
              <Label htmlFor="client-redirect-uris">回调地址（每行一个）</Label>
              <Textarea
                id="client-redirect-uris"
                disabled={readOnly}
                rows={3}
                value={formData.redirectUris}
                onChange={(e) => onFormChange({ redirectUris: e.target.value })}
                placeholder="https://your-app.example.com/callback"
              />
              <p className="text-[11px] text-muted-foreground">按精确匹配校验（含端口与路径）；新增/删除回调后需重新登录。</p>
            </div>
          </CardContent>
        </Card>

        <Card className={CARD}>
          <CardHeader className={HEAD}>
            <CardTitle className="type-card-title">令牌有效期</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 p-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="client-at-ttl">Access Token 有效期（秒）</Label>
              <Input
                id="client-at-ttl"
                disabled={readOnly}
                type="number"
                value={formData.accessTokenTtl}
                onChange={(e) => onFormChange({ accessTokenTtl: parseInt(e.target.value) })}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">当前：{formatTTL(formData.accessTokenTtl)}</p>
                <div className="flex gap-1">
                  {[{ v: 1800, t: '30m' }, { v: 3600, t: '1h' }, { v: 86400, t: '24h' }].map((p) => (
                    <Button key={p.v} type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px]"
                      disabled={readOnly} onClick={() => onFormChange({ accessTokenTtl: p.v })}>
                      {p.t}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-rt-ttl">Refresh Token 有效期（秒）</Label>
              <Input
                id="client-rt-ttl"
                disabled={readOnly}
                type="number"
                value={formData.refreshTokenTtl}
                onChange={(e) => onFormChange({ refreshTokenTtl: parseInt(e.target.value) })}
              />
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-muted-foreground">当前：{formatTTL(formData.refreshTokenTtl)}</p>
                <div className="flex gap-1">
                  {[{ v: 86400, t: '1d' }, { v: 604800, t: '7d' }, { v: 2592000, t: '30d' }].map((p) => (
                    <Button key={p.v} type="button" variant="outline" size="sm" className="h-6 px-1.5 text-[10px]"
                      disabled={readOnly} onClick={() => onFormChange({ refreshTokenTtl: p.v })}>
                      {p.t}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="space-y-3">
        <Card className={CARD}>
          <CardHeader className={HEAD}>
            <CardTitle className="type-card-title">客户端凭证</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 p-3">
            <div className="space-y-1.5">
              <p className="text-[11px] text-muted-foreground">Client ID</p>
              <div className="flex items-center gap-1.5">
                <code className="min-w-0 flex-1 truncate rounded bg-muted px-2 py-1.5 font-mono text-[11px]">{client.clientId}</code>
                <Button variant="ghost" size="icon-sm" aria-label="复制 Client ID" title="复制 Client ID" onClick={() => onCopy(client.clientId)}>
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            <div className="space-y-1.5 border-t pt-2.5">
              <p className="text-[11px] text-muted-foreground">Client Secret</p>
              {newSecret ? (
                <div className="space-y-2">
                  <div className="rounded-md border border-badge-warning-fg/20 bg-badge-warning-bg px-2 py-1.5 text-[11px] text-badge-warning-fg">
                    新 Secret 仅显示这一次，请立即保存。
                  </div>
                  <div className="flex items-center gap-1.5">
                    <code className="min-w-0 flex-1 break-all rounded bg-muted px-2 py-1.5 font-mono text-[11px]">{newSecret}</code>
                    <Button variant="ghost" size="icon-sm" aria-label="复制新 Secret" title="复制新 Secret" onClick={() => onCopy(newSecret)}>
                      <Copy className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5">
                  <p className="text-[11px] text-muted-foreground">出于安全原因无法查看；丢失后可轮换。</p>
                  <Button variant="outline" size="sm" onClick={onRegenerateSecret} disabled={readOnly}>
                    重新生成 Secret
                  </Button>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className={CARD}>
          <CardHeader className={HEAD}>
            <CardTitle className="type-card-title">状态与时间</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">状态</span>
              <Badge variant={client.status === 'ACTIVE' ? 'success' : 'secondary'}>
                {client.status === 'ACTIVE' ? '已启用' : '已禁用'}
              </Badge>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">创建时间</span>
              <span className="text-[13px]">{formatDate(client.createdAt)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] text-muted-foreground">更新时间</span>
              <span className="text-[13px]">{formatDate(client.updatedAt)}</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

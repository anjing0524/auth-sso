/**
 * Client 基本信息 Section — 编辑表单 + 凭证信息
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

function formatTTL(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

export function ClientInfoSection({
  client,
  formData,
  newSecret,
  onFormChange,
  onRegenerateSecret,
  onCopy,
  readOnly = false,
}: ClientInfoSectionProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 左侧：编辑表单 */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle>编辑信息</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          {readOnly ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 text-xs text-warning">
              这是 <strong>Portal 自身登录客户端</strong>：修改配置、轮换 Secret、禁用或注销都会中断全站登录，
              因此为只读。需要调整请通过部署配置并重新初始化。
            </div>
          ) : null}
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
            <Label htmlFor="client-redirect-uris">回调地址（每行一个）</Label>
            <Textarea
              id="client-redirect-uris"
              disabled={readOnly}
              rows={3}
              value={formData.redirectUris}
              onChange={(e) => onFormChange({ redirectUris: e.target.value })}
              placeholder="https://your-app.example.com/callback"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="client-scopes">Scopes（空格分隔）</Label>
            <Input
              id="client-scopes"
              disabled={readOnly}
              value={formData.scopes}
              onChange={(e) => onFormChange({ scopes: e.target.value })}
              placeholder="openid profile email"
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

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="client-at-ttl">Access Token 有效期（秒）</Label>
              <Input
                id="client-at-ttl"
              disabled={readOnly}
                type="number"
                value={formData.accessTokenTtl}
                onChange={(e) => onFormChange({ accessTokenTtl: parseInt(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{formatTTL(formData.accessTokenTtl)}</p>
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
              <p className="text-xs text-muted-foreground">{formatTTL(formData.refreshTokenTtl)}</p>
            </div>
          </div>

        </CardContent>
      </Card>

      {/* 右侧：凭证信息 */}
      <div className="space-y-6">
        {/* Client ID */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Client ID</h2>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono">
                {client.clientId}
              </code>
              <Button
                variant="ghost"
                size="sm"
                aria-label="复制 Client ID"
                onClick={() => onCopy(client.clientId)}
                title="复制"
                className="h-8 shrink-0 gap-1.5 px-2"
              >
                <Copy className="h-4 w-4" /><span>复制</span>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Client Secret */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-2 text-sm font-medium text-muted-foreground">Client Secret</h2>
            {newSecret ? (
              <div className="space-y-3">
                <div className="rounded-lg border border-warning/20 bg-warning/10 p-3">
                  <p className="text-sm text-warning font-medium">
                    新 Secret 已生成，请立即保存！此 Secret 仅显示一次。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 break-all rounded-lg bg-muted px-3 py-2 font-mono text-sm">
                    {newSecret}
                  </code>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label="复制新 Secret"
                    onClick={() => onCopy(newSecret)}
                    title="复制"
                    className="h-8 shrink-0 gap-1.5 px-2"
                  >
                    <Copy className="h-4 w-4" /><span>复制</span>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>Secret 已设置，出于安全原因无法查看。</p>
                <Button variant="outline" className="mt-2" onClick={onRegenerateSecret} disabled={readOnly}>
                  重新生成 Secret
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 其他信息 */}
        <Card>
          <CardContent className="pt-6">
            <h2 className="mb-4 text-sm font-medium text-muted-foreground">其他信息</h2>
            <dl className="space-y-3">
              <div className="flex justify-between">
                <dt className="text-sm text-muted-foreground">状态</dt>
                <dd>
                  <Badge variant={client.status === 'ACTIVE' ? 'success' : 'secondary'}>
                    {client.status === 'ACTIVE' ? '已启用' : '已禁用'}
                  </Badge>
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-muted-foreground">创建时间</dt>
                <dd className="text-sm text-foreground">{formatDate(client.createdAt)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-sm text-muted-foreground">更新时间</dt>
                <dd className="text-sm text-foreground">{formatDate(client.updatedAt)}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

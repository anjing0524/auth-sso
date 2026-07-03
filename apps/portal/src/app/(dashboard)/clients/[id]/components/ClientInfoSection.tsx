/**
 * Client 基本信息 Section — 编辑表单 + 凭证信息
 */
'use client';

import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import type { ClientDTO as Client } from '../../data';

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
  saving: boolean;
  newSecret: string | null;
  onFormChange: (data: Partial<ClientInfoSectionProps['formData']>) => void;
  onSave: () => Promise<void>;
  onRegenerateSecret: () => Promise<void>;
  onToggleStatus: () => Promise<void>;
  onCopy: (text: string) => Promise<void>;
}

function formatTTL(seconds: number): string {
  if (seconds >= 86400) return `${Math.floor(seconds / 86400)} 天`;
  if (seconds >= 3600) return `${Math.floor(seconds / 3600)} 小时`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)} 分钟`;
  return `${seconds} 秒`;
}

function formatDate(date: Date | string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN');
}

export function ClientInfoSection({
  client,
  formData,
  saving,
  newSecret,
  onFormChange,
  onSave,
  onRegenerateSecret,
  onToggleStatus,
  onCopy,
}: ClientInfoSectionProps) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* 左侧：编辑表单 */}
      <Card>
        <CardHeader className="border-b pb-4">
          <CardTitle className="text-base font-bold">编辑信息</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 space-y-5">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">名称</label>
            <Input
              value={formData.name}
              onChange={(e) => onFormChange({ name: e.target.value })}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">回调地址（每行一个）</label>
            <Textarea
              rows={3}
              value={formData.redirectUris}
              onChange={(e) => onFormChange({ redirectUris: e.target.value })}
              placeholder="https://your-app.example.com/callback"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">Scopes（空格分隔）</label>
            <Input
              value={formData.scopes}
              onChange={(e) => onFormChange({ scopes: e.target.value })}
              placeholder="openid profile email"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground">主页 URL</label>
            <Input
              type="url"
              value={formData.homepageUrl}
              onChange={(e) => onFormChange({ homepageUrl: e.target.value })}
              placeholder="https://example.com"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Access Token 有效期（秒）</label>
              <Input
                type="number"
                value={formData.accessTokenTtl}
                onChange={(e) => onFormChange({ accessTokenTtl: parseInt(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{formatTTL(formData.accessTokenTtl)}</p>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground">Refresh Token 有效期（秒）</label>
              <Input
                type="number"
                value={formData.refreshTokenTtl}
                onChange={(e) => onFormChange({ refreshTokenTtl: parseInt(e.target.value) })}
              />
              <p className="text-xs text-muted-foreground">{formatTTL(formData.refreshTokenTtl)}</p>
            </div>
          </div>

          <div className="flex justify-between items-center pt-2">
            <Button
              variant={client.status === 'ACTIVE' ? 'destructive' : 'success'}
              onClick={onToggleStatus}
            >
              {client.status === 'ACTIVE' ? '禁用' : '启用'}
            </Button>
            <Button
              onClick={onSave}
              disabled={saving}
            >
              {saving ? '保存中...' : '保存修改'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* 右侧：凭证信息 */}
      <div className="space-y-6">
        {/* Client ID */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Client ID</h3>
            <div className="flex items-center gap-2">
              <code className="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono">
                {client.clientId}
              </code>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onCopy(client.clientId)}
                title="复制"
                className="shrink-0"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Client Secret */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-2">Client Secret</h3>
            {newSecret ? (
              <div className="space-y-3">
                <div className="p-3 bg-warning/10 border border-warning/20 rounded-md">
                  <p className="text-sm text-warning font-medium">
                    新 Secret 已生成，请立即保存！此 Secret 仅显示一次。
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 px-3 py-2 bg-muted rounded-md text-sm font-mono break-all">
                    {newSecret}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => onCopy(newSecret)}
                    title="复制"
                    className="shrink-0"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">
                <p>Secret 已设置，出于安全原因无法查看。</p>
                <Button
                  variant="link"
                  className="mt-3 h-auto p-0 text-primary"
                  onClick={onRegenerateSecret}
                >
                  重新生成 Secret
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* 其他信息 */}
        <Card>
          <CardContent className="pt-6">
            <h3 className="text-sm font-medium text-muted-foreground mb-4">其他信息</h3>
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

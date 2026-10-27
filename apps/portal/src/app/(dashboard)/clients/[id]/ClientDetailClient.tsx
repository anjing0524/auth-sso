/**
 * Client 详情交互组件 — 表单编辑 / 标签页 / 写操作反馈。
 *
 * 初始数据由 Server Component 经 props 注入；写操作成功后 router.refresh()
 * 重取 server 数据（actions 内已 updateTag 失效对应缓存），组件自身不再发起
 * REST 读取。
 *
 * 反馈统一走 sonner toast + 设计系统 Dialog：此前这里混用浏览器原生
 * `alert()` / `confirm()`（14 处），既与全站风格不一致，也绕过了组件的可测试面
 * （审计 P1-4）。
 */
'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { updateClientAction, rotateClientSecretAction, revokeClientTokensAction } from '../actions';
import type { ClientDTO as Client, ClientTokenDTO as Token } from '../data';
import { ClientInfoSection } from './components/ClientInfoSection';
import { CLIENT_PERMISSIONS, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
import { ClientTokensSection } from './components/ClientTokensSection';
import { createClientLogger } from '@/lib/logger-client';
import { useFieldFailure } from '@/hooks/use-field-failure';
import { useUnsavedChangesGuard } from '@/hooks/use-unsaved-changes-guard';

import { PageHeader } from '@/components/shared/page-header';
import { PermissionGuard } from '@/components/shared/permission-guard';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const log = createClientLogger('ClientDetail');

interface ClientDetailClientProps {
  client: Client;
  initialTokens: Token[];
  /** 是否具备 client:update；无权限时配置区只读、Token 撤销入口隐藏 */
  canUpdate: boolean;
  /** 返回列表（保留筛选） */
  returnHref?: string;
}

/** 需要二次确认的危险操作 */
type PendingAction = 'regenerate-secret' | 'revoke-tokens' | 'toggle-status' | null;

const CONFIRM_META: Record<Exclude<PendingAction, null>, { title: string; description: string; confirmLabel: string }> = {
  'regenerate-secret': {
    title: '重新生成 Client Secret？',
    description: '旧的 Secret 会立即失效，所有使用旧 Secret 的调用方都将认证失败。',
    confirmLabel: '确认重新生成',
  },
  'revoke-tokens': {
    title: '撤销全部授权 Token？',
    description: '该应用当前所有用户的 Refresh Token 会被立即吊销，需要重新授权。',
    confirmLabel: '确认撤销',
  },
  'toggle-status': {
    title: '切换应用状态？',
    description: '禁用后该应用将无法发起新的授权；已签发的 Token 在过期前仍有效。',
    confirmLabel: '确认切换',
  },
};

export function ClientDetailClient({ client, initialTokens, canUpdate, returnHref = '/clients' }: ClientDetailClientProps) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'tokens'>('info');
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [busy, setBusy] = useState(false);
  // 失败分类点：Server Action 失败必须经 reportFailure（form-failure-handling-guard 强制）
  const { reportFailure } = useFieldFailure();

  const [formData, setFormData] = useState({
    name: client.name,
    redirectUris: client.redirectUris.join('\n'),
    scopes: client.scopes,
    homepageUrl: client.homepageUrl || '',
    logoUrl: client.logoUrl || '',
    accessTokenTtl: client.accessTokenTtl ?? 3600,
    refreshTokenTtl: client.refreshTokenTtl ?? 604800,
  });
  const [savedForm, setSavedForm] = useState(formData);
  const isDirty = JSON.stringify(formData) !== JSON.stringify(savedForm);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await updateClientAction(client.clientId, {
        name: formData.name,
        redirectUris: formData.redirectUris.split('\n').filter(Boolean),
        scopes: formData.scopes,
        homepageUrl: formData.homepageUrl || null,
        logoUrl: formData.logoUrl || null,
        accessTokenTtl: formData.accessTokenTtl,
        refreshTokenTtl: formData.refreshTokenTtl,
      });
      if (res.success) {
        setSavedForm(formData);
        router.refresh();
        toast.success('应用配置已保存');
      } else {
        reportFailure(res, '保存失败');
      }
    } catch (error) {
      log.error('保存客户端失败', { error: (error as Error).message });
      toast.error('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const runPendingAction = async () => {
    if (!pendingAction) return;
    setBusy(true);
    try {
      if (pendingAction === 'regenerate-secret') {
        const res = await rotateClientSecretAction(client.clientId);
        if (res.success && res.data) {
          setNewSecret(res.data.clientSecret);
          toast.success('新 Secret 已生成，请立即保存（只显示一次）');
        } else if (!res.success) {
          reportFailure(res, '重新生成 Secret 失败');
        } else {
          toast.error('未返回新的 Secret，请重试');
        }
      } else if (pendingAction === 'revoke-tokens') {
        const res = await revokeClientTokensAction(client.clientId, [], true);
        if (res.success) {
          router.refresh();
          toast.success('已撤销全部授权 Token');
        } else {
          reportFailure(res, '撤销 Token 失败');
        }
      } else {
        const newStatus = client.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
        const res = await updateClientAction(client.clientId, { status: newStatus });
        if (res.success) {
          router.refresh();
          toast.success(newStatus === 'ACTIVE' ? '应用已启用' : '应用已禁用');
        } else {
          reportFailure(res, '更新状态失败');
        }
      }
    } catch (error) {
      log.error('危险操作失败', { error: (error as Error).message });
      toast.error('操作失败，请稍后重试');
    } finally {
      setBusy(false);
      setPendingAction(null);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('已复制到剪贴板');
      return;
    } catch {
      // 回退：execCommand 在部分环境同样会失败，只有真的成功才提示"已复制"
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(textarea);
      if (copied) toast.success('已复制到剪贴板');
      else toast.error('复制失败，请手动选择后复制');
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'info' : event.key === 'End' ? 'tokens' : activeTab === 'info' ? 'tokens' : 'info';
    setActiveTab(next);
    requestAnimationFrame(() => document.getElementById(`client-tab-${next}`)?.focus());
  };

  const meta = pendingAction ? CONFIRM_META[pendingAction] : null;
  const leaveGuard = useUnsavedChangesGuard(isDirty);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        backHref={returnHref}
        title={client.name}
        description={`${client.status === 'ACTIVE' ? '已启用' : '已禁用'} · Client ID：${client.clientId}`}
        actions={
          <PermissionGuard permission={CLIENT_PERMISSIONS.UPDATE}>
            <div className="flex flex-wrap items-center gap-2">
              {isDirty && (
                <span role="status" className="rounded bg-badge-warning-bg px-2 py-1 text-[11px] font-medium text-badge-warning-fg">未保存的修改</span>
              )}
              {isDirty && (
                <Button variant="outline" size="sm" onClick={() => setFormData(savedForm)} disabled={saving}>放弃修改</Button>
              )}
              <Button
                variant="outline"
                onClick={() => setPendingAction('toggle-status')}
                disabled={saving || client.clientId === PORTAL_CLIENT_ID}
                className={client.status === 'ACTIVE'
                  ? 'border-destructive/40 text-destructive hover:bg-destructive/10 hover:text-destructive'
                  : 'border-success/40 text-success hover:bg-success/10 hover:text-success'}
              >
                {client.status === 'ACTIVE' ? '禁用' : '启用'}
              </Button>
              <Button onClick={handleSave} disabled={saving || client.clientId === PORTAL_CLIENT_ID || !isDirty}>
                {saving ? '保存中...' : !isDirty ? '无修改' : '保存修改'}
              </Button>
            </div>
          </PermissionGuard>
        }
      />

      {/* 标签页：与 Tabs 组件同一套分段式视觉 */}
      <div role="tablist" aria-label="应用详情" className="inline-flex h-8 items-center rounded-lg bg-muted p-0.5">
        <button
          id="client-tab-info"
          role="tab"
          aria-selected={activeTab === 'info'}
          aria-controls="client-panel-info"
          tabIndex={activeTab === 'info' ? 0 : -1}
          onClick={() => setActiveTab('info')}
          onKeyDown={handleTabKeyDown}
          className={`inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ${
            activeTab === 'info' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          基本信息
        </button>
        <button
          id="client-tab-tokens"
          role="tab"
          aria-selected={activeTab === 'tokens'}
          aria-controls="client-panel-tokens"
          tabIndex={activeTab === 'tokens' ? 0 : -1}
          onClick={() => setActiveTab('tokens')}
          onKeyDown={handleTabKeyDown}
          className={`inline-flex h-7 items-center rounded-md px-2.5 text-xs font-medium transition-colors ${
            activeTab === 'tokens' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          授权记录
        </button>
      </div>

      {activeTab === 'info' && (
        <div role="tabpanel" id="client-panel-info" aria-labelledby="client-tab-info" tabIndex={0}>
        <ClientInfoSection
          client={client}
          formData={formData}
          newSecret={newSecret}
          onFormChange={(partial) => setFormData({ ...formData, ...partial })}
          onRegenerateSecret={() => setPendingAction('regenerate-secret')}
          onCopy={copyToClipboard}
          readOnly={client.clientId === PORTAL_CLIENT_ID || !canUpdate}
        />
        </div>
      )}

      {activeTab === 'tokens' && (
        <div role="tabpanel" id="client-panel-tokens" aria-labelledby="client-tab-tokens" tabIndex={0}>
        <ClientTokensSection
          tokens={initialTokens}
          onRevokeAll={() => setPendingAction('revoke-tokens')}
          canRevoke={canUpdate}
        />
        </div>
      )}

      {/* 危险操作二次确认（统一弹窗，替代原生 confirm） */}
      <Dialog open={pendingAction !== null} onOpenChange={(open) => { if (!open) setPendingAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{meta?.title}</DialogTitle>
            <DialogDescription>{meta?.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingAction(null)} disabled={busy}>
              取消
            </Button>
            <Button variant="destructive" onClick={runPendingAction} disabled={busy}>
              {busy ? '处理中...' : meta?.confirmLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {leaveGuard}
    </div>
  );
}

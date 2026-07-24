/**
 * Client 详情页 — 编排器（Section 拆分为 ClientInfoSection / ClientTokensSection）
 *
 * 原 530 行单文件，现拆分为 ~180 行的编排器 + 两个 section 组件。
 */
'use client';

import { useState, useEffect, useCallback, use } from 'react';
import Link from 'next/link';
import { updateClientAction, rotateClientSecretAction, revokeClientTokensAction } from '../actions';
import type { ClientDTO as Client, ClientTokenDTO as Token } from '../data';
import { ClientInfoSection } from './components/ClientInfoSection';
import { ClientTokensSection } from './components/ClientTokensSection';
import { createClientLogger } from '@/lib/logger-client';

const log = createClientLogger('ClientDetailPage');

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function ClientDetailPage({ params }: PageProps) {
  const { id } = use(params);
  const [client, setClient] = useState<Client | null>(null);
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'info' | 'tokens'>('info');

  const [formData, setFormData] = useState({
    name: '',
    redirectUris: '',
    scopes: '',
    homepageUrl: '',
    logoUrl: '',
    accessTokenTtl: 3600,
    refreshTokenTtl: 604800,
  });

  const fetchClient = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/clients/${id}`);
      if (response.ok) {
        const data = await response.json();
        setClient(data.data);
        setFormData({
          name: data.data.name,
          redirectUris: data.data.redirectUris.join('\n'),
          scopes: data.data.scopes,
          homepageUrl: data.data.homepageUrl || '',
          logoUrl: data.data.logoUrl || '',
          accessTokenTtl: data.data.accessTokenTtl,
          refreshTokenTtl: data.data.refreshTokenTtl,
        });
      }
    } catch (error) {
      log.error('获取客户端信息失败', { error: (error as Error).message });
    } finally {
      setLoading(false);
    }
  }, [id]);

  const fetchTokens = useCallback(async () => {
    try {
      const response = await fetch(`/api/clients/${id}/tokens?pageSize=10`);
      if (response.ok) {
        const data = await response.json();
        setTokens(data.data);
      }
    } catch (error) {
      log.error('获取 Token 列表失败', { error: (error as Error).message });
    }
  }, [id]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchClient();
      void fetchTokens();
    });
  }, [fetchClient, fetchTokens]);

  const handleSave = async () => {
    if (!client) return;
    setSaving(true);
    try {
      const res = await updateClientAction(id, {
        name: formData.name,
        redirectUris: formData.redirectUris.split('\n').filter(Boolean),
        scopes: formData.scopes,
        homepageUrl: formData.homepageUrl || null,
        logoUrl: formData.logoUrl || null,
        accessTokenTtl: formData.accessTokenTtl,
        refreshTokenTtl: formData.refreshTokenTtl,
      });
      if (res.success) {
        fetchClient();
        alert('保存成功');
      } else {
        alert(res.message || '保存失败');
      }
    } catch (error) {
      log.error('保存客户端失败', { error: (error as Error).message });
      alert('保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleRegenerateSecret = async () => {
    if (!confirm('确定要重新生成 Secret 吗？旧的 Secret 将立即失效。')) return;
    try {
      const res = await rotateClientSecretAction(id);
      if (res.success && res.data) {
        setNewSecret(res.data.clientSecret);
      } else {
        alert(res.message || '重新生成 Secret 失败');
      }
    } catch (error) {
      log.error('重新生成 Secret 失败', { error: (error as Error).message });
      alert('重新生成 Secret 失败');
    }
  };

  const handleRevokeAllTokens = async () => {
    if (!confirm('确定要撤销所有授权 Token 吗？')) return;
    try {
      const res = await revokeClientTokensAction(id, [], true);
      if (res.success) {
        fetchTokens();
        alert('已撤销所有 Token');
      } else {
        alert(res.message || '撤销 Token 失败');
      }
    } catch (error) {
      log.error('撤销 Token 失败', { error: (error as Error).message });
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert('已复制到剪贴板');
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      alert('已复制到剪贴板');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-64">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (!client) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Client 不存在</p>
        <Link href="/clients" className="mt-4 text-primary hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 页面标题 */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Link href="/clients" className="text-muted-foreground hover:text-foreground">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h2 className="text-2xl font-bold text-foreground">{client.name}</h2>
            <p className="text-sm text-muted-foreground">{client.clientId}</p>
          </div>
        </div>
      </div>

      {/* 标签页 */}
      <div className="border-b border-border">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('info')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'info'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            基本信息
          </button>
          <button
            onClick={() => setActiveTab('tokens')}
            className={`py-4 px-1 border-b-2 font-medium text-sm ${
              activeTab === 'tokens'
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
            }`}
          >
            授权记录
          </button>
        </nav>
      </div>

      {/* Section 内容 */}
      {activeTab === 'info' && (
        <ClientInfoSection
          client={client}
          formData={formData}
          saving={saving}
          newSecret={newSecret}
          onFormChange={(partial) => setFormData({ ...formData, ...partial })}
          onSave={handleSave}
          onRegenerateSecret={handleRegenerateSecret}
          onToggleStatus={async () => {
            if (!client) return;
            const newStatus = client.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE';
            try {
              const res = await updateClientAction(id, { status: newStatus });
              if (res.success) fetchClient();
              else alert(res.message || '更新状态失败');
            } catch (error) {
              log.error('切换客户端状态失败', { error: (error as Error).message });
            }
          }}
          onCopy={copyToClipboard}
        />
      )}

      {activeTab === 'tokens' && (
        <ClientTokensSection
          tokens={tokens}
          onRevokeAll={handleRevokeAllTokens}
        />
      )}
    </div>
  );
}

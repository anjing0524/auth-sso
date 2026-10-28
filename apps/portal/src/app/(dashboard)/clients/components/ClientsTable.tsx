'use client';

/**
 * Client 列表表格 — 客户端交互组件
 * 职责：搜索/复制/下拉菜单等浏览器交互，写操作通过 Server Actions 直调
 */
import React, { useState, useCallback, useTransition, useEffect, useRef } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import { useFieldFailure } from '@/hooks/use-field-failure';
import {
  Copy, ExternalLink, Edit, Trash2, Globe, Check, Plus,
} from 'lucide-react';
import {
  TableCell, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { DataTable } from '@/components/shared/data-table';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/shared/empty-state';
import { enableStatus } from '@/lib/status-label';
import { formatDate } from '@/lib/format-date';
import { CLIENT_PERMISSIONS, PORTAL_CLIENT_ID } from '@auth-sso/contracts';
import { deleteClientAction } from '../actions';

import { SearchInput } from '@/components/shared/search-input';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { TableToolbar } from '@/components/shared/table-toolbar';
import { TablePagination } from '@/components/shared/table-pagination';
import { PermissionGuard } from '@/components/shared/permission-guard';
/** 回调 URI 列表展示：去协议显示 host+path（完整值放 title），避免长 URL 被截成 "ps://…" */
function formatRedirectUri(uri: string): string {
  try {
    const u = new URL(uri);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return uri;
  }
}

/** 头像兜底文案：中文取首字，拉丁名取前两位（"系统管理员"→"系"，"Auth-SSO Portal"→"AU"） */
function avatarFallback(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return 'U';
  return /[\u4e00-\u9fa5]/.test(trimmed) ? trimmed.charAt(0) : trimmed.substring(0, 2).toUpperCase();
}

interface ClientRow {
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  status: string;
  createdAt: string;
  /** 最近一次 token 签发时间；null=从未使用 */
  lastUsedAt?: string | null;
}

interface Props {
  clients: ClientRow[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
  initialKeyword: string;
  /** 状态筛选：'' | ACTIVE | DISABLED */
  initialStatus?: string;
  /** 排序：recent | updated | name */
  initialSort?: string;
  /** 是否处于搜索态（U-G02：空态文案与「清除筛选」出口据此区分） */
  isFiltered?: boolean;
  /** 「清除筛选」目标地址（回第 1 页、清空 keyword） */
  clearHref?: string;
  /** 全局状态计数（与分页无关，用于标题处概览） */
  statusCounts?: { active: number; disabled: number };
}

export default function ClientsTable({ clients, pagination, initialKeyword, initialStatus = '', initialSort = 'recent', isFiltered = false, clearHref = '/clients' , statusCounts}: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const searchParams = useSearchParams();
  const currentListHref = `/clients${searchParams.toString() ? `?${searchParams.toString()}` : ''}`;
  const applyStatus = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('status', value); else params.delete('status');
    params.set('page', '1');
    startTransition(() => router.push(`/clients?${params.toString()}`));
  };
  const applySort = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value && value !== 'recent') params.set('sort', value); else params.delete('sort');
    params.set('page', '1');
    startTransition(() => router.push(`/clients?${params.toString()}`));
  };
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearch = useCallback((value: string) => {
    setKeyword(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (value.trim()) params.set('keyword', value.trim()); else params.delete('keyword');
      params.set('page', '1');
      startTransition(() => {
        router.push(`/clients?${params.toString()}`);
      });
    }, 300);
  }, [router, searchParams]);
  useEffect(() => () => { if (searchTimer.current) clearTimeout(searchTimer.current); }, []);

  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  /**
   * 复制 Client ID：clipboard 在非安全上下文 / iframe / 权限被拒时会 **reject**。
   * 此前 fire-and-forget 且无条件显示"已复制"——实测抛出未处理的
   * `Write permission denied` pageerror，同时给用户错误反馈（显示成功、实际没复制）。
   * 现在：await + 失败回退 execCommand；两者都失败才提示手动复制。
   */
  const handleCopy = async (text: string, id: string) => {
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      document.body.removeChild(textarea);
    }
    if (!copied) {
      toast.error('复制失败，请手动选择 Client ID 复制');
      return;
    }
    setCopiedId(id);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  const { reportFailure } = useFieldFailure();

  /**
   * 注销应用：**设计系统二次确认弹窗**（此前是原生 confirm()——与全站风格不一致，
   * 且原生 confirm 在自动化/PWA/部分内嵌浏览器里会被拦截，导致"点了没反应"）。
   */
  const [deleteTarget, setDeleteTarget] = useState<ClientRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const res = await deleteClientAction(deleteTarget.clientId);
    setDeleting(false);
    if (res.success) {
      toast.success(res.message);
      setDeleteTarget(null);
      router.refresh();
    } else {
      reportFailure(res);
    }
  };

  const activeCount = statusCounts?.active ?? clients.filter(c => c.status === 'ACTIVE').length;
  const disabledCount = statusCounts?.disabled ?? clients.filter(c => c.status === 'DISABLED').length;

  const columns = [
    { key: 'detail', header: '应用详情', className: 'w-[280px]' },
    { key: 'clientId', header: '身份标识 (Client ID)', className: 'hidden md:table-cell' },
    { key: 'redirectUris', header: '回调白名单 (Redirect URIs)', className: 'hidden xl:table-cell' },
    { key: 'lastUsed', header: '最近使用', className: 'hidden w-[110px] min-[1100px]:table-cell' },
    { key: 'status', header: '运行状态' },
    { key: 'actions', header: '操作', className: 'text-right' },
  ];

  const cardHeader = (
    <TableToolbar
      left={
        <div className="flex min-w-0 flex-col gap-2 md:flex-row md:items-center md:gap-3">
          <div className="flex items-center gap-2">
            <h1 className="shrink-0 text-[15px] font-semibold tracking-tight text-foreground">应用管理</h1>
            <div className="hidden items-center gap-2 min-[1100px]:flex">
              <Badge variant="success" className="h-5 px-1.5 text-[10px]">启用 {activeCount}</Badge>
              <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">停用 {disabledCount}</Badge>
            </div>
          </div>
          <div className="grid w-full grid-cols-2 gap-2 md:flex md:w-auto md:items-center md:gap-2">
            <SearchInput className="col-span-2 md:w-56 xl:w-64" placeholder="搜索应用或 Client ID" value={keyword} onChange={handleSearch} busy={isPending} />
            <Select value={initialStatus || 'ALL'} onValueChange={(v) => applyStatus(v === 'ALL' ? '' : v)} disabled={isPending}>
              <SelectTrigger aria-label="过滤应用状态" className="w-full md:w-36">
                <SelectValue>
                  {initialStatus === 'ACTIVE' ? '运行中' : initialStatus === 'DISABLED' ? '已禁用' : '全部状态'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">全部状态</SelectItem>
                <SelectItem value="ACTIVE">运行中</SelectItem>
                <SelectItem value="DISABLED">已禁用</SelectItem>
              </SelectContent>
            </Select>
            <Select value={initialSort} onValueChange={applySort} disabled={isPending}>
              <SelectTrigger aria-label="应用排序" className="w-full md:w-32">
                <SelectValue>
                  {initialSort === 'name' ? '按名称' : initialSort === 'updated' ? '最近更新' : '最近创建'}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="recent">最近创建</SelectItem>
                <SelectItem value="updated">最近更新</SelectItem>
                <SelectItem value="name">按名称</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      }
      right={
        <>
          <PermissionGuard permission={CLIENT_PERMISSIONS.CREATE}>
            <Button asChild>
              <Link href="/clients/new">
                <Plus className="h-4 w-4" /> 注册新应用
              </Link>
            </Button>
          </PermissionGuard>
        </>
      }
    />
  );

  const renderRow = (client: ClientRow) => (
    <TableRow key={client.clientId} className="group hover:bg-muted/50 transition-colors">
      <TableCell>
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="h-7 w-7 shrink-0 rounded-md border border-border/40 shadow-sm">
              <AvatarImage src={client.logoUrl || ''} />
              <AvatarFallback className="bg-gradient-to-br from-muted to-muted/50 text-muted-foreground font-semibold text-xs">
                {avatarFallback(client.name)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-card rounded-full flex items-center justify-center border border-border/60 shadow-sm">
              <Globe className="h-2.5 w-2.5 text-primary" />
            </div>
          </div>
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="block max-w-[180px] truncate text-[12px] font-semibold leading-4 text-foreground transition-colors group-hover:text-primary" title={client.name}>{client.name}</span>
            {client.homepageUrl ? (
              <a href={client.homepageUrl} target="_blank" className="flex max-w-[180px] items-center gap-1 truncate text-[10px] leading-3 text-muted-foreground transition-colors hover:text-primary" rel="noreferrer" title={client.homepageUrl}>
                <span className="truncate">{client.homepageUrl}</span> <ExternalLink className="h-2 w-2 shrink-0" />
              </a>
            ) : (
              <span className="text-[10px] leading-3 text-muted-foreground">内部应用</span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell className="hidden md:table-cell">
        <div className="flex items-center gap-2">
          <code className="block max-w-[150px] truncate rounded-md border border-border/50 bg-muted px-2 py-1 font-mono text-xs text-foreground/70" title={client.clientId}>
            {client.clientId}
          </code>
          <Button
            variant="ghost"
            size="icon"
            aria-label="复制 Client ID"
            className="h-8 w-8 rounded-md hover:bg-card hover:shadow-sm transition-all"
            onClick={() => handleCopy(client.clientId, client.clientId)}
          >
            {copiedId === client.clientId ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
          </Button>
        </div>
      </TableCell>
      <TableCell className="hidden xl:table-cell">
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {client.redirectUris.slice(0, 1).map((uri, i) => (
            <Badge key={i} variant="outline" title={uri} className="h-auto max-w-[210px] justify-start overflow-hidden border-border bg-card font-mono font-normal shadow-sm">
              <span className="truncate">{formatRedirectUri(uri)}</span>
            </Badge>
          ))}
          {client.redirectUris.length > 1 && (
            <Badge variant="secondary">+{client.redirectUris.length - 1}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell className="hidden min-[1100px]:table-cell">
        <span className="text-[12px] text-muted-foreground" title={client.lastUsedAt ?? '尚未签发过 token'}>
          {client.lastUsedAt ? formatDate(client.lastUsedAt) : '从未'}
        </span>
      </TableCell>
      <TableCell>
        <Badge variant={enableStatus(client.status).variant}>
          {enableStatus(client.status).label}
        </Badge>
      </TableCell>
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-0.5">
          <PermissionGuard permission={CLIENT_PERMISSIONS.UPDATE}>
            <Button asChild variant="ghost" size="sm" className="h-8 gap-1.5 px-2" aria-label="编辑 OAuth 配置" title="编辑 OAuth 配置">
              <Link href={`/clients/${client.clientId}?returnTo=${encodeURIComponent(currentListHref)}`}><Edit className="h-4 w-4" /><span className="hidden md:inline">编辑配置</span></Link>
            </Button>
          </PermissionGuard>
          <PermissionGuard permission={CLIENT_PERMISSIONS.DELETE}>
            <Button
              variant="ghost"
              size="sm"
              aria-label="注销应用"
              title={client.clientId === PORTAL_CLIENT_ID ? 'Portal 自身客户端不可注销' : '注销应用'}
              disabled={client.clientId === PORTAL_CLIENT_ID}
              className="h-8 gap-1.5 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
              onClick={() => setDeleteTarget(client)}
            >
              <Trash2 className="h-4 w-4" /><span className="hidden md:inline">注销</span>
            </Button>
          </PermissionGuard>
        </div>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col">
      <DataTable
        columns={columns}
        data={clients}
        loading={isPending}
        emptyState={
          isFiltered ? (
            <EmptyState
              variant="simple"
              kind="filtered"
              icon="Inbox"
              clearAction={{ label: '清除筛选', href: clearHref }}
            />
          ) : (
            <EmptyState
              variant="simple"
              icon="AppWindow"
              title="暂无 OAuth 应用"
              description="注册 OAuth 客户端以开始集成"
              action={{ label: '注册应用', href: '/clients/new' }}
            />
          )
        }
        renderRow={renderRow}
        cardHeader={cardHeader}
      />
      <TablePagination
        page={pagination.page}
        totalPages={pagination.totalPages}
        total={pagination.total}
        onPageChange={(next) => {
          const params = new URLSearchParams(window.location.search);
          if (next > 1) params.set('page', String(next)); else params.delete('page');
          startTransition(() => router.push(`/clients${params.toString() ? `?${params.toString()}` : ''}`));
        }}
        disabled={isPending}
      />
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>注销应用「{deleteTarget?.name}」？</DialogTitle>
            <DialogDescription>
              注销后该 Client 及其全部授权 Token 会被立即移除，所有接入方将无法再通过本应用登录。此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>取消</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? '注销中...' : '确认注销'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

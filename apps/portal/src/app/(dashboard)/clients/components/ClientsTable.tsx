'use client';

/**
 * Client 列表表格 — 客户端交互组件
 * 职责：搜索/复制/下拉菜单等浏览器交互，写操作通过 Server Actions 直调
 */
import React, { useState, useCallback, useTransition, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  Search, Copy, ExternalLink, MoreHorizontal, Edit, Trash2, Globe, Check, Lock, AppWindow,
} from 'lucide-react';
import {
  TableCell, TableRow,
} from '@/components/ui/table';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { DataTable } from '@/components/shared/data-table';
import { EmptyState } from '@/components/shared/empty-state';
import { deleteClientAction } from '../actions';

interface ClientRow {
  clientId: string;
  name: string;
  redirectUris: string[];
  scopes: string;
  homepageUrl: string | null;
  logoUrl: string | null;
  status: string;
  createdAt: string;
}

interface Props {
  clients: ClientRow[];
  initialKeyword: string;
}

export default function ClientsTable({ clients, initialKeyword }: Props) {
  const router = useRouter();
  const [keyword, setKeyword] = useState(initialKeyword);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSearch = useCallback((value: string) => {
    setKeyword(value);
    const params = new URLSearchParams();
    if (value) params.set('keyword', value);
    startTransition(() => {
      router.push(`/clients${params.toString() ? `?${params.toString()}` : ''}`);
    });
  }, [router]);

  const timerRef = useRef<ReturnType<typeof setTimeout>>(null);

  useEffect(() => {
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, []);

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (clientId: string) => {
    if (!confirm('确认注销该应用？此操作不可撤销。')) return;
    const res = await deleteClientAction(clientId);
    if (res.success) { toast.success(res.message); } else { toast.error(res.message); }
    router.refresh();
  };

  const activeCount = clients.filter(c => c.status === 'ACTIVE').length;
  const disabledCount = clients.filter(c => c.status === 'DISABLED').length;

  const columns = [
    { key: 'detail', header: '应用详情', className: 'pl-8 w-[280px]' },
    { key: 'clientId', header: '身份标识 (Client ID)' },
    { key: 'redirectUris', header: '回调白名单 (Redirect URIs)' },
    { key: 'status', header: '运行状态' },
    { key: 'actions', header: '操作', className: 'text-right pr-8' },
  ];

  const cardHeader = (
    <div className="bg-muted/50 border-b py-6 px-8">
      <div className="flex flex-col md:flex-row gap-6 items-center justify-between">
        <div className="relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
          <Input
            placeholder="搜索应用名称或 Client ID..."
            className="pl-10 bg-card border-none rounded-xl h-11 shadow-inner"
            value={keyword}
            onChange={e => handleSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-success" />
            <span>已启用: {activeCount}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
            <span>已禁用: {disabledCount}</span>
          </div>
        </div>
      </div>
    </div>
  );

  const renderRow = (client: ClientRow) => (
    <TableRow key={client.clientId} className="group hover:bg-muted/50 transition-colors">
      <TableCell className="pl-8 py-5">
        <div className="flex items-center gap-4">
          <div className="relative">
            <Avatar className="h-11 w-11 rounded-xl ring-2 ring-background shadow-sm border border-border/40">
              <AvatarImage src={client.logoUrl || ''} />
              <AvatarFallback className="bg-gradient-to-br from-muted to-muted/50 text-muted-foreground font-black text-xs uppercase">
                {client.name.substring(0, 2)}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-card rounded-full flex items-center justify-center ring-1 ring-border/20 shadow-sm">
              <Globe className="h-2.5 w-2.5 text-primary" />
            </div>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="font-bold text-sm leading-tight text-foreground group-hover:text-primary transition-colors">{client.name}</span>
            {client.homepageUrl ? (
              <a href={client.homepageUrl} target="_blank"                 className="text-[10px] text-muted-foreground hover:text-primary flex items-center gap-1 transition-colors" rel="noreferrer">
                {client.homepageUrl} <ExternalLink className="h-2 w-2" />
              </a>
            ) : (
              <span className="text-[10px] text-muted-foreground">Internal Application</span>
            )}
          </div>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex items-center gap-2">
          <code className="text-[11px] font-mono bg-muted text-foreground/70 px-2 py-1 rounded-lg border border-border/50">
            {client.clientId}
          </code>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 rounded-md hover:bg-card hover:shadow-sm transition-all"
            onClick={() => handleCopy(client.clientId, client.clientId)}
          >
            {copiedId === client.clientId ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3 text-muted-foreground" />}
          </Button>
        </div>
      </TableCell>
      <TableCell>
        <div className="flex flex-wrap gap-1 max-w-[200px]">
          {client.redirectUris.slice(0, 1).map((uri, i) => (
            <Badge key={i} variant="outline" className="text-[10px] font-mono py-0 h-5 border-border bg-card shadow-sm font-medium">
              {uri}
            </Badge>
          ))}
          {client.redirectUris.length > 1 && (
            <Badge variant="secondary" className="text-[10px] py-0 h-5">+{client.redirectUris.length - 1}</Badge>
          )}
        </div>
      </TableCell>
      <TableCell>
        <Badge
          variant={client.status === 'ACTIVE' ? 'success' : 'secondary'}
          className="px-2.5 py-0.5 font-bold tracking-wider text-[10px]"
        >
          {client.status === 'ACTIVE' ? 'ACTIVE' : 'DISABLED'}
        </Badge>
      </TableCell>
      <TableCell className="text-right pr-8">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg hover:bg-card hover:shadow-md transition-all">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48 rounded-xl p-2 shadow-2xl">
            <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-2 py-1.5">应用操作</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
              <Link href={`/clients/${client.clientId}`} className="flex items-center gap-2 py-2">
                <Edit className="h-4 w-4 text-primary" /> 编辑 OAuth 配置
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
              <Link href={`/clients/${client.clientId}`} className="flex items-center gap-2 py-2">
                <Lock className="h-4 w-4 text-orange-500" /> 管理 Secret & Tokens
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="rounded-lg cursor-pointer text-destructive focus:bg-destructive/5 focus:text-destructive"
              onClick={() => handleDelete(client.clientId)}
            >
              <Trash2 className="h-4 w-4 mr-2" /> 注销该应用
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </TableCell>
    </TableRow>
  );

  return (
    <>
      <DataTable
        columns={columns}
        data={clients}
        loading={isPending}
        emptyState={
          <EmptyState
            variant="simple"
            icon={AppWindow}
            title="暂无 OAuth 应用"
            description="注册 OAuth 客户端以开始集成"
            action={{ label: '注册应用', href: '/clients/new' }}
          />
        }
        renderRow={renderRow}
        cardHeader={cardHeader}
      />
    </>
  );
}

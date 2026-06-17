'use client';

/**
 * Client 列表表格 — 客户端交互组件
 * 职责：搜索/复制/下拉菜单等浏览器交互，写操作通过 Server Actions 直调
 */
import React, { useState, useCallback, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Search, Copy, ExternalLink, MoreHorizontal, Edit, Trash2, Globe, Check, Lock,
} from 'lucide-react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { deleteClientAction } from '../actions';

interface ClientRow {
  id: string;
  publicId: string;
  name: string;
  clientId: string;
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

  const handleCopy = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleDelete = async (clientId: string) => {
    if (!confirm('确认注销该应用？此操作不可撤销。')) return;
    await deleteClientAction(clientId);
    router.refresh();
  };

  const activeCount = clients.filter(c => c.status === 'ACTIVE').length;
  const disabledCount = clients.filter(c => c.status === 'DISABLED').length;

  return (
    <Card className="border-none shadow-sm ring-1 ring-border/50 overflow-hidden rounded-[1.5rem]">
      <CardHeader className="bg-slate-50/50 dark:bg-slate-900/50 border-b py-6 px-8">
        <div className="flex flex-col md:flex-row gap-6 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground opacity-50" />
            <Input
              placeholder="搜索应用名称或 Client ID..."
              className="pl-10 bg-white dark:bg-slate-950 border-none rounded-xl h-11 shadow-inner"
              value={keyword}
              onChange={e => handleSearch(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-green-500" />
              <span>已启用: {activeCount}</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-2 w-2 rounded-full bg-slate-300" />
              <span>已禁用: {disabledCount}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader className="bg-slate-50/30">
            <TableRow>
              <TableHead className="pl-8 w-[280px]">应用详情</TableHead>
              <TableHead>身份标识 (Client ID)</TableHead>
              <TableHead>回调白名单 (Redirect URIs)</TableHead>
              <TableHead>运行状态</TableHead>
              <TableHead className="text-right pr-8">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isPending ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell className="pl-8"><div className="flex gap-3"><Skeleton className="h-10 w-10 rounded-lg" /><div className="space-y-2"><Skeleton className="h-4 w-24" /><Skeleton className="h-3 w-32" /></div></div></TableCell>
                  <TableCell><Skeleton className="h-6 w-32 rounded" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-48" /></TableCell>
                  <TableCell><Skeleton className="h-6 w-16 rounded-full" /></TableCell>
                  <TableCell className="text-right pr-8"><Skeleton className="ml-auto h-8 w-8 rounded-md" /></TableCell>
                </TableRow>
              ))
            ) : clients.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="h-64 text-center text-muted-foreground">
                  未找到已注册的 OAuth 应用
                </TableCell>
              </TableRow>
            ) : (
              clients.map((client) => (
                <TableRow key={client.id} className="group hover:bg-slate-50/50 transition-colors">
                  <TableCell className="pl-8 py-5">
                    <div className="flex items-center gap-4">
                      <div className="relative">
                        <Avatar className="h-11 w-11 rounded-xl ring-2 ring-background shadow-sm border border-border/40">
                          <AvatarImage src={client.logoUrl || ''} />
                          <AvatarFallback className="bg-gradient-to-br from-slate-100 to-slate-200 text-slate-500 font-black text-xs uppercase">
                            {client.name.substring(0, 2)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="absolute -bottom-1 -right-1 h-4 w-4 bg-white dark:bg-slate-900 rounded-full flex items-center justify-center ring-1 ring-border/20 shadow-sm">
                          <Globe className="h-2.5 w-2.5 text-blue-500" />
                        </div>
                      </div>
                      <div className="flex flex-col gap-0.5">
                        <span className="font-bold text-sm leading-tight text-slate-900 group-hover:text-primary transition-colors">{client.name}</span>
                        {client.homepageUrl ? (
                          <a href={client.homepageUrl} target="_blank" className="text-[10px] text-muted-foreground hover:text-blue-600 flex items-center gap-1 transition-colors" rel="noreferrer">
                            {client.homepageUrl} <ExternalLink className="h-2 w-2" />
                          </a>
                        ) : (
                          <span className="text-[10px] text-slate-400">Internal Application</span>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <code className="text-[11px] font-mono bg-slate-100 dark:bg-slate-800 text-slate-600 px-2 py-1 rounded-lg border border-slate-200/50">
                        {client.clientId}
                      </code>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 rounded-md hover:bg-white hover:shadow-sm transition-all"
                        onClick={() => handleCopy(client.clientId, client.id)}
                      >
                        {copiedId === client.id ? <Check className="h-3 w-3 text-green-600" /> : <Copy className="h-3 w-3 text-slate-400" />}
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1 max-w-[200px]">
                      {client.redirectUris.slice(0, 1).map((uri, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] font-mono py-0 h-5 border-slate-200 bg-white shadow-sm font-medium">
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
                        <Button variant="ghost" size="icon" className="h-9 w-9 rounded-xl hover:bg-white hover:shadow-md transition-all">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-48 rounded-xl p-2 shadow-2xl">
                        <DropdownMenuLabel className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2 py-1.5">应用操作</DropdownMenuLabel>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                          <Link href={`/clients/${client.id}`} className="flex items-center gap-2 py-2">
                            <Edit className="h-4 w-4 text-blue-500" /> 编辑 OAuth 配置
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild className="rounded-lg cursor-pointer">
                          <Link href={`/clients/${client.id}`} className="flex items-center gap-2 py-2">
                            <Lock className="h-4 w-4 text-orange-500" /> 管理 Secret & Tokens
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="rounded-lg cursor-pointer text-destructive focus:bg-destructive/5 focus:text-destructive"
                          onClick={() => handleDelete(client.id)}
                        >
                          <Trash2 className="h-4 w-4 mr-2" /> 注销该应用
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

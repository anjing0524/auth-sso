/**
 * Client 授权 Token Section — Token 列表 + 撤销操作
 */
'use client';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { ClientTokenDTO as Token } from '../../data';

import { formatDateTime } from '@/lib/format-date';
export interface ClientTokensSectionProps {
  tokens: Token[];
  /** 有效授权总数（tokens 可能只含最近 10 条） */
  total?: number;
  onRevokeAll: () => Promise<void> | void;
  /** 撤销单条授权（可选；传入时显示行操作） */
  onRevokeToken?: (token: Token) => void;
  /** 缺少 client:update 时只读：不渲染撤销入口 */
  canRevoke?: boolean;
}

export function ClientTokensSection({ tokens, total = tokens.length, onRevokeAll, onRevokeToken, canRevoke = true }: ClientTokensSectionProps) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between border-b pb-4">
        <div className="flex items-center gap-2"><CardTitle>有效授权 Token</CardTitle><span className="text-xs text-muted-foreground">共 {total} 条</span></div>
        {canRevoke && (
          <Button
            variant="destructive"
            size="sm"
            onClick={onRevokeAll}
            disabled={total === 0}
            title={total === 0 ? '当前没有有效授权可撤销' : undefined}
          >
            撤销所有
          </Button>
        )}
      </CardHeader>
      {total > tokens.length && (
        <p className="border-b bg-muted/30 px-3 py-1.5 text-[11px] text-muted-foreground">
          仅显示最近 {tokens.length} 条，共 {total} 条有效授权；如需清理请使用「撤销所有」。
        </p>
      )}
      <CardContent className="p-0">
        <Table aria-label="访问令牌列表">
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>过期时间</TableHead>
              {canRevoke && onRevokeToken ? <TableHead className="text-right">操作</TableHead> : null}
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.length === 0 ? (
              <TableRow>
                <TableCell colSpan={canRevoke && onRevokeToken ? 5 : 4} className="h-24 text-center text-muted-foreground">
                  暂无有效授权
                </TableCell>
              </TableRow>
            ) : (
              tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.username ?? '—'}</TableCell>
                  <TableCell className="max-w-[200px] truncate text-muted-foreground xl:max-w-[260px]" title={token.scopes.join(', ')}>
                    {token.scopes.join(', ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(token.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(token.expiresAt)}
                  </TableCell>
                  {canRevoke && onRevokeToken ? (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive"
                        aria-label={`撤销 ${token.username ?? '该用户'} 于 ${formatDateTime(token.createdAt)} 创建的授权`}
                        onClick={() => onRevokeToken(token)}
                      >
                        撤销
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}

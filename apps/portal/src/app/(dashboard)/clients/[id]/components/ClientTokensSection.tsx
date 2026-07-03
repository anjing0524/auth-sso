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

export interface ClientTokensSectionProps {
  tokens: Token[];
  onRevokeAll: () => Promise<void>;
}

function formatDate(date: Date | string | null): string {
  if (!date) return '-';
  return new Date(date).toLocaleString('zh-CN');
}

export function ClientTokensSection({ tokens, onRevokeAll }: ClientTokensSectionProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between border-b pb-4">
        <CardTitle className="text-base font-bold">授权 Token 列表</CardTitle>
        <Button
          variant="destructive"
          size="sm"
          onClick={onRevokeAll}
        >
          撤销所有
        </Button>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>用户</TableHead>
              <TableHead>Scopes</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead>过期时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tokens.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-24 text-center text-muted-foreground">
                  暂无授权记录
                </TableCell>
              </TableRow>
            ) : (
              tokens.map((token) => (
                <TableRow key={token.id}>
                  <TableCell className="font-medium">{token.username}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {token.scopes.join(', ')}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(token.createdAt)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDate(token.expiresAt)}
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

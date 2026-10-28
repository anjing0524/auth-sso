import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { DynamicIcon } from '@/lib/icon-map';

/**
 * 全站 404 页。
 *
 * 此前仓里没有 `not-found.tsx`：`/help`、`/privacy`、`/users/<不存在的 id>` 等
 * 都会渲染 Next 默认的英文 404（"This page could not be found."），与中文产品风格割裂，
 * 且没有任何返回入口（审计 P2-5）。
 */
export const metadata = { title: '页面不存在 | Auth-SSO' };

export default function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <DynamicIcon name="FileText" className="h-8 w-8" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">404</p>
        <h1 className="text-2xl font-bold tracking-tight">页面不存在</h1>
        <p className="text-sm text-muted-foreground">你访问的地址可能已被移动或删除。</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <Button asChild>
          <Link href="/dashboard">返回工作台</Link>
        </Button>
      </div>
    </main>
  );
}

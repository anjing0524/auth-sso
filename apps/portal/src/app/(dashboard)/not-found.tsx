import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { DynamicIcon } from '@/lib/icon-map';

export const metadata = { title: '页面不存在 | Auth-SSO' };

/**
 * dashboard 内 404：布局已提供 main/nav，这里只渲染主内容区，避免嵌套 main。
 */
export default function DashboardNotFound() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 p-8 text-center">
      <title>页面不存在 | Auth-SSO</title>
      <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-muted text-muted-foreground">
        <DynamicIcon name="FileText" className="h-8 w-8" aria-hidden="true" />
      </div>
      <div className="space-y-2">
        <p className="text-sm font-semibold text-muted-foreground">404</p>
        <h1 className="text-2xl font-bold tracking-tight">页面不存在</h1>
        <p className="text-sm text-muted-foreground">你访问的地址可能已被移动或删除。</p>
      </div>
      <Button asChild>
        <Link href="/dashboard">返回工作台</Link>
      </Button>
    </div>
  );
}

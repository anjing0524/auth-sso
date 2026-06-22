/**
 * Dashboard 路由组加载骨架屏 (Loading Skeleton)
 *
 * 在 Server Component 数据获取期间渲染，替代空白页面。
 * 子页面可覆盖此文件以提供更细粒度的加载 UI。
 *
 * @module app/(dashboard)/loading
 */
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function DashboardLoading() {
  return (
    <div className="space-y-6 p-1 pt-2 animate-in fade-in duration-300">
      {/* Header skeleton */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 rounded-xl" />
          <Skeleton className="h-4 w-64 rounded-lg" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>

      {/* Content card skeleton */}
      <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-[1.5rem] overflow-hidden">
        <CardHeader className="bg-slate-50/50 py-4 px-6 border-b">
          <Skeleton className="h-10 w-full max-w-md rounded-xl" />
        </CardHeader>
        <CardContent className="p-6">
          <div className="space-y-3">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

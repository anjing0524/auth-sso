/**
 * 审计日志页加载骨架屏 (Loading Skeleton)
 *
 * 在 audit-logs Server Component 数据获取期间渲染，替代空白页面。
 *
 * @module app/(dashboard)/audit-logs/loading
 */
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export default function AuditLogsLoading() {
  return (
    <div className="space-y-6 p-1 pt-2 animate-in fade-in duration-300">
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-1">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 rounded-xl" />
          <Skeleton className="h-4 w-64 rounded-lg" />
        </div>
      </div>

      {/* Tab skeleton */}
      <div className="flex gap-8 border-b border-border pb-4">
        <Skeleton className="h-8 w-20 rounded-lg" />
        <Skeleton className="h-8 w-20 rounded-lg" />
      </div>

      {/* Content card skeleton */}
      <Card className="border-none shadow-sm ring-1 ring-border/50 rounded-xl overflow-hidden">
        <CardContent className="p-0">
          <div className="space-y-0">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
                <Skeleton className="h-4 w-32 rounded" />
                <Skeleton className="h-4 w-20 rounded" />
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-4 w-28 rounded" />
                <Skeleton className="h-4 w-20 rounded" />
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

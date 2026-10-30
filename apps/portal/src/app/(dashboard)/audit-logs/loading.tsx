/**
 * 审计日志页加载骨架屏 (Loading Skeleton)
 *
 * 在 audit-logs Server Component 数据获取期间渲染，替代空白页面。
 *
 * @module app/(dashboard)/audit-logs/loading
 */
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';
import { LoadingAnnouncer } from '@/components/shared/loading-announcer';

export default function AuditLogsLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <LoadingAnnouncer />
      {/* Header skeleton */}
      <div className="flex items-center justify-between px-1">
        <div className="space-y-2">
          <Skeleton className="h-8 w-48 rounded-xl" />
          <Skeleton className="h-4 w-64 rounded-lg" />
        </div>
      </div>

      {/* Tab + filter skeleton */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-6 border-b border-border pb-4">
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
          <Skeleton className="h-8 w-20 rounded-lg" />
        </div>
        <Skeleton className="h-9 w-32 rounded-lg" />
      </div>

      {/* Content card skeleton */}
      <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
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

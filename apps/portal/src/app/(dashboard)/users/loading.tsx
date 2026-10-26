/**
 * 用户管理 加载骨架屏 — 与列表页模板一致（标题/工具条/表头/行）
 */
import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function UsersLoading() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
        <div className="flex items-center gap-3 border-b bg-muted/30 px-3 py-1.5">
          <Skeleton className="h-5 w-24 rounded" />
          <Skeleton className="h-8 w-56 rounded-lg" />
          <Skeleton className="ml-auto h-8 w-24 rounded-lg" />
        </div>
        <CardContent className="p-0">
          <div className="flex items-center gap-4 border-b bg-muted/20 px-3 py-2.5">
            {[40, 120, 80, 96, 72].map((w, i) => (
              <Skeleton key={i} className="h-3 rounded" style={{ width: w }} />
            ))}
          </div>
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 border-b border-border/40 px-3 py-2.5 last:border-0">
              <Skeleton className="h-7 w-7 rounded-md" />
              <Skeleton className="h-4 w-48 rounded" />
              <Skeleton className="h-4 w-28 rounded" />
              <Skeleton className="h-4 w-32 rounded" />
              <Skeleton className="ml-auto h-5 w-16 rounded-full" />
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

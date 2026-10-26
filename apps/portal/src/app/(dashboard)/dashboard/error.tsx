'use client';

import { RouteError } from '@/components/shared/route-error';

/** 路由错误边界：统一 UI（重试/返回工作台/复制 Error ID）。 */
export default function DashboardRouteError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <RouteError {...props} loggerName="DashboardRouteError" />;
}

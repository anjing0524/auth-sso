/**
 * 遥测客户端 hook — fire-and-forget 事件上报
 *
 * 使用 sendBeacon 确保页面卸载时事件不丢失。
 * 生产环境由 Vector/Fluentd 采集 stdout → SIEM/数据仓库。
 */
export function trackEvent(type: string, meta?: Record<string, unknown>) {
  const payload = JSON.stringify({ type, path: location.pathname, meta });
  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/telemetry', new Blob([payload], { type: 'application/json' }));
  } else {
    fetch('/api/telemetry', { method: 'POST', body: payload, keepalive: true }).catch(() => {});
  }
}

/** 页面浏览 */
export function trackPageView() {
  trackEvent('page_view');
}

/** 功能使用 */
export function trackFeature(feature: string) {
  trackEvent('feature_use', { feature });
}

/** 错误上报 */
export function trackError(error: Error, context?: string) {
  trackEvent('error', { message: error.message, stack: error.stack?.slice(0, 500), context });
}

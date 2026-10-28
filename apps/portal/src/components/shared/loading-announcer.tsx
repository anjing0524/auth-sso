/**
 * 路由级加载播报：骨架屏对读屏不可见，需要独立的 live region 告知“正在加载”。
 */
export function LoadingAnnouncer() {
  return (
    <p role="status" aria-live="polite" className="sr-only">
      正在加载页面…
    </p>
  );
}

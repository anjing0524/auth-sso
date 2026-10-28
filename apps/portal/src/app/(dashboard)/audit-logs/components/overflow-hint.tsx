'use client';

/**
 * 裸 Table（审计页）的横向滚动提示：只在内容真实溢出时显示。
 * 与 shared/DataTable 同口径，避免"表格已适配仍提示左右滑动"。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';

export function OverflowHint({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  useEffect(() => {
    const scroller = ref.current?.querySelector<HTMLElement>('.overflow-auto');
    if (!scroller) return;
    const check = () => setOverflowing(scroller.scrollWidth > scroller.clientWidth + 1);
    check();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(check);
    ro.observe(scroller);
    const table = scroller.querySelector('table');
    if (table) ro.observe(table);
    return () => ro.disconnect();
  }, [children]);

  return (
    <div ref={ref} className="flex min-h-0 flex-1 flex-col">
      {overflowing && (
        <p className="border-b bg-muted/30 px-4 py-1.5 text-[11px] text-muted-foreground lg:hidden">
          左右滑动查看完整表格
        </p>
      )}
      {children}
    </div>
  );
}

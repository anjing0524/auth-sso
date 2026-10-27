'use client';

/**
 * 审计日志页签（WAI-ARIA tabs 键盘语义，U-LOG02 补全）
 *
 * 背景：此前页签是裸 `<Link role="tab">`——视觉与读屏语义看似 tabs，但键盘只有 Tab 键
 * 能逐个经过、方向键无效、且两个页签都在 Tab 序列里（"半套 tabs"）。真实 tabs 的要求：
 * - `tablist` 内只有一个页签可达（roving tabindex：选中项 tabIndex=0，其余 -1）；
 * - ←/→ 在页签间移动焦点，Home/End 跳到首/末；
 * - Enter/Space 激活当前聚焦的页签（这里用 Next Link 导航，原生链接语义即可）。
 *
 * 为什么不改成"方向键即切换"的自动激活：本页签切换会触发服务端搜索参数导航（整页数据重取），
 * 焦点移动就自动请求并不合适；采用 WAI-ARIA 推荐的**手动激活**模式。
 *
 * @module app/(dashboard)/audit-logs/components/audit-tabs
 */
import Link from 'next/link';
import { useRef, useState } from 'react';

export type AuditTab = 'login' | 'operation' | 'access';

const TAB_ORDER: readonly AuditTab[] = ['login', 'operation', 'access'];
const TAB_LABELS: Record<AuditTab, string> = {
  login: '登录日志',
  operation: '操作日志',
  access: '访问日志',
};

export function AuditTabs({ tab, hrefs }: { tab: AuditTab; hrefs: Record<AuditTab, string> }) {
  const itemRefs = useRef<Record<AuditTab, HTMLAnchorElement | null>>({
    login: null,
    operation: null,
    access: null,
  });
  // 焦点位置（roving tabindex 的"可 Tab 进入项"始终是当前 tab 或用户移动后的焦点项）
  const [focused, setFocused] = useState<AuditTab>(tab);

  const moveFocus = (next: AuditTab) => {
    setFocused(next);
    itemRefs.current[next]?.focus();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLAnchorElement>, current: AuditTab) => {
    const index = TAB_ORDER.indexOf(current);
    switch (event.key) {
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(TAB_ORDER[(index + 1) % TAB_ORDER.length]!);
        break;
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(TAB_ORDER[(index - 1 + TAB_ORDER.length) % TAB_ORDER.length]!);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(TAB_ORDER[0]!);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(TAB_ORDER[TAB_ORDER.length - 1]!);
        break;
      default:
        break;
    }
  };

  return (
    <div role="tablist" aria-label="日志类型" className="inline-flex h-10 items-center rounded-lg bg-muted p-1">
      {TAB_ORDER.map((value) => {
        const selected = tab === value;
        return (
          <Link
            key={value}
            ref={(node) => { itemRefs.current[value] = node; }}
            id={`audit-tab-${value}`}
            role="tab"
            aria-selected={selected}
            aria-controls="audit-tabpanel"
            // roving tabindex：只有"当前应被 Tab 键到达"的那一项在 Tab 序列里
            tabIndex={focused === value ? 0 : -1}
            href={hrefs[value]}
            onFocus={() => setFocused(value)}
            onKeyDown={(event) => onKeyDown(event, value)}
            className={`inline-flex h-8 items-center rounded-md px-2.5 text-sm font-medium transition-colors ${
              selected
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {TAB_LABELS[value]}
          </Link>
        );
      })}
    </div>
  );
}

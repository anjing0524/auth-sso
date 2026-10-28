import Link from 'next/link';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { PaginationJump } from './pagination-jump';
import { PaginationJumpForm } from './pagination-jump-form';

/**
 * 列表页统一分页条（唯一实现）。
 *
 * 形态：左侧「共 N 条记录」；右侧「首页 ‹ 上一页 · 页码窗口 · 下一页 › 末页 · 跳至 __ 页」。
 *
 * 背景（2026-10-21 规模数据审计）：只有「上一页/下一页」时，201 用户=14 页、
 * 345 权限=23 页、5251 审计=351 页，回到中间页需要连点几十次。现在：
 * - 页码窗口（1 … 当前±1 … 末页）+ 首页/末页按钮；
 * - 客户端列表（onPageChange）用 `<PaginationJump>` 输入页码跳转；
 * - 服务端列表（hrefFor）用同构 GET form 跳转，保持无 JS 可用。
 *
 * 服务端模式只给 DOM 传 hrefFor（Link），**不能**传 onClick —— 否则 React 报
 * "Event handlers cannot be passed to Client Component props"，整页落到 error boundary。
 */
export interface TablePaginationProps {
  page: number;
  totalPages: number;
  total: number;
  onPageChange?: (page: number) => void;
  hrefFor?: (page: number) => string;
  /** 服务端模式跳页 form 的 action（如 `/audit-logs`） */
  jumpAction?: string;
  /** 服务端模式跳页需要保留的其它查询参数（如 tab） */
  jumpParams?: Record<string, string>;
  /** 服务端模式跳页的导航注入点（组件测试用）；默认 window.location.assign */
  navigate?: (url: string) => void;
  /** 父级导航 pending 时禁用翻页，避免重复触发 */
  disabled?: boolean;
  /** 服务端列表每页条数（当前值） */
  pageSize?: number;
  /** 服务端列表每页条数选项；href 由页面生成并保留其它筛选 */
  pageSizeOptions?: Array<{ value: number; href: string }>;
}

const navButtonClass = 'h-7 gap-1 rounded-md px-2 text-xs';

function NavButton({
  label,
  to,
  disabled,
  onClick,
  children,
}: {
  label: string;
  to?: string;
  disabled: boolean;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  if (to && !disabled) {
    return (
      <Button asChild variant="outline" size="sm" className={navButtonClass} aria-label={label}>
        <Link href={to}>{children}</Link>
      </Button>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className={navButtonClass}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** 页码窗口：首、当前±1、末；中间用省略号 */
function pageItems(page: number, pages: number): Array<number | '…'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, i) => i + 1);
  const items = new Set<number>([1, pages, page - 1, page, page + 1]);
  const sorted = [...items].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b);
  const out: Array<number | '…'> = [];
  for (let i = 0; i < sorted.length; i++) {
    const current = sorted[i];
    const prev = i > 0 ? sorted[i - 1] : undefined;
    if (prev !== undefined && current !== undefined && current - prev > 1) out.push('…');
    if (current !== undefined) out.push(current);
  }
  return out;
}

export function TablePagination({
  page,
  totalPages,
  total,
  onPageChange,
  hrefFor,
  jumpAction,
  jumpParams,
  navigate,
  disabled = false,
  pageSize,
  pageSizeOptions,
}: TablePaginationProps) {
  const pages = Math.max(totalPages, 1);
  const prevTo = hrefFor?.(page - 1);
  const nextTo = hrefFor?.(page + 1);
  const items = pageItems(page, pages);

  const pageNode = (n: number) => {
    const isCurrent = n === page;
    const cls = `inline-flex h-7 min-w-7 items-center justify-center rounded-md px-2 text-xs outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring ${
      isCurrent
        ? 'border border-border bg-card font-bold shadow-sm'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50'
    }`;
    if (isCurrent) {
      return <span key={n} className={cls} aria-current="page" aria-label={`第 ${n} 页（当前）`}>{n}</span>;
    }
    const to = hrefFor?.(n);
    if (to) {
      return <Link key={n} href={to} className={cls} aria-label={`第 ${n} 页`}>{n}</Link>;
    }
    return (
      <button key={n} type="button" className={cls} aria-label={`第 ${n} 页`} disabled={disabled} onClick={() => onPageChange?.(n)}>
        {n}
      </button>
    );
  };

  // 只有一页时隐藏整套翻页控件：2 条记录却摆 6 个按钮 + 跳页输入，是"控件比数据还重"。
  // 保留总数文案（用户仍需要知道规模），多页时保持全部功能。
  if (pages <= 1) {
    return (
      <div className="-mt-px flex items-center rounded-b-lg border-t bg-muted/30 px-3 py-1.5">
        <p className="text-xs text-muted-foreground">
          共 <span className="font-semibold tabular-nums text-foreground">{total}</span> 条记录
        </p>
      </div>
    );
  }

  return (
    <div className="-mt-px flex flex-col gap-2 rounded-b-lg border-t bg-muted/30 px-3 py-1.5 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs text-muted-foreground">
          共 <span className="font-semibold tabular-nums text-foreground">{total}</span> 条记录
        </p>
        {pageSize && pageSizeOptions && pageSizeOptions.length > 0 ? (
          <div className="flex items-center gap-0.5 text-[11px] text-muted-foreground" aria-label="每页条数">
            <span>每页</span>
            {pageSizeOptions.map((option) => (
              option.value === pageSize ? (
                <span key={option.value} className="rounded bg-card px-1 font-medium text-foreground">{option.value}</span>
              ) : (
                <Link key={option.value} href={option.href} className="rounded px-1 hover:bg-muted hover:text-foreground">{option.value}</Link>
              )
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {pages > 7 ? (
          <NavButton label="首页" to={hrefFor?.(1)} disabled={disabled || page <= 1} onClick={onPageChange ? () => onPageChange(1) : undefined}>
            <ChevronsLeft className="h-3.5 w-3.5" />
          </NavButton>
        ) : null}
        <NavButton label="上一页" to={prevTo} disabled={disabled || page <= 1} onClick={onPageChange ? () => onPageChange(page - 1) : undefined}>
          <ChevronLeft className="h-3.5 w-3.5" />
          <span className="hidden text-xs sm:inline">上一页</span>
        </NavButton>

        <div className="hidden items-center gap-0.5 sm:flex">
          {items.map((item, idx) =>
            item === '…'
              ? <span key={`gap-${idx}`} className="px-1 text-xs text-muted-foreground">…</span>
              : pageNode(item),
          )}
        </div>
        <span className="text-xs text-muted-foreground sm:hidden">{page} / {pages}</span>

        <NavButton label="下一页" to={nextTo} disabled={disabled || page >= pages} onClick={onPageChange ? () => onPageChange(page + 1) : undefined}>
          <span className="hidden text-xs sm:inline">下一页</span>
          <ChevronRight className="h-3.5 w-3.5" />
        </NavButton>
        {pages > 7 ? (
          <NavButton label="末页" to={hrefFor?.(pages)} disabled={disabled || page >= pages} onClick={onPageChange ? () => onPageChange(pages) : undefined}>
            <ChevronsRight className="h-3.5 w-3.5" />
          </NavButton>
        ) : null}

        {onPageChange ? (
          <PaginationJump totalPages={pages} onPageChange={onPageChange} disabled={disabled} />
        ) : jumpAction ? (
          <PaginationJumpForm
            action={jumpAction}
            totalPages={pages}
            page={page}
            params={jumpParams}
            navigate={navigate}
          />
        ) : null}
      </div>
    </div>
  );
}

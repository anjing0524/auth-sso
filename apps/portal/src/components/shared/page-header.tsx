/**
 * PageHeader — 后台页面统一的页头（图标 + 标题 + 描述 + 右侧操作区）
 *
 * 存在的理由：审计发现同一产品里并存 4 种页头写法（h1/h2、2xl/3xl、带/不带图标、
 * 页头容器各异）。页头是"每页第一眼"的版式，必须只有一个实现。
 *
 * 无 `'use client'`：服务端页面与客户端页面都可直接使用（`icon` 是可序列化字符串，
 * 见 `IconName`）。
 */
import type { ReactNode } from 'react';
import Link from 'next/link';

import { DynamicIcon, type IconName } from '@/lib/icon-map';
import { cn } from '@/lib/utils';

type PageHeaderVariant = 'page' | 'section' | 'sticky';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 可序列化的 icon 名（见 ICON_MAP）；默认不显示图标 */
  icon?: IconName;
  /** 右侧操作区（按钮/链接） */
  actions?: ReactNode;
  /** 标题后的补充信息（状态、ID 等） */
  meta?: ReactNode;
  /** 返回上一级的链接（如列表页） */
  backHref?: string;
  backLabel?: string;
  /** page=详情/新建；section=列表工具栏；sticky=审计详情 sticky 头 */
  variant?: PageHeaderVariant;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  meta,
  backHref,
  backLabel = '返回',
  variant = 'page',
  className,
}: PageHeaderProps) {
  const isSection = variant === 'section';
  const isSticky = variant === 'sticky';
  return (
    <div
      className={cn(
        isSticky
          ? 'sticky top-0 z-20 -mx-3 flex flex-wrap items-center gap-2 border-b border-border/50 bg-background/95 px-3 py-2 backdrop-blur'
          : isSection
            ? 'flex min-w-0 items-center gap-2'
            : 'flex flex-col gap-2 md:flex-row md:items-center md:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {backHref ? (
          <Link
            href={backHref}
            aria-label={backLabel}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        ) : icon ? (
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-primary">
            <DynamicIcon name={icon} aria-hidden="true" className="h-4 w-4" />
          </span>
        ) : null}
        <h1 className={cn(isSection ? 'type-section-title' : 'type-page-title', 'min-w-0 truncate text-foreground')} title={title}>{title}</h1>
        {meta ? <div className="flex min-w-0 items-center gap-2">{meta}</div> : null}
        {description && !isSection ? (
          <p className="type-meta hidden min-w-0 truncate lg:block" title={description}>
            {description}
          </p>
        ) : null}
      </div>
      {actions && !isSection ? <div className="flex shrink-0 flex-wrap items-center gap-2 [&_a]:h-9 [&_button]:h-9 [&_a]:px-3 [&_button]:px-3">{actions}</div> : null}
    </div>
  );
}

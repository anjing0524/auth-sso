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

import { DynamicIcon, type IconName } from '@/lib/icon-map';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  description?: string;
  /** 可序列化的 icon 名（见 ICON_MAP）；默认不显示图标 */
  icon?: IconName;
  /** 右侧操作区（按钮/链接） */
  actions?: ReactNode;
  /** 返回上一级的链接（如列表页） */
  backHref?: string;
  backLabel?: string;
  className?: string;
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  backHref,
  backLabel = '返回',
  className,
}: PageHeaderProps) {
  return (
    <div className={cn('flex flex-col gap-4 md:flex-row md:items-center md:justify-between', className)}>
      <div className="flex min-w-0 items-center gap-3">
        {backHref ? (
          <a
            href={backHref}
            aria-label={backLabel}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden="true">
              <path d="M15 19l-7-7 7-7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </a>
        ) : icon ? (
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
            <DynamicIcon name={icon} className="h-5 w-5" />
          </span>
        ) : null}
        <div className="min-w-0 space-y-1">
          <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">{title}</h1>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

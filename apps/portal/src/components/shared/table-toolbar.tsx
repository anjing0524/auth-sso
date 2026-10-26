/**
 * TableToolbar — 列表页表格上方工具条的**唯一实现**
 *
 * 返工背景（用户反馈）："表格的搜索、表格本部、表格上面的按钮，搜索旁边的按钮都没有统一"。
 * 此前 5 个列表页各写一份工具条：有的搜索框 w-72/有的 w-96，有的把"新建"按钮放在搜索右边、
 * 有的放在筛选器右侧，padding 有 py-4 有 py-3，还夹着 tab/统计文案。
 *
 * 统一口径：
 * - 容器：`border-b bg-muted/50 px-6 py-3`，与表格卡片同宽；
 * - 布局：左槽（搜索 + 筛选）与右槽（统计 + 主操作）在 md 以上两端对齐，窄屏纵向堆叠；
 * - 高度：所有控件 40px（Input/Select/Button 基类保证）；
 * - 间距：槽内 gap-3，槽间 gap-4。
 */
import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

export function TableToolbar({
  left,
  right,
  className,
}: {
  left?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col gap-2 border-b bg-muted/30 px-3 py-1.5 md:flex-row md:items-center md:justify-between', className)}>
      <div className="flex w-full min-w-0 flex-col gap-2 md:w-auto md:flex-row md:items-center">{left}</div>
      {right ? <div className="flex w-full shrink-0 flex-wrap items-center justify-between gap-2 md:w-auto md:flex-nowrap md:justify-end [&_button]:h-8 [&_button]:px-2.5 [&_button]:max-md:w-full">{right}</div> : null}
    </div>
  );
}

/**
 * FormActionBar — 表单页统一的底部操作条（UX-06）
 *
 * 为什么存在：审计发现同类表单的主操作有 4 种位置（卡片右下 / 视口底部 / 页头右侧 /
 * 工具条右侧），长表单滚动后要回顶部才能保存。这里收敛为**底部 sticky 操作条**：
 * 左侧是「有未保存修改」状态与可选提示，右侧是主/次按钮。
 *
 * 只做版式，不持有表单状态；按钮由调用方传入，保证各页自己的保存逻辑不变。
 * 无 `'use client'`：服务端页面与客户端表单都可渲染。
 */
import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';

import { cn } from '@/lib/utils';

interface FormActionBarProps {
  /** 是否存在未保存修改；为 true 时显示状态徽标 */
  isDirty?: boolean;
  /** 左侧附加信息（差异计数/影响面提示） */
  hint?: ReactNode;
  /** 右侧按钮组（次操作在前、主操作在后） */
  children: ReactNode;
  className?: string;
}

export function FormActionBar({ isDirty = false, hint, children, className }: FormActionBarProps) {
  return (
    <div
      data-slot="form-action-bar"
      className={cn(
        'sticky bottom-0 z-20 flex flex-wrap items-center gap-2 border-t border-border bg-background/95 py-2 backdrop-blur',
        className,
      )}
    >
      {isDirty ? (
        <span
          role="status"
          className="inline-flex items-center gap-1 rounded bg-badge-warning-bg px-2 py-1 text-[11px] font-medium text-badge-warning-fg"
        >
          <AlertCircle className="h-3 w-3" aria-hidden="true" />
          有未保存的修改
        </span>
      ) : null}
      {hint}
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

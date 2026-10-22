/**
 * EmptyState 组件 — 统一的空状态展示（simple + onboarding 双变体）
 *
 * simple: 图标 + 标题 + 描述 + 可选 CTA 按钮（用于列表/表格空数据）
 * onboarding: 图标 + 标题 + 描述 + 步骤 Checklist（用于 Dashboard 首次引导）
 */
'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { DynamicIcon, type IconName } from '@/lib/icon-map';

interface EmptyStateAction {
  label: string;
  href?: string;
  onClick?: () => void;
}

interface OnboardingStep {
  label: string;
  href?: string;
}

interface EmptyStateProps {
  variant: 'simple' | 'onboarding';
  /**
   * **可序列化的** icon 名（见 `ICON_MAP`），不是组件引用。
   *
   * 此前类型是 `LucideIcon`，被 Server Component 直接当作 prop 传给本客户端组件
   * （`/audit-logs` 操作日志空态、Dashboard onboarding）——React 禁止函数跨
   * Server→Client 边界，整页会进错误边界。字符串名是这里唯一合法的契约形状。
   */
  icon?: IconName;
  title: string;
  description: string;
  action?: EmptyStateAction;
  steps?: OnboardingStep[];
  className?: string;
}

function ActionButton({ action }: { action: EmptyStateAction }) {
  if (action.href) {
    return (
      <Button asChild className="rounded-xl">
        <Link href={action.href}>{action.label}</Link>
      </Button>
    );
  }
  return (
    <Button onClick={action.onClick} className="rounded-xl">
      {action.label}
    </Button>
  );
}

export function EmptyState({
  variant,
  icon = 'Inbox',
  title,
  description,
  action,
  steps,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      <div className="bg-muted/50 p-4 rounded-full mb-4">
        <DynamicIcon name={icon} className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="mb-1 text-lg font-bold text-foreground">{title}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>

      {variant === 'simple' && action && <ActionButton action={action} />}

      {variant === 'onboarding' && steps && steps.length > 0 && (
        <div className="w-full max-w-xs space-y-2">
          {steps.map((step, i) => {
            const rowClass = 'flex items-center gap-3 rounded-xl bg-muted/30 p-3 text-left';
            const inner = (
              <>
                <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
                  {i + 1}
                </span>
                <span className="text-sm font-medium">{step.label}</span>
              </>
            );
            // 有 href 时整行可点（此前只有文字是链接，触控目标 < 32px）
            return step.href ? (
              <Link key={i} href={step.href} className={cn(rowClass, 'transition-colors hover:bg-muted/60 hover:text-primary')}>
                {inner}
              </Link>
            ) : (
              <div key={i} className={rowClass}>{inner}</div>
            );
          })}
          {action && (
            <div className="pt-2">
              <ActionButton action={action} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

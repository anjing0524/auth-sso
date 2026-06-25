/**
 * EmptyState 组件 — 统一的空状态展示（simple + onboarding 双变体）
 *
 * simple: 图标 + 标题 + 描述 + 可选 CTA 按钮（用于列表/表格空数据）
 * onboarding: 图标 + 标题 + 描述 + 步骤 Checklist（用于 Dashboard 首次引导）
 */
'use client';

import { type LucideIcon, Inbox } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

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
  icon?: LucideIcon;
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
  icon: Icon = Inbox,
  title,
  description,
  action,
  steps,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-16 px-4 text-center', className)}>
      <div className="bg-muted/50 p-4 rounded-full mb-4">
        <Icon className="h-8 w-8 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-bold text-foreground mb-1">{title}</h3>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{description}</p>

      {variant === 'simple' && action && <ActionButton action={action} />}

      {variant === 'onboarding' && steps && steps.length > 0 && (
        <div className="w-full max-w-xs space-y-2">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-3 p-3 bg-muted/30 rounded-xl text-left">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-primary text-primary-foreground text-xs font-bold flex items-center justify-center">
                {i + 1}
              </span>
              {step.href ? (
                <Link href={step.href} className="text-sm font-medium hover:text-primary transition-colors">
                  {step.label}
                </Link>
              ) : (
                <span className="text-sm font-medium">{step.label}</span>
              )}
            </div>
          ))}
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

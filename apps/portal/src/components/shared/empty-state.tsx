/**
 * EmptyState 组件 — 统一的空状态展示（simple + onboarding 双变体）
 *
 * simple: 图标 + 标题 + 描述 + 可选 CTA 按钮（用于列表/表格空数据）
 * onboarding: 图标 + 标题 + 描述 + 步骤 Checklist（用于 Dashboard 首次引导）
 *
 * 空态语义（U-G02）：
 * - `kind="empty"`（默认）：系统里确实还没有数据 → 主 CTA 引导创建；
 * - `kind="filtered"`：搜索/筛选后无结果 → 默认文案变为“未找到匹配结果”，
 *   并可通过 `clearAction` 提供「清除筛选 / 查看全部」动作（而不是引导“新建”）。
 * 页面层只需按数据来源传 `kind` 即可，无需再各自维护文案。
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

/** 空态类型：无数据 vs 筛选/搜索无结果 */
export type EmptyStateKind = 'empty' | 'filtered';

/** 筛选无结果时的“清除筛选/查看全部”动作 */
interface EmptyStateClearAction {
  /** 默认「清除筛选」 */
  label?: string;
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
  /** 空态语义（默认 empty）；filtered 时使用“筛选无结果”默认文案 */
  kind?: EmptyStateKind;
  /** 缺省时按 kind 使用默认标题（U-G02 后不再强制页面重复写文案） */
  title?: string;
  description?: string;
  action?: EmptyStateAction;
  /** 仅 filtered 场景建议使用：清除筛选/查看全部（secondary 按钮） */
  clearAction?: EmptyStateClearAction;
  steps?: OnboardingStep[];
  className?: string;
}

const KIND_DEFAULTS: Record<EmptyStateKind, { title: string; description: string }> = {
  empty: { title: '暂无数据', description: '这里还没有任何记录。' },
  filtered: { title: '未找到匹配结果', description: '请调整搜索关键词或筛选条件后重试。' },
};

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

function ClearFiltersButton({ action }: { action: EmptyStateClearAction }) {
  const label = action.label ?? '清除筛选';
  if (action.href) {
    return (
      <Button asChild variant="outline" className="rounded-xl">
        <Link href={action.href}>{label}</Link>
      </Button>
    );
  }
  return (
    <Button variant="outline" className="rounded-xl" onClick={action.onClick}>
      {label}
    </Button>
  );
}

function EmptyStateActions({
  action,
  clearAction,
}: {
  action?: EmptyStateAction;
  clearAction?: EmptyStateClearAction;
}) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      {action && <ActionButton action={action} />}
      {clearAction && <ClearFiltersButton action={clearAction} />}
    </div>
  );
}

function OnboardingSteps({
  steps,
  action,
  clearAction,
}: {
  steps: OnboardingStep[];
  action?: EmptyStateAction;
  clearAction?: EmptyStateClearAction;
}) {
  const hasActions = Boolean(action || clearAction);

  return (
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
      {hasActions && (
        <div className="pt-2">
          <EmptyStateActions action={action} clearAction={clearAction} />
        </div>
      )}
    </div>
  );
}

export function EmptyState({
  variant,
  icon = 'Inbox',
  kind = 'empty',
  title,
  description,
  action,
  clearAction,
  steps,
  className,
}: EmptyStateProps) {
  const defaults = KIND_DEFAULTS[kind];
  const resolvedTitle = title ?? defaults.title;
  const resolvedDescription = description ?? defaults.description;
  const hasActions = Boolean(action || clearAction);

  return (
    <div
      data-empty-kind={kind}
      className={cn('flex flex-col items-center justify-center px-4 py-8 text-center [@media(min-height:600px)]:py-16', className)}
    >
      <div className="bg-muted/50 p-4 rounded-full mb-4">
        <DynamicIcon name={icon} aria-hidden="true" className="h-8 w-8 text-muted-foreground" />
      </div>
      <h2 className="mb-1 text-lg font-bold text-foreground">{resolvedTitle}</h2>
      <p className="text-sm text-muted-foreground max-w-sm mb-6">{resolvedDescription}</p>

      {variant === 'simple' && hasActions && (
        <EmptyStateActions action={action} clearAction={clearAction} />
      )}

      {variant === 'onboarding' && steps && steps.length > 0 && (
        <OnboardingSteps steps={steps} action={action} clearAction={clearAction} />
      )}
    </div>
  );
}

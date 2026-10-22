/**
 * 共享 icon 白名单映射 — CommandPalette 与 AppSidebar 共用
 *
 * 按需加载，避免 bundle 全部 lucide-react icons。
 *
 * `IconName` 是**可序列化**的 icon 契约：任何跨 Server→Client 边界的组件
 * （如 `EmptyState`）只能接收这里的字符串名，不能接收组件引用。
 */
import {
  LayoutGrid,
  LayoutDashboard,
  Users,
  UserPlus,
  Building2,
  ShieldCheck,
  AppWindow,
  Menu,
  ShieldAlert,
  FileText,
  Key,
  Lock,
  Globe,
  Bell,
  HelpCircle,
  Settings,
  User,
  Inbox,
  type LucideIcon,
} from 'lucide-react';

export const ICON_MAP = {
  LayoutGrid,
  LayoutDashboard,
  Users,
  UserPlus,
  Building2,
  ShieldCheck,
  AppWindow,
  Menu,
  ShieldAlert,
  FileText,
  Key,
  Lock,
  Globe,
  Bell,
  HelpCircle,
  Settings,
  User,
  Inbox,
} as const satisfies Record<string, LucideIcon>;

/** 合法 icon 名（字面量联合，写错即类型错误） */
export type IconName = keyof typeof ICON_MAP;

export function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const IconComponent = ICON_MAP[name as IconName] ?? LayoutGrid;
  return <IconComponent className={className} />;
}

/**
 * 共享 icon 白名单映射 — CommandPalette 与 AppSidebar 共用
 *
 * 按需加载，避免 bundle 全部 lucide-react icons。
 */
import {
  LayoutGrid,
  LayoutDashboard,
  Users,
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
  type LucideIcon,
} from 'lucide-react';

export const ICON_MAP: Record<string, LucideIcon> = {
  LayoutGrid,
  LayoutDashboard,
  Users,
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
};

export function DynamicIcon({ name, className }: { name: string; className?: string }) {
  const IconComponent = ICON_MAP[name] || LayoutGrid;
  return <IconComponent className={className} />;
}

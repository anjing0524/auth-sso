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
import { MENU_ICON_VALUES, type MenuIconName } from '@auth-sso/contracts';

export const ICON_MAP: Record<MenuIconName, LucideIcon> = {
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
  const iconName = MENU_ICON_VALUES.find((value) => value === name);
  const IconComponent = iconName ? ICON_MAP[iconName] : LayoutGrid;
  return <IconComponent className={className} />;
}

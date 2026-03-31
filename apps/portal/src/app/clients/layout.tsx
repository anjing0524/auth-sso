/**
 * Clients 页面布局
 * 使用 Dashboard 布局包装 Client 管理页面
 */
import DashboardLayout from '@/components/layout/DashboardLayout';

export default function ClientsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <DashboardLayout>{children}</DashboardLayout>;
}
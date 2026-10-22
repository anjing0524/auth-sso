/**
 * 工作台布局 —— 不设功能权限门槛。
 *
 * 工作台是登录后的统一落地页：如果要求 `portal:menu:dashboard`，只授了业务菜单的角色
 * 会在登录后直接落到"未授权"（2026-10-21 权限审计实测）。身份鉴权由上层 `(dashboard)/layout.tsx`
 * 完成；工作台内的数据全部按数据范围裁剪，审计动态等敏感区块按功能权限单独隐藏。
 */
export const instant = false;

export default function DashboardPageLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

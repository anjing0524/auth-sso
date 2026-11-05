/**
 * 首登强制改密页（位于 dashboard 路由组之外）。
 *
 * OAuth 回调下发 JWT 后，dashboard layout 检测到 mustChangePassword 会重定向到这里。
 * 本页只允许未改密用户访问；已改密用户直接回工作台。
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { resolveIdentity } from '@/lib/auth';
import { getOwnUser } from '@/app/(dashboard)/users/data';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import { ForcePasswordChangeForm } from './force-password-change-form';

export const instant = false;
export const metadata = { title: '修改初始密码 | Auth-SSO' };

async function ForcePasswordChangeContent() {
  const identity = await resolveIdentity();
  if (!identity) redirect('/login');

  const ctx = toPermissionContextOrNull(await getUserPermissionContext(identity.userId));
  if (!ctx?.mustChangePassword) redirect('/dashboard');

  const user = await getOwnUser(identity.userId);
  if (!user) redirect('/login');

  return <ForcePasswordChangeForm name={user.name} email={user.email} />;
}

export default function ForcePasswordChangePage() {
  return (
    <Suspense fallback={<div className="min-h-[100svh] bg-[#F4F7FB]" aria-busy="true" />}>
      <ForcePasswordChangeContent />
    </Suspense>
  );
}

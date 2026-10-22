/**
 * PermissionGate —— 路由级权限守卫的**统一装载点**（服务端组件）
 *
 * 为什么需要它（Turbopack + Cache Components 实测）：
 *
 * 每个 `(dashboard)/<route>/layout.tsx` 原本都是
 * `export default async function XLayout({ children }) { const auth = await requirePermission(...); ... }`。
 * 在现代 glibc 环境用 Turbopack 起 dev 后，访问这些路由会报两类服务端错误：
 *
 * 1. `Next.js encountered uncached data during prerendering or a navigation`
 *    （认证读取会话数据，但没有同段 Suspense / 未声明请求期渲染）；
 * 2. `Next.js encountered the unstable value Date.now() while prerendering`
 *    （链路上的签名密钥 TTL 缓存用 Date.now()）。
 *
 * 文档给出的两条修法在这里同时成立：
 * - `[dynamic]` 在动态读取前 `await connection()` ⇒ 明确"本段请求期渲染"；
 * - `[stream]` 用 `<Suspense fallback>` 包住数据访问 ⇒ 导航不被阻塞。
 *
 * 因此把「Suspense + connection() + requirePermission + Forbidden」收敛到本组件，
 * 各路由 layout 只声明自己需要的权限码。
 */
import { Suspense } from 'react';
import { connection } from 'next/server';

import { requirePermission } from '@/lib/auth';
import type { PermissionCheckOptions } from '@/lib/auth/check-permission';
import { Forbidden } from '@/components/shared/forbidden';

/** 鉴权期间的占位（与后台页面骨架同风格） */
function GateFallback() {
  return (
    <div className="space-y-6" aria-busy="true" aria-live="polite">
      <div className="h-7 w-40 animate-pulse rounded-lg bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted/60" />
    </div>
  );
}

async function Gate({
  options,
  children,
}: {
  options: PermissionCheckOptions;
  children: React.ReactNode;
}) {
  // 请求期渲染声明：既修复 Cache Components 的预渲染判定，
  // 也让链路里的不稳定值（Date.now() 的 TTL 缓存）不再被当作可预渲染。
  await connection();
  const auth = await requirePermission(options);
  if (!auth) return <Forbidden />;
  return <>{children}</>;
}

export function PermissionGate({
  options,
  children,
}: {
  options: PermissionCheckOptions;
  children: React.ReactNode;
}) {
  return (
    <Suspense fallback={<GateFallback />}>
      <Gate options={options}>{children}</Gate>
    </Suspense>
  );
}

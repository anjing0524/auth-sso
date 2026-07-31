import Link from 'next/link';
import { ShieldX } from 'lucide-react';

/**
 * 已完成身份认证、但尚未获得任何 Portal 管理权限时的稳定落地页。
 *
 * 该页面只依赖 dashboard 身份布局，不附加业务权限守卫。
 */
export default function NoAccessPage() {
  return (
    <section className="mx-auto flex min-h-[60vh] max-w-2xl items-center justify-center">
      <div className="w-full rounded-3xl border bg-card p-8 text-center shadow-sm sm:p-12">
        <div className="mx-auto mb-6 flex size-16 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600">
          <ShieldX className="size-8" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-black tracking-tight">暂未分配管理权限</h1>
        <p className="mx-auto mt-3 max-w-lg text-sm leading-6 text-muted-foreground">
          你的身份验证已完成，但当前账号没有可访问的管理功能。请联系系统管理员分配角色或权限后重试。
        </p>
        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
          <Link
            href="/profile"
            className="inline-flex h-10 items-center justify-center rounded-xl bg-primary px-5 text-sm font-bold text-primary-foreground transition-colors hover:bg-primary/90"
          >
            查看个人资料
          </Link>
          <a
            href="/api/auth/logout?callbackUrl=/login"
            className="inline-flex h-10 items-center justify-center rounded-xl border bg-background px-5 text-sm font-bold transition-colors hover:bg-muted"
          >
            退出登录
          </a>
        </div>
      </div>
    </section>
  );
}

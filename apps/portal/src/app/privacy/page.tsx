import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';

export default function PrivacyPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-8 px-4 py-12 sm:px-6">
      <Link href="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />返回登录
      </Link>
      <div>
        <h1 className="text-3xl font-black tracking-tight">隐私政策</h1>
        <p className="mt-2 text-sm text-muted-foreground">最后更新：2026 年 7 月 31 日</p>
      </div>
      <section className="space-y-5 text-sm leading-7 text-muted-foreground">
        <p>Auth-SSO 为组织内部身份认证系统，仅处理完成登录、授权、安全审计和账户管理所必需的信息。</p>
        <div>
          <h2 className="text-base font-bold text-foreground">处理的信息</h2>
          <p>包括账户资料、所属部门、角色权限、登录时间、IP 地址、浏览器标识以及安全操作记录。</p>
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">使用目的</h2>
          <p>上述信息用于验证身份、实施访问控制、发现异常登录、响应安全事件并满足组织审计要求。</p>
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">数据安全</h2>
          <p>密码和客户端密钥不会以明文保存；敏感令牌仅在必要期限内保留，并支持管理员撤销。</p>
        </div>
        <div>
          <h2 className="text-base font-bold text-foreground">联系与更正</h2>
          <p>如需更正账户资料、申请权限或了解数据保留规则，请联系组织管理员。</p>
        </div>
      </section>
    </main>
  );
}

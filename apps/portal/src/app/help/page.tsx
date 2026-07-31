import Link from 'next/link';
import { ArrowLeft, KeyRound, ShieldCheck, UserRound } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function HelpPage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl space-y-6 px-4 py-12 sm:px-6">
      <Link href="/login" className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" />返回登录
      </Link>
      <div>
        <h1 className="text-3xl font-black tracking-tight">帮助中心</h1>
        <p className="mt-2 text-muted-foreground">Auth-SSO 登录与账户问题自助指南。</p>
      </div>
      <div className="grid gap-4">
        <HelpCard icon={UserRound} title="无法登录">
          请确认用户名和密码正确。若账户被锁定、禁用或尚未分配访问权限，请联系组织管理员。
        </HelpCard>
        <HelpCard icon={KeyRound} title="忘记密码">
          当前版本由管理员执行密码重置。重置后所有旧会话会立即失效，请使用新密码重新登录。
        </HelpCard>
        <HelpCard icon={ShieldCheck} title="没有系统权限">
          登录成功只代表身份已验证；具体系统和菜单仍由角色授权决定。请向管理员申请对应角色。
        </HelpCard>
      </div>
    </main>
  );
}

function HelpCard({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2 text-lg"><Icon className="h-5 w-5 text-primary" />{title}</CardTitle></CardHeader>
      <CardContent className="text-sm leading-6 text-muted-foreground">{children}</CardContent>
    </Card>
  );
}

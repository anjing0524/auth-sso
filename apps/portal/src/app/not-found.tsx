import Link from 'next/link';
import { ArrowLeft, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/30 px-4">
      <Card className="w-full max-w-lg rounded-3xl text-center shadow-xl">
        <CardContent className="space-y-6 p-10">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
            <ShieldCheck className="h-8 w-8" />
          </div>
          <div>
            <p className="text-sm font-bold text-primary">404</p>
            <h1 className="mt-2 text-3xl font-black tracking-tight">页面不存在</h1>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              该地址可能已变更，或当前账户没有对应入口。
            </p>
          </div>
          <Button asChild>
            <Link href="/dashboard"><ArrowLeft className="mr-2 h-4 w-4" />返回工作台</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}

import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { DynamicIcon } from '@/lib/icon-map';

/**
 * 统一鉴权失败视图（403）。
 *
 * 此前只有一行红字"未授权访问或权限不足"：没有说明、没有出口，受限用户（自定义角色）
 * 落到这里只能手动改地址栏。现在给出图标 + 原因 + 返回工作台入口。
 */
export function Forbidden() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center py-16">
      <div className="flex max-w-md flex-col items-center gap-4 text-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
          <DynamicIcon name="ShieldAlert" className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-bold">无权限访问</h2>
          <p className="text-sm text-muted-foreground">
            当前账号没有访问该页面的权限。如需使用，请联系管理员为你的角色分配对应权限。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button asChild>
            <Link href="/dashboard">返回工作台</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Dashboard 3.0 - Server Component 重构
 * 具有专业排版、数据趋势图和高密度活动面板
 */
import Link from 'next/link';
import {
  Users,
  ShieldCheck,
  AppWindow,
  Plus,
  ArrowRight,
  ArrowUpRight,
  Activity,
  TrendingUp,
  History
} from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';

import { EmptyState } from '@/components/shared/empty-state';
import {
  AUDIT_OPERATION_LABELS,
  AUDIT_PERMISSIONS,
  CLIENT_PERMISSIONS,
  DEPARTMENT_PERMISSIONS,
  ROLE_PERMISSIONS,
  USER_PERMISSIONS,
  can,
} from '@auth-sso/contracts';
import { formatTime } from '@/lib/format-date';
import { getDashboardStats, getRecentAuditLogs } from './data';
import { db } from '@/infrastructure/db';
import { resolveIdentity } from '@/lib/auth/verify-jwt';
import { resolveScope } from '@/lib/authz';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';


import { PageHeader } from '@/components/shared/page-header';

/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
export const metadata = { title: '工作台 | Auth-SSO' };
export default async function DashboardPage() {
  // 身份由上层布局保证；工作台对已登录用户开放，区块与快捷入口按功能权限裁剪。
  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };
  const permCtx = identity ? toPermissionContextOrNull(await getUserPermissionContext(identity.userId)) : null;
  const subject = {
    roleCodes: permCtx?.roles.map((r) => r.code) ?? [],
    permissionCodes: permCtx?.permissions ?? [],
  };
  const canAudit = can(subject, AUDIT_PERMISSIONS.READ);
  const canUsers = can(subject, USER_PERMISSIONS.LIST);
  // U-DASH01：快捷入口必须是**动作**权限，不是列表权限——readonly 没有 user:create /
  // client:create 却仍看到「新建用户/应用接入」可点击卡片（DESIGN §权限模型）。
  const canUserCreate = can(subject, USER_PERMISSIONS.CREATE);
  const canClientCreate = can(subject, CLIENT_PERMISSIONS.CREATE);
  const canRoles = can(subject, ROLE_PERMISSIONS.LIST);
  const canClients = can(subject, CLIENT_PERMISSIONS.LIST);
  const canDepartments = can(subject, DEPARTMENT_PERMISSIONS.LIST);
  const [stats, recentLogs] = await Promise.all([
    getDashboardStats(scope),
    // 审计动态是跨部门敏感数据：没有 audit:read 的用户不查询、不渲染（此前任何 dashboard 用户都能看到）。
    canAudit ? getRecentAuditLogs() : Promise.resolve([]),
  ]);

  /**
   * 初次使用引导：实例里还没有**第二个**用户时展示 onboarding。
   *
   * 此前的条件是 `stats.users === 0` —— 但能执行到这里的请求必然已通过 layout 的
   * `resolveIdentity()`，也就是 users 表里至少有**自己**一条记录 ⇒ 该分支永远不可达，
   * onboarding UI 是一段死代码（也让我们无法通过真实页面验证它的渲染）。
   * 改判 `≤ 1`（只有自己）后，新实例首次登录即可看到引导，语义与原注释一致。
   */
  if (stats.users <= 1) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <PageHeader icon="LayoutDashboard" title="工作台" description="首次使用引导" />
        {/* 引导内容在可视区域内垂直居中：此前顶部对齐 + py-10，下方整屏空白，主内容区显得很小 */}
        <div className="flex flex-1 items-center justify-center">
          <div className="w-full max-w-lg">
            <EmptyState
              variant="onboarding"
              icon="ShieldCheck"
              title="欢迎使用 Auth-SSO"
              description="完成以下步骤以开始管理您的身份平台"
              steps={[
                ...(canDepartments ? [{ label: '创建组织架构', href: '/departments' }] : []),
                ...(canUserCreate ? [{ label: '创建用户账号', href: '/users' }] : []),
                ...(canRoles ? [{ label: '配置角色权限', href: '/roles' }] : []),
                ...(canClientCreate ? [{ label: '注册 OAuth 应用', href: '/clients' }] : []),
              ]}
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 1. Header Area */}
      <PageHeader
        icon="LayoutDashboard"
        title="工作台"
        description="全域身份认证概览与系统健康度"
        actions={
          canAudit ? (
            <Button asChild>
              <Link href="/audit-logs"><TrendingUp className="h-4 w-4" /> 查看日志</Link>
            </Button>
          ) : undefined
        }
      />

      {/* 2. Key Metrics - Shadcn Block-01 Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {canUsers && (
<Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">用户总数</CardTitle>
            <Users className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{stats.users}</div>
            <p className="mt-1 text-xs text-muted-foreground">活跃用户</p>
          </CardContent>
        </Card>
        )}
                {canRoles && (
<Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">活跃角色</CardTitle>
            <ShieldCheck className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{stats.roles}</div>
            <p className="mt-1 text-xs text-muted-foreground">已配置角色</p>
          </CardContent>
        </Card>
        )}
                {canClients && (
<Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">受控应用</CardTitle>
            <AppWindow className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{stats.clients}</div>
            <p className="mt-1 text-xs text-muted-foreground">已注册应用</p>
          </CardContent>
        </Card>
        )}
        <Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">认证状态</CardTitle>
            <Activity className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-success">正常</div>
            <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" /> 服务节点正常
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 3. Detailed Data - Non-symmetric Layout */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        
        {/* Left: Main Activity Table */}
        {canAudit && (
        <Card className="flex flex-col overflow-hidden rounded-xl border-none shadow-sm ring-1 ring-border/50 lg:col-span-4">
          <CardHeader className="flex flex-row items-center px-6 py-6">
            <div className="grid gap-1">
              <CardTitle className="flex items-center gap-2">
                <History className="h-5 w-5 text-info" />
                安全审计动态
              </CardTitle>
              <CardDescription className="text-xs font-medium text-muted-foreground">实时审计日志</CardDescription>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto" asChild>
              <Link href="/audit-logs">
                查看全部 <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 flex-1">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="w-[140px]">操作用户</TableHead>
                  <TableHead>行为内容</TableHead>
                  <TableHead className="text-center">结果</TableHead>
                  <TableHead className="text-right">发生时间</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {recentLogs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="h-64 p-0 relative">
                      <div className="absolute inset-0 flex flex-col items-center justify-center bg-card/60 backdrop-blur-[2px] z-10 space-y-3">
                        <div className="bg-muted p-3 rounded-full">
                          <History className="h-6 w-6 text-muted-foreground" />
                        </div>
                        <p className="text-sm font-medium text-muted-foreground">暂无活动记录</p>
                        <p className="text-xs text-muted-foreground/70">系统的最新安全审计日志将在这里显示</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  recentLogs.map((log) => {
                    return (
                      <TableRow key={log.id} className="group hover:bg-muted/50 transition-colors border-none">
                        <TableCell className="font-medium">{log.username || '未知'}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {AUDIT_OPERATION_LABELS[log.operation as keyof typeof AUDIT_OPERATION_LABELS] ?? log.operation}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant={log.status === 200 ? 'success' : 'destructive'}>
                            {log.status === 200 ? '成功' : '失败'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs text-muted-foreground">
                          {formatTime(log.createdAt)}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
        )}

        {/* Right: Quick Actions & Status */}
        <div className={canAudit ? 'lg:col-span-3 space-y-4' : 'space-y-4 lg:col-span-7'}>
           <Card className="overflow-hidden rounded-xl border-none bg-muted/50 p-2 shadow-sm ring-1 ring-border/50">
              <CardHeader className="pb-4">
                 <CardTitle>快捷功能直达</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                 {canUserCreate && (
                 <Button variant="outline" className="group h-16 justify-start rounded-xl border-none bg-card px-6 shadow-sm ring-1 ring-border/50 transition-all hover:border-primary/50" asChild>
                    <Link href="/users">
                       <div className="p-2 bg-info/10 text-info rounded-lg mr-4 group-hover:scale-110 transition-transform"><Plus className="h-4 w-4" /></div>
                       <div className="text-left">
                          <div className="text-sm font-medium">新建用户</div>
                          <div className="text-[10px] text-muted-foreground font-medium">配置基本身份与角色</div>
                       </div>
                    </Link>
                 </Button>
                 )}
                 {canClientCreate && (
                 <Button variant="outline" className="group h-16 justify-start rounded-xl border-none bg-card px-6 shadow-sm ring-1 ring-border/50 transition-all hover:border-success/50" asChild>
                    <Link href="/clients">
                       <div className="p-2 bg-success/10 text-success rounded-lg mr-4 group-hover:scale-110 transition-transform"><ArrowUpRight className="h-4 w-4" /></div>
                       <div className="text-left">
                          <div className="text-sm font-bold">应用接入</div>
                          <div className="text-[10px] text-muted-foreground font-medium">生成 OAuth 2.1 凭证</div>
                       </div>
                    </Link>
                 </Button>
                 )}
              </CardContent>
           </Card>

           {canDepartments && (
           <Card className="group relative overflow-hidden rounded-xl border-none bg-primary p-6 text-primary-foreground shadow-2xl shadow-primary/20">
              <div className="relative z-10 space-y-4">
                 <div className="h-10 w-10 bg-white/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <ShieldCheck className="h-6 w-6" />
                 </div>
                 <div className="space-y-1">
                    <h2 className="text-lg font-black tracking-tight leading-tight">数据沙箱<br/>管控引擎</h2>
                    <p className="text-xs opacity-80 font-medium">组织架构层级鉴权已全局开启。</p>
                 </div>
                 <Button size="sm" variant="secondary" className="w-full rounded-lg font-bold text-xs h-10 shadow-lg shadow-black/10" asChild>
                    <Link href="/departments">进入架构管理</Link>
                 </Button>
              </div>
           </Card>
           )}
        </div>
      </div>
    </div>
  );
}

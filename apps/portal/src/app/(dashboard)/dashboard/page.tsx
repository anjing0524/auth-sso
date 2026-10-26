/**
 * Dashboard 3.0 - Server Component 重构
 * 具有专业排版、数据趋势图和高密度活动面板
 */
import Link from 'next/link';
import {
  Users,
  ShieldCheck,
  AppWindow,
  ArrowRight,
  Activity,
  History,
  Building2,
} from 'lucide-react';

import {
  Card,
  CardContent,
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
import { getDashboardStats, getLoginSummary7d, getRecentAuditLogs } from './data';
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
  const [stats, recentLogs, loginSummary] = await Promise.all([
    getDashboardStats(scope),
    // 审计动态是跨部门敏感数据：没有 audit:read 的用户不查询、不渲染（此前任何 dashboard 用户都能看到）。
    canAudit ? getRecentAuditLogs(6) : Promise.resolve([]),
    canAudit ? getLoginSummary7d() : Promise.resolve(null),
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
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <PageHeader
        icon="LayoutDashboard"
        title="工作台"
        description="按数据范围展示的概览与待办入口"
        actions={
          canAudit ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/audit-logs"><History className="h-3.5 w-3.5" /> 查看审计日志</Link>
            </Button>
          ) : undefined
        }
      />

      {/* 指标卡：整卡可点，直接进入对应列表（不是纯装饰数字） */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {canUsers && (
          <MetricCard href="/users" icon={<Users className="h-4 w-4" />} label="用户总数" value={stats.users} hint="查看用户与状态" />
        )}
        {canRoles && (
          <MetricCard href="/roles" icon={<ShieldCheck className="h-4 w-4" />} label="角色数" value={stats.roles} hint="管理系统角色与权限" />
        )}
        {canClients && (
          <MetricCard href="/clients" icon={<AppWindow className="h-4 w-4" />} label="受控应用" value={stats.clients} hint="OAuth 客户端接入" />
        )}
        {canAudit && loginSummary && (
          <div className="rounded-lg border border-border/70 bg-card p-3 shadow-sm">
            <div className="flex items-center justify-between">
              <Link href="/audit-logs?tab=login&range=7d" className="type-meta transition-colors hover:text-primary">
                近 7 日登录
              </Link>
              <Activity className="h-4 w-4 text-primary" />
            </div>
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="text-[22px] font-semibold tabular-nums leading-none">{loginSummary.success}</span>
              <span className="text-[11px] text-muted-foreground">成功</span>
              {/* 失败是安全运营第一入口：直接落到"登录失败"筛选，而不是全部登录 */}
              <Link
                href="/audit-logs?tab=login&eventType=LOGIN_FAILED&range=7d"
                title="查看近 7 日登录失败"
                className={`ml-auto text-[12px] font-medium tabular-nums underline-offset-2 hover:underline ${loginSummary.failed > 0 ? 'text-destructive' : 'text-muted-foreground'}`}
              >
                失败 {loginSummary.failed}
              </Link>
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              <Link href="/audit-logs?tab=login&range=7d" className="hover:text-primary">查看登录审计 →</Link>
            </p>
          </div>
        )}
      </div>

      <div className="grid min-h-0 flex-1 items-start gap-3 lg:grid-cols-3">
        {/* 最近动态：只展示可行动的关键列，点击可进入审计并按用户过滤 */}
        {canAudit && (
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0 lg:col-span-2">
            <CardHeader className="flex flex-row items-center justify-between border-b bg-muted/30 px-3 py-2">
              <CardTitle className="flex items-center gap-2 type-card-title">
                <History className="h-4 w-4 text-primary" /> 最近操作
              </CardTitle>
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" asChild>
                <Link href="/audit-logs">查看全部 <ArrowRight className="ml-1 h-3 w-3" /></Link>
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {recentLogs.length === 0 ? (
                <p className="px-3 py-10 text-center text-[13px] text-muted-foreground">暂无操作记录</p>
              ) : (
                <Table>
                  <TableHeader className="[&_th]:sticky [&_th]:top-0 [&_th]:z-20 [&_th]:bg-card">
                    <TableRow>
                      <TableHead>操作人</TableHead>
                      <TableHead>行为</TableHead>
                      <TableHead>结果</TableHead>
                      <TableHead className="text-right">时间</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {recentLogs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell>
                          {log.username ? (
                            <Link
                              href={`/audit-logs?tab=operation&keyword=${encodeURIComponent(log.username)}`}
                              className="text-[13px] font-medium hover:text-primary hover:underline"
                            >
                              {log.username}
                            </Link>
                          ) : (
                            <span className="text-[13px] text-muted-foreground">未知</span>
                          )}
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">
                          {AUDIT_OPERATION_LABELS[log.operation as keyof typeof AUDIT_OPERATION_LABELS] ?? log.operation}
                        </TableCell>
                        <TableCell>
                          <Badge variant={log.status === 200 ? 'success' : 'destructive'} className="text-[11px]">
                            {log.status === 200 ? '成功' : '失败'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-mono text-[11px] text-muted-foreground">{formatTime(log.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}

        {/* 快捷入口：按"创建动作"权限渲染，只保留高频动作 */}
        <div className={canAudit ? 'space-y-3' : 'space-y-3 lg:col-span-3'}>
          <Card className="gap-0 overflow-hidden rounded-lg border border-border/70 py-0 shadow-sm ring-0">
            <CardHeader className="border-b bg-muted/30 px-3 py-2">
              <CardTitle className="type-card-title">快捷操作</CardTitle>
            </CardHeader>
            <CardContent className="p-1.5">
              <QuickLink href="/users" show={canUserCreate} icon={<Users className="h-4 w-4" />} title="新建用户" hint="配置身份、部门与角色" />
              <QuickLink href="/clients/new" show={canClientCreate} icon={<AppWindow className="h-4 w-4" />} title="注册应用" hint="生成 OAuth 2.1 凭证" />
              <QuickLink href="/roles" show={canRoles} icon={<ShieldCheck className="h-4 w-4" />} title="角色与权限" hint="维护 RBAC 与数据范围" />
              <QuickLink href="/departments" show={canDepartments} icon={<Building2 className="h-4 w-4" />} title="组织架构" hint="部门树与数据沙箱" />
              {!canUserCreate && !canClientCreate && !canRoles && !canDepartments && (
                <p className="px-2 py-3 text-[11px] text-muted-foreground">当前账号无创建类操作权限。</p>
              )}
            </CardContent>
          </Card>

          <div className="rounded-lg border border-border/60 bg-muted/30 px-3 py-2.5 text-[11px] leading-5 text-muted-foreground">
            <p className="font-medium text-foreground">数据范围说明</p>
            <p>本页指标按你的部门数据范围统计；越权数据不会出现在列表与审计中。</p>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 指标卡：整卡可点，避免"数字不能操作" */
function MetricCard({ href, icon, label, value, hint }: { href: string; icon: React.ReactNode; label: string; value: number; hint: string }) {
  return (
    <Link
      href={href}
      className="rounded-lg border border-border/70 bg-card p-3 shadow-sm transition-colors hover:border-primary/30 hover:bg-primary/[0.02]"
    >
      <div className="flex items-center justify-between">
        <span className="type-meta">{label}</span>
        <span className="text-primary">{icon}</span>
      </div>
      <div className="mt-1 text-[22px] font-semibold tabular-nums leading-none">{value}</div>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </Link>
  );
}

/** 快捷入口行：图标 + 标题 + 说明 + 箭头 */
function QuickLink({ href, show, icon, title, hint }: { href: string; show: boolean; icon: React.ReactNode; title: string; hint: string }) {
  if (!show) return null;
  return (
    <Link
      href={href}
      className="flex items-center gap-2.5 rounded-md px-2 py-2 transition-colors hover:bg-muted/60"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium">{title}</span>
        <span className="block truncate text-[11px] text-muted-foreground">{hint}</span>
      </span>
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    </Link>
  );
}

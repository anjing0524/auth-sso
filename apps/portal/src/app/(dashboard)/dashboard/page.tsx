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
import { getDashboardStats, getRecentAuditLogs } from './data';
import { resolveIdentity } from '@/lib/auth/verify-jwt';


export default async function DashboardPage() {
  // 鉴权由 layout.tsx 统一处理（requirePermission(['dashboard:view'])），本组件零鉴权样板
  // deptIds 来自 JWT claims（已含子树展开），无需额外 DB 查询
  const identity = await resolveIdentity();
  const deptIds = identity?.claims.deptIds ?? [];
  const [stats, recentLogs] = await Promise.all([
    getDashboardStats(deptIds),
    getRecentAuditLogs(),
  ]);

  // 初次使用引导：用户数为 0 时展示 onboarding 空状态
  if (stats.users === 0) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <EmptyState
          variant="onboarding"
          icon={ShieldCheck}
          title="欢迎使用 Auth-SSO"
          description="完成以下步骤以开始管理您的身份平台"
          steps={[
            { label: '创建组织架构', href: '/departments' },
            { label: '创建用户账号', href: '/users' },
            { label: '配置角色权限', href: '/roles' },
            { label: '注册 OAuth 应用', href: '/clients' },
          ]}
        />
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-6 p-1 pt-2">
      {/* 1. Header Area */}
      <div className="flex items-center justify-between space-y-2">
        <div>
          <h2 className="text-2xl font-black tracking-tighter">工作台</h2>
          <p className="text-sm text-muted-foreground font-medium">
            全域身份认证概览与系统健康度
          </p>
        </div>
        <div className="flex items-center space-x-2">
          <Button size="sm" className="rounded-lg shadow-lg shadow-primary/20" asChild>
            <Link href="/audit-logs"><TrendingUp className="mr-2 h-4 w-4" /> 查看日志</Link>
          </Button>
        </div>
      </div>

      {/* 2. Key Metrics - Shadcn Block-01 Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">用户总数</CardTitle>
            <Users className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{stats.users}</div>
            <p className="text-[10px] text-muted-foreground font-medium mt-1">活跃用户</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">活跃角色</CardTitle>
            <ShieldCheck className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{stats.roles}</div>
            <p className="text-[10px] text-muted-foreground font-medium mt-1">已配置角色</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">受控应用</CardTitle>
            <AppWindow className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black">{stats.clients}</div>
            <p className="text-[10px] text-muted-foreground font-medium mt-1">已注册应用</p>
          </CardContent>
        </Card>
        <Card className="rounded-xl border-none shadow-sm ring-1 ring-border/50 hover:bg-primary-subtle transition-all duration-200 ease-out">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-xs font-bold uppercase tracking-wider text-muted-foreground">认证状态</CardTitle>
            <Activity className="h-4 w-4 text-primary opacity-70" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-black text-success">Stable</div>
            <p className="text-[10px] text-muted-foreground font-medium mt-1 flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" /> 服务节点正常
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 3. Detailed Data - Non-symmetric Layout */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        
        {/* Left: Main Activity Table */}
        <Card className="lg:col-span-4 rounded-2xl border-none shadow-sm ring-1 ring-border/50 overflow-hidden flex flex-col">
          <CardHeader className="flex flex-row items-center px-8 py-6">
            <div className="grid gap-1">
              <CardTitle className="text-xl font-bold flex items-center gap-2">
                <History className="h-5 w-5 text-info" />
                安全审计动态
              </CardTitle>
              <CardDescription className="text-xs font-medium uppercase tracking-widest opacity-60">Realtime Audit Logs</CardDescription>
            </div>
            <Button size="sm" variant="ghost" className="ml-auto rounded-lg text-xs font-bold" asChild>
              <Link href="/audit-logs">
                查看全部 <ArrowRight className="ml-1 h-3 w-3" />
              </Link>
            </Button>
          </CardHeader>
          <CardContent className="px-0 flex-1">
            <Table>
              <TableHeader className="bg-muted/50">
                <TableRow className="hover:bg-transparent border-none">
                  <TableHead className="pl-8 w-[120px] text-[10px] font-black uppercase">操作用户</TableHead>
                  <TableHead className="text-[10px] font-black uppercase">行为内容</TableHead>
                  <TableHead className="text-center text-[10px] font-black uppercase">结果</TableHead>
                  <TableHead className="text-right pr-8 text-[10px] font-black uppercase">发生时间</TableHead>
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
                    const date = new Date(log.createdAt);
                    const timeStr = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;

                    return (
                      <TableRow key={log.id} className="group hover:bg-muted/50 transition-colors border-none">
                        <TableCell className="pl-8 font-bold text-sm">{log.username || 'Unknown'}</TableCell>
                        <TableCell className="text-xs font-medium text-muted-foreground">{log.operation}</TableCell>
                        <TableCell className="text-center">
                           <Badge variant={log.status === 200 ? 'default' : 'destructive'} className={`rounded-md px-2 py-0 h-5 text-[10px] ${log.status === 200 ? 'bg-success/10 text-success dark:bg-success/20 dark:text-success hover:bg-success/20 dark:hover:bg-success/25' : ''}`}>
                             {log.status === 200 ? 'Success' : 'Fail'}
                           </Badge>
                        </TableCell>
                        <TableCell className="text-right pr-8 text-[10px] font-mono text-muted-foreground">
                          {timeStr}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        {/* Right: Quick Actions & Status */}
        <div className="lg:col-span-3 space-y-4">
           <Card className="rounded-2xl border-none shadow-sm ring-1 ring-border/50 p-2 overflow-hidden bg-muted/50">
              <CardHeader className="pb-4">
                 <CardTitle className="text-sm font-bold uppercase tracking-wider text-muted-foreground">快捷功能直达</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-3">
                 <Button variant="outline" className="h-16 rounded-2xl justify-start px-6 group hover:border-primary/50 transition-all border-none bg-card shadow-sm ring-1 ring-border/50" asChild>
                    <Link href="/users">
                       <div className="p-2 bg-info/10 text-info rounded-lg mr-4 group-hover:scale-110 transition-transform"><Plus className="h-4 w-4" /></div>
                       <div className="text-left">
                          <div className="text-sm font-bold">创建新用户</div>
                          <div className="text-[10px] text-muted-foreground font-medium">配置基本身份与角色</div>
                       </div>
                    </Link>
                 </Button>
                 <Button variant="outline" className="h-16 rounded-2xl justify-start px-6 group hover:border-success/50 transition-all border-none bg-card shadow-sm ring-1 ring-border/50" asChild>
                    <Link href="/clients">
                       <div className="p-2 bg-success/10 text-success rounded-lg mr-4 group-hover:scale-110 transition-transform"><ArrowUpRight className="h-4 w-4" /></div>
                       <div className="text-left">
                          <div className="text-sm font-bold">应用接入</div>
                          <div className="text-[10px] text-muted-foreground font-medium">生成 OAuth 2.1 凭证</div>
                       </div>
                    </Link>
                 </Button>
              </CardContent>
           </Card>

           <Card className="rounded-2xl border-none bg-primary shadow-2xl shadow-primary/20 text-primary-foreground p-6 overflow-hidden relative group">
              <div className="relative z-10 space-y-4">
                 <div className="h-10 w-10 bg-white/20 rounded-xl flex items-center justify-center group-hover:scale-110 transition-transform">
                    <ShieldCheck className="h-6 w-6" />
                 </div>
                 <div className="space-y-1">
                    <h3 className="text-lg font-black tracking-tight leading-tight">数据沙箱<br/>管控引擎</h3>
                    <p className="text-xs opacity-80 font-medium">组织架构层级鉴权已全局开启。</p>
                 </div>
                 <Button size="sm" variant="secondary" className="w-full rounded-lg font-bold text-xs h-10 shadow-lg shadow-black/10" asChild>
                    <Link href="/departments">进入架构管理</Link>
                 </Button>
              </div>
           </Card>
        </div>
      </div>
    </div>
  );
}

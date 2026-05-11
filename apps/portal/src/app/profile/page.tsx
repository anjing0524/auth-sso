/**
 * 个人中心 - 工业级重构版
 * 采用 Stripe/GitHub 风格的卡片式详情布局
 */
'use client';

import React, { useState, useEffect } from 'react';
import { 
  User, 
  Mail, 
  ShieldCheck, 
  Building2, 
  Key, 
  Clock, 
  Fingerprint,
  CheckCircle2,
  Lock,
  Calendar,
  ChevronRight,
  ShieldAlert,
  Activity,
  ArrowUpRight
} from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export default function ProfilePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchMe = async () => {
      try {
        const response = await fetch('/api/me');
        const json = await response.json();
        setData(json);
      } catch (error) {
        console.error('Failed to fetch profile:', error);
      } finally {
        setLoading(false);
      }
    };
    fetchMe();
  }, []);

  if (loading) {
    return (
      <div className="space-y-8 p-1">
        <Skeleton className="h-40 w-full rounded-[2.5rem]" />
        <div className="grid gap-8 lg:grid-cols-3">
          <Skeleton className="h-96 lg:col-span-1 rounded-[2rem]" />
          <Skeleton className="h-96 lg:col-span-2 rounded-[2rem]" />
        </div>
      </div>
    );
  }

  const user = data?.user;
  const permissions = data?.permissions || [];
  const roles = data?.roles || [];

  return (
    <div className="max-w-6xl mx-auto space-y-10 pb-16 animate-in fade-in duration-700">
      {/* 1. 顶部身份横幅 - 极简主义设计 */}
      <div className="group relative overflow-hidden rounded-[2.5rem] bg-white dark:bg-slate-900 border border-border/50 shadow-2xl shadow-slate-200/40 p-8 lg:p-12 transition-all hover:shadow-primary/5">
        <div className="absolute top-0 right-0 p-8">
           <Button variant="ghost" size="icon" className="rounded-full hover:bg-primary/10 hover:text-primary transition-colors">
              <ArrowUpRight className="h-5 w-5" />
           </Button>
        </div>
        
        <div className="flex flex-col md:flex-row items-center gap-8 relative z-10 text-center md:text-left">
          <div className="relative">
            <Avatar className="h-28 w-24 md:h-32 md:w-32 rounded-3xl border-4 border-white dark:border-slate-800 shadow-2xl ring-1 ring-primary/20">
              <AvatarImage src={user?.picture} />
              <AvatarFallback className="text-3xl font-black bg-gradient-to-br from-blue-500 to-indigo-700 text-white">
                {user?.name?.charAt(0).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="absolute -bottom-2 -right-2 bg-green-500 text-white p-2 rounded-2xl shadow-lg ring-4 ring-white dark:ring-slate-900">
               <ShieldCheck className="h-5 w-5" />
            </div>
          </div>
          
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-center md:justify-start gap-3">
              <h1 className="text-4xl font-black tracking-tighter text-slate-900 dark:text-white leading-none">
                {user?.name}
              </h1>
              <Badge className="bg-primary text-white border-none px-3 py-1 rounded-full font-bold text-[10px] uppercase tracking-widest shadow-lg shadow-primary/20">
                {data?.dataScopeType === 'ALL' ? 'Administrator' : 'Verified Staff'}
              </Badge>
            </div>
            <p className="flex items-center justify-center md:justify-start gap-2 text-slate-500 font-medium italic">
              <Mail className="h-4 w-4 opacity-50" /> {user?.email}
            </p>
          </div>
        </div>
        
        {/* 背景装饰图案 */}
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-primary/5 blur-3xl" />
      </div>

      <div className="grid gap-10 lg:grid-cols-3">
        {/* 2. 左侧：核心凭证卡片 */}
        <div className="lg:col-span-1 space-y-8">
          <Card className="rounded-[2rem] border-none shadow-sm ring-1 ring-border/50 overflow-hidden bg-slate-50/50">
            <CardHeader className="bg-white/50 border-b py-6 px-8">
              <CardTitle className="text-sm font-black uppercase tracking-[0.2em] text-slate-400 flex items-center gap-2">
                <Fingerprint className="h-4 w-4 text-primary" />
                Auth Token
              </CardTitle>
            </CardHeader>
            <CardContent className="p-8 space-y-6">
              <div className="space-y-2">
                <Label className="text-[10px] font-bold text-slate-400 uppercase">Principal ID</Label>
                <div className="flex items-center justify-between gap-2 p-3 bg-white dark:bg-slate-900 rounded-xl border border-border/60 group">
                   <code className="text-xs font-mono truncate opacity-60 group-hover:opacity-100 transition-opacity">{user?.id}</code>
                   <ChevronRight className="h-3 w-3 text-slate-300" />
                </div>
              </div>

              <div className="flex items-center justify-between py-1">
                <span className="text-sm font-bold text-slate-600 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-green-500" /> Account Status
                </span>
                <Badge variant="success" className="rounded-md font-black uppercase tracking-tighter">Active</Badge>
              </div>

              <Separator className="bg-slate-200/60" />

              <div className="space-y-3">
                <Label className="text-[10px] font-bold text-slate-400 uppercase">Associated Unit</Label>
                <div className="flex items-center gap-3 p-1">
                   <div className="p-2 bg-blue-50 text-blue-600 rounded-xl"><Building2 className="h-4 w-4" /></div>
                   <span className="text-sm font-black text-slate-700">{data?.deptName || 'Global Operations'}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-[2rem] border-none shadow-sm ring-1 ring-border/50 overflow-hidden bg-gradient-to-br from-slate-900 to-slate-950 text-white">
            <CardHeader className="pb-2">
              <CardTitle className="text-xs font-bold uppercase tracking-widest text-slate-400">Security Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 pt-4">
               <div className="flex items-center justify-between">
                  <span className="text-sm opacity-60">Verified Roles</span>
                  <span className="text-sm font-black">{roles.length}</span>
               </div>
               <div className="flex items-center justify-between">
                  <span className="text-sm opacity-60">Access Permissions</span>
                  <span className="text-sm font-black">{permissions.length}</span>
               </div>
               <Button className="w-full bg-white text-slate-900 hover:bg-slate-100 rounded-xl font-bold mt-4 shadow-xl shadow-black/20 h-11">
                  Security Checkup
               </Button>
            </CardContent>
          </Card>
        </div>

        {/* 3. 右侧：权限矩阵与活动 */}
        <div className="lg:col-span-2">
          <Tabs defaultValue="permissions" className="w-full">
            <TabsList className="bg-slate-100/50 dark:bg-slate-900/50 p-1.5 rounded-[1.5rem] h-14 w-full grid grid-cols-2 border border-border/40 backdrop-blur-md">
              <TabsTrigger value="permissions" className="rounded-2xl font-black text-xs uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all">Permission Matrix</TabsTrigger>
              <TabsTrigger value="security" className="rounded-2xl font-black text-xs uppercase tracking-widest data-[state=active]:bg-white data-[state=active]:shadow-lg data-[state=active]:text-primary transition-all">Session History</TabsTrigger>
            </TabsList>

            <TabsContent value="permissions" className="pt-6 animate-in slide-in-from-bottom-4 duration-500">
              <Card className="rounded-[2rem] border-none shadow-sm ring-1 ring-border/50 overflow-hidden">
                <CardHeader className="px-8 pt-8">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-2xl font-black tracking-tight flex items-center gap-3">
                       <Key className="h-6 w-6 text-blue-600" />
                       Functional ACL
                    </CardTitle>
                    <Badge variant="outline" className="rounded-full px-3 py-1 font-mono text-[10px] opacity-40">Matrix v2.1</Badge>
                  </div>
                  <CardDescription className="font-medium text-slate-500">当前账户下所有生效的原子权限标识符</CardDescription>
                </CardHeader>
                <CardContent className="p-8">
                  <div className="grid gap-3 sm:grid-cols-2">
                    {permissions.map((perm: string) => (
                      <div key={perm} className="flex items-center justify-between p-4 rounded-[1.25rem] border bg-slate-50/30 hover:border-primary/30 hover:bg-white hover:shadow-xl hover:shadow-primary/5 transition-all duration-300 group">
                        <div className="flex items-center gap-3">
                           <div className="h-1.5 w-1.5 rounded-full bg-primary/40 group-hover:bg-primary group-hover:scale-150 transition-all" />
                           <code className="text-xs font-mono font-bold text-slate-600 group-hover:text-primary transition-colors">{perm}</code>
                        </div>
                        <CheckCircle2 className="h-3.5 w-3.5 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="security" className="pt-6 animate-in slide-in-from-bottom-4 duration-500">
              <Card className="rounded-[2rem] border-none shadow-sm ring-1 ring-border/50 overflow-hidden">
                <CardHeader className="px-8 pt-8">
                  <CardTitle className="text-2xl font-black tracking-tight flex items-center gap-3">
                    <Clock className="h-6 w-6 text-orange-500" />
                    Security Sessions
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-8 space-y-6">
                  <div className="flex flex-col md:flex-row items-center justify-between p-6 rounded-[1.5rem] bg-slate-50 dark:bg-slate-900 border-2 border-dashed border-slate-200 dark:border-slate-800 gap-6">
                    <div className="flex items-center gap-4">
                       <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center shadow-md"><ShieldAlert className="h-6 w-6 text-blue-600" /></div>
                       <div className="flex flex-col">
                         <span className="text-xs font-black uppercase text-slate-400">Established</span>
                         <span className="text-sm font-black text-slate-800">{new Date(data?.session?.createdAt).toLocaleString()}</span>
                       </div>
                    </div>
                    <Separator orientation="vertical" className="hidden md:block h-10" />
                    <div className="flex items-center gap-4">
                       <div className="h-12 w-12 rounded-full bg-white flex items-center justify-center shadow-md"><Calendar className="h-6 w-6 text-orange-600" /></div>
                       <div className="flex flex-col text-right md:text-left">
                         <span className="text-xs font-black uppercase text-slate-400">Expires At</span>
                         <span className="text-sm font-black text-slate-800">{new Date(data?.session?.expiresAt).toLocaleString()}</span>
                       </div>
                    </div>
                  </div>
                  
                  <div className="p-10 text-center border-2 border-dashed border-slate-100 rounded-[2rem]">
                    <Lock className="h-12 w-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-sm font-bold text-slate-400">Device Identity Verification Active</p>
                    <p className="text-[10px] text-slate-300 mt-1 uppercase tracking-widest">Global SSO Node: 172.18.0.4</p>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

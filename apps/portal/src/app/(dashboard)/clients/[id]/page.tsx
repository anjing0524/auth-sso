/**
 * Client 详情页 — Server Component 读模型直调（与 users/roles 详情页同构）。
 *
 * 交互态（表单编辑/标签页/写操作反馈）拆分至 ClientDetailClient（'use client'），
 * 写操作走 Server Actions，变更后 router.refresh() 重取本页 server 数据——
 * 消除原先 client 组件 → REST API → data.ts 的双重跳转读路径。
 */
import Link from 'next/link';
import { CLIENT_PERMISSIONS, can } from '@auth-sso/contracts';

import { PermissionGate } from '@/components/layout/permission-gate';

import { getClientById, getClientTokens } from '../data';
import { resolveIdentity } from '@/lib/auth';
import { getUserPermissionContext, toPermissionContextOrNull } from '@/lib/permissions';
import { ClientDetailClient } from './ClientDetailClient';


/**
 * 该路由读取会话/动态数据，**保留服务端阻塞**（Cache Components 的 instant 导航校验）。
 * 依据 Next 16 文档：启用 cacheComponents 后，读 session 的路由需显式声明；
 * 否则 Turbopack 运行时会报 "encountered uncached data during prerendering or a navigation"。
 */
export const instant = false;
interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;
  // client_id 是 `client_` 前缀的业务 ID（varchar），不是 UUID 列：这里不能套 UUID 判定，
  // 否则会把所有新建应用当成"不存在"（2026-10-20 改动时踩到过）。
  const client = await getClientById(id);

  if (!client) {
    return (
      <div className="text-center py-12">
        <p className="text-muted-foreground">Client 不存在</p>
        <Link href="/clients" className="mt-4 text-primary hover:underline">
          返回列表
        </Link>
      </div>
    );
  }

  const tokens = await getClientTokens(id, { page: 1, pageSize: 10 });

  const identity = await resolveIdentity();
  const permCtx = identity ? toPermissionContextOrNull(await getUserPermissionContext(identity.userId)) : null;
  const canUpdate = can(
    { roleCodes: permCtx?.roles.map((r) => r.code) ?? [], permissionCodes: permCtx?.permissions ?? [] },
    CLIENT_PERMISSIONS.UPDATE,
  );

  // 详情页要求 client:read；未授权时不得靠直接改 URL 读取应用配置（含回调/密钥状态）。
  return (
    <PermissionGate options={{ permissions: [CLIENT_PERMISSIONS.READ] }}>
      <ClientDetailClient client={client} initialTokens={tokens.data} canUpdate={canUpdate} />
    </PermissionGate>
  );
}

/**
 * Client 详情页 — Server Component 读模型直调（与 users/roles 详情页同构）。
 *
 * 交互态（表单编辑/标签页/写操作反馈）拆分至 ClientDetailClient（'use client'），
 * 写操作走 Server Actions，变更后 router.refresh() 重取本页 server 数据——
 * 消除原先 client 组件 → REST API → data.ts 的双重跳转读路径。
 */
import Link from 'next/link';

import { getClientById, getClientTokens } from '../data';
import { ClientDetailClient } from './ClientDetailClient';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;
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

  return <ClientDetailClient client={client} initialTokens={tokens.data} />;
}

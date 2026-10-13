/**
 * 用户详情页 — Server Component 读模型
 *
 * 鉴权由 layout.tsx 统一处理（LIST 权限）；**数据范围由读口在 SQL 内施加**：
 * 范围外与不存在的用户同形，一律 notFound()，不用状态码区分存在性（ADR-014 第 3 步）。
 *
 * 此前这里直接调 `getUser(id)`——那个读口没有范围参数，于是改 URL 里的 id
 * 即可跨部门读取任意用户详情（H-ACL-002 / P0）。
 */
import { notFound } from 'next/navigation';
import { resolveIdentity } from '@/lib/auth';
import { resolveScope } from '@/lib/authz';
import { db } from '@/infrastructure/db';
import { getUser } from '../data';
import UserDetailForm from './UserDetailForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;

  const identity = await resolveIdentity();
  const scope = identity ? await resolveScope(db, identity.userId) : { deptIds: [] };

  const user = await getUser(id, scope);
  if (!user) notFound();

  return <UserDetailForm id={id} initialUser={user} />;
}

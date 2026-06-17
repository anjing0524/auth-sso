/**
 * 用户详情页 (Server Component 读模型)
 *
 * 直接在服务端调用 data.ts 获取数据（非 Server Action），
 * 鉴权在调用前完成，符合 CQRS 读模型架构。
 * 数据刷新由 revalidatePath (Server Action 内) + router.refresh() 驱动。
 */
import { headers } from 'next/headers';
import { checkPermission } from '@/lib/auth';
import { getUser } from '../data';
import UserDetailForm from './UserDetailForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;

  // 鉴权：缓存作用域外完成身份校验与权限检查
  const auth = await checkPermission(await headers(), { permissions: ['user:read'] });
  const user = auth.authorized && auth.userId ? await getUser(id) : null;

  return <UserDetailForm id={id} initialUser={user} />;
}

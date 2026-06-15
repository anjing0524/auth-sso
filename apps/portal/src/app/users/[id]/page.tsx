/**
 * 用户详情页 (Server Component 读模型)
 *
 * 服务端获取数据，注入 Client Component。
 * 数据刷新由 revalidatePath (Server Action 内) + router.refresh() 驱动。
 */
import { getUserAction } from '../actions';
import UserDetailForm from './UserDetailForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const res = await getUserAction(id);
  const user = res.success && res.data ? res.data : null;

  return <UserDetailForm id={id} initialUser={user} />;
}

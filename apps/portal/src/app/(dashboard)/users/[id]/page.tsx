/**
 * 用户详情页 — Server Component 读模型
 *
 * 鉴权由 layout.tsx 统一处理，本组件零鉴权样板。
 */
import { getUser } from '../data';
import UserDetailForm from './UserDetailForm';

interface PageProps {
  params: Promise<{ id: string }>;
}

export default async function UserDetailPage({ params }: PageProps) {
  const { id } = await params;
  const user = await getUser(id);

  return <UserDetailForm id={id} initialUser={user} />;
}

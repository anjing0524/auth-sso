/**
 * Portal 首页
 * Auth-SSO 管理门户入口页面
 * 极简企业级风格：未登录则重定向至登录页，已登录则重定向至 Dashboard。
 * 消除了早期存在的大量 emoji 和 AI 生成式冗余占位介绍。
 */
import { Suspense } from 'react';
import { redirect } from 'next/navigation';
import { resolveIdentity } from '@/lib/auth';

/**
 * 首页内容组件，解析当前用户身份并重定向。
 * 包含获取身份（cookies/headers 等动态操作）的异步逻辑。
 */
async function HomeContent() {
  // 检查登录状态（复用统一身份解析入口，零验签快速路径）
  const identity = await resolveIdentity();
  if (identity) {
    redirect('/dashboard');
  }

  // 企业内部系统通常直接强制登录，不展示公开 landing page。
  redirect('/login');
  // TypeScript 类型守卫：redirect() 在此版本未推断为 never，需显式返回
  return null;
}

/**
 * Portal 首页入口。
 * 使用 Suspense 包装动态内容组件，解决 Next.js 编译期静态生成错误。
 */
export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
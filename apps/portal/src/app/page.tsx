/**
 * Portal 首页
 * Auth-SSO 管理门户入口页面
 * 极简企业级风格：未登录则重定向至登录页，已登录则重定向至 Dashboard。
 * 消除了早期存在的大量 emoji 和 AI 生成式冗余占位介绍。
 */
import { redirect } from 'next/navigation';
import { resolveIdentity } from '@/lib/auth';

export default async function HomePage() {
  // 检查登录状态（复用统一身份解析入口，零验签快速路径）
  const identity = await resolveIdentity();
  if (identity) {
    redirect('/dashboard');
  }

  // 企业内部系统通常直接强制登录，不展示公开 landing page。
  redirect('/login');
}
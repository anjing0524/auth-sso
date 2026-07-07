import 'server-only';

import { headers } from 'next/headers';
import { resolveIdentity } from './verify-jwt';
import { writeAccessLog, extractClientIP, extractUserAgent } from '@/lib/audit';

/**
 * 记录底层数据读取 (Server-only / data.ts) 的访问日志
 *
 * 在 Server Component 或 API 委托底层数据抓取时，在 data.ts 中自动捕获 HTTP 上下文并写日志。
 * 解决 SSR 获取数据时绕过 API 路由 `withPermission` 的问题，实现了彻底的收口。
 *
 * @param resourceType 资源类别，如 'user', 'role', 'department'
 * @param resourceId 具体被访问的数据 ID
 */
export async function logServerDataRead(resourceType: string, resourceId: string) {
  try {
    const identity = await resolveIdentity();
    if (!identity) return;

    // Next.js 可以在 server-only 代码中动态获取上下文 headers
    const reqHeaders = await headers();
    
    // 尝试获取请求路径
    const urlStr = reqHeaders.get('x-url') || reqHeaders.get('referer') || '';
    let path = `/${resourceType}s/${resourceId}`;
    try {
      if (urlStr) {
        path = new URL(urlStr).pathname;
      }
    } catch {}

    writeAccessLog({
      userId: identity.userId,
      username: identity.claims.sub ?? null,
      method: 'GET',
      path,
      resourceType,
      resourceId,
      ip: extractClientIP(reqHeaders),
      userAgent: extractUserAgent(reqHeaders),
      status: 200,
      duration: null, // 底层无法精确计算 API 的 HTTP 总耗时
    });
  } catch (err) {
    console.error('[Audit] 底层数据访问日志记录失败:', err);
  }
}

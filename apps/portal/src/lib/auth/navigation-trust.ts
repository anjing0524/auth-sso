import 'server-only';

/**
 * 顶级导航来源可信判定（登出端点的 CSRF 防线，H-09）
 *
 * 背景：`GET /api/auth/logout` 会执行四层撤销。由于 `SameSite=Lax` 的 Cookie 在
 * **跨站顶级 GET 导航**时会被携带，任何站点放一个 `<a href=".../api/auth/logout">`
 * 即可强制已登录用户登出（并触发该用户全部 RT 撤销）。POST 侧已有 `proxy.ts` 的
 * Origin 校验，但 GET 没有，且此类导航不携带 Origin。
 *
 * 判定来源：浏览器强制设置的 `Sec-Fetch-Site`（脚本不可伪造，禁止头）。
 * - same-origin / same-site / none（地址栏直达）→ 可信
 * - cross-site → 不可信（返回确认页，不产生任何状态变更）
 * - 缺失（老浏览器/非浏览器客户端）→ 以 Referer 同源回退；仍无法确认则按不可信处理
 */
import type { NextRequest } from 'next/server';
import { getTrustedOrigins } from '@/lib/env';

export function isTrustedTopLevelNavigation(request: NextRequest): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site) {
    return site === 'same-origin' || site === 'same-site' || site === 'none';
  }

  // 回退：老浏览器不发送 Sec-Fetch-*，用 Referer 同源判定（无 Referer 时按不可信处理）
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    const refererUrl = new URL(referer);
    if (getTrustedOrigins().includes(refererUrl.origin)) return true;
    const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0]?.trim();
    const host = forwardedHost ?? request.headers.get('host');
    return Boolean(host) && refererUrl.host === host;
  } catch {
    return false;
  }
}

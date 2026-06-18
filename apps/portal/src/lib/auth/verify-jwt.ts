import 'server-only';

/**
 * 身份验证子模块 (Identity Verification)
 *
 * 双层策略：
 * 1. Gateway 信任路径 — 读取 X-User-Id header（Gateway 已完成 ES256 离线验签）
 *    适用于：Server Components / Server Actions / API Routes（均在 Gateway 后）
 * 2. JWT Cookie 验签 — 兜底路径，适用于本地开发无 Gateway、OAuth 外部端点
 *
 * 使用 React.cache() 实现同请求去重，嵌套 SC layout/page 调用命中缓存。
 *
 * @module lib/auth/verify-jwt
 */
import { cache } from 'react';
import { headers } from 'next/headers';
import { getJwtFromCookie } from '../session';
import { verifyAccessToken } from '@/lib/auth/token';
import type { ResolvedIdentity } from '@/domain/auth/types';

export type { ResolvedIdentity };

/**
 * 从 header 中读取 Gateway 注入的 X-User-Id。
 * Gateway 已完成 ES256 验签 + Cookie 零拷贝解析，Portal 信任其注入的 header。
 * 仅在内网环境下安全——需确保外网无法直接访问 Portal。
 */
async function getGatewayUserId(): Promise<string | null> {
  try {
    const h = await headers();
    return h.get('x-user-id') || null;
  } catch {
    return null; // 本地 dev / 非 HTTP 上下文
  }
}

/**
 * 从当前请求解析用户身份。
 *
 * 优先信任 Gateway X-User-Id → 零验签、零 DB。
 * 兜底 JWT Cookie 验签 → 适用于本地开发无 Gateway 环境。
 *
 * React.cache() 保证同一次 HTTP 请求内嵌套 SC (layout → sub-layout → page) 只执行一次。
 */
export const resolveIdentity = cache(
  async (): Promise<ResolvedIdentity | null> => {
    // Layer 1: 信任 Gateway（生产环境主路径，0ms + 0 DB）
    const gatewayUserId = await getGatewayUserId();
    if (gatewayUserId) {
      return { userId: gatewayUserId, claims: null };
    }

    // Layer 2: JWT Cookie 验签（本地开发兜底）
    const token = await getJwtFromCookie();
    if (!token) return null;

    const claims = await verifyAccessToken(token);
    if (!claims) return null;

    return { userId: claims.sub, claims };
  },
);

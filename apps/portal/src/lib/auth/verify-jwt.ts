import 'server-only';

/**
 * 身份验证子模块 (Identity Verification)
 *
 * 双层策略：
 * 1. Gateway 信任路径 — 读取 X-User-Id header
 *    Gateway 已完成 ES256 离线验签 + jti 黑名单校验 + userId→jti 追踪，
 *    Portal 信任其结果，零验签、零额外 I/O。
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
import { decodeJwtPayload } from '@/lib/session/jwt';
import { GATEWAY_HEADERS } from '@auth-sso/contracts';
import type { ResolvedIdentity, PortalJwtClaims } from '@/domain/auth/types';

export type { ResolvedIdentity };

/** Gateway 路径下 claims 缺失时的最小 fallback */
const EMPTY_CLAIMS: PortalJwtClaims = {
  sub: '',
  iss: '',
  aud: '',
  jti: '',
  roles: [],
  permissions: [],
  deptIds: [],
};

/**
 * 从 header 中读取 Gateway 注入的 X-User-Id。
 * Gateway 已完成全套验签，Portal 信任其注入的 header。
 *
 * 不 catch headers() 的异常——构建期 prerendering 中断信号需要自然传播到 <Suspense>，
 * 请求期 headers() 是平台标准 API，不会 throw。
 */
async function getGatewayUserId(): Promise<string | null> {
  const h = await headers();
  return h.get(GATEWAY_HEADERS.USER_ID) || null;
}

/**
 * 尝试从请求上下文（Authorization 请求头或 Cookie）中提取 JWT。
 *
 * 先查 Authorization header，不存在则回退到 Cookie。
 * 不 catch——构建期异常由 <Suspense> 静默处理，请求期这些平台 API 不会失败。
 */
async function getJwtFromRequest(): Promise<string | null> {
  const h = await headers();
  const auth = h.get('Authorization') || h.get('authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.substring(7).trim();
  }
  return getJwtFromCookie();
}

/**
 * 从当前请求解析用户身份。
 *
 * 优先信任 Gateway X-User-Id → 从请求中提取 JWT 并快速解码获取完整 claims（不验签，Gateway 已验证）。
 * 兜底 JWT Cookie/Header 验签 → 适用于本地开发无 Gateway 环境。
 */
export const resolveIdentity = cache(
  async (): Promise<ResolvedIdentity | null> => {
    const gatewayUserId = await getGatewayUserId();
    const token = await getJwtFromRequest();

    if (gatewayUserId) {
      // Gateway 已验证 JWT 签名 + issuer + jti，Portal 补充 aud 校验（纵深防御）
      if (token) {
        const claims = decodeJwtPayload(token);
        if (claims && claims.aud === 'portal-client') {
          return { userId: gatewayUserId, claims };
        }
        if (claims && claims.aud !== 'portal-client') {
          console.warn('[Auth] Gateway 信任路径 aud 不匹配:', claims.aud);
        }
      }
      // 极端情况：有 X-User-Id 但无有效 JWT → 降级最小 claims
      return { userId: gatewayUserId, claims: { ...EMPTY_CLAIMS, sub: gatewayUserId } };
    }

    // Fallback：无 Gateway，自验签
    if (!token) return null;

    const claims = await verifyAccessToken(token);
    if (!claims) return null;

    return { userId: claims.sub, claims };
  },
);

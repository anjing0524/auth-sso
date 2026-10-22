import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { getJwtFromCookie } from '../session';
import { verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { getGatewaySharedSecret } from '@/lib/env';
import { GATEWAY_HEADERS, PORTAL_CLIENT_ID, JWT_TYP } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';
import type { ResolvedIdentity } from '@/domain/auth/types';
import { verifySignature, SIGNATURE_TIMESTAMP_WINDOW_SEC } from './gateway-hmac';

const log = createLogger('Auth');

/**
 * 把 JWT 载荷折叠为身份 + 时间字段。
 *
 * 只把调用方真正需要的两个时间字段带出 seam，而不是整个 claims 对象——
 * 后者曾是空字符串哨兵值的载体（ADR-016）。
 */
function toIdentity(
  userId: string,
  claims: { exp?: number; iat?: number },
): ResolvedIdentity {
  return {
    userId,
    expiresAt: typeof claims.exp === 'number' ? claims.exp : null,
    issuedAt: typeof claims.iat === 'number' ? claims.iat : null,
  };
}

export type { ResolvedIdentity };

/** HMAC-SHA256 签名头名称 */
const HEADER_SIGNATURE = 'x-gateway-signature';
const HEADER_TIMESTAMP = 'x-gateway-timestamp';

/**
 * 校验当前请求是否来自受信任的 Gateway。
 *
 * 策略（严格模式）：
 * - 必须配置 GATEWAY_SHARED_SECRET，否则直接拒绝 Gateway 信任路径
 * - 配置后校验 HMAC-SHA256 签名 + 时间戳窗口（密码学保证）
 *
 * 不 catch headers() 的异常——构建期 prerendering 中断信号需要自然传播到 <Suspense>，
 * 请求期 headers() 是平台标准 API，不会 throw。
 */
async function isRequestFromTrustedGateway(userId: string, jti: string): Promise<boolean> {
  const h = await headers();
  const secret = getGatewaySharedSecret();

  // 严格要求：未配置共享密钥则直接拒绝，不走任何降级路径
  if (!secret) {
    log.warn('GATEWAY_SHARED_SECRET 未配置，Gateway 信任路径不可用');
    return false;
  }

  // 检查必需签名头
  const signature = h.get(HEADER_SIGNATURE);
  const timestamp = h.get(HEADER_TIMESTAMP);

  if (!signature || !timestamp) {
    log.warn('缺少 X-Gateway-Signature 或 X-Gateway-Timestamp，拒绝 Gateway 信任路径');
    return false;
  }

  const payload = `${timestamp}:${userId}:${jti}`;
  return verifySignature(secret, payload, timestamp, signature, SIGNATURE_TIMESTAMP_WINDOW_SEC);
}

/**
 * 从 header 中读取 Gateway 注入的 X-User-Id。
 *
 * 必须先通过 isRequestFromTrustedGateway() 校验来源合法性，再调用此函数。
 * 不 catch headers() 的异常——构建期 prerendering 中断信号需要自然传播到 <Suspense>。
 */
async function getGatewayUserId(): Promise<string | null> {
  const h = await headers();
  return h.get(GATEWAY_HEADERS.USER_ID) || null;
}

/**
 * 从 header 中读取 Gateway 注入的 X-User-Jti。
 */
async function getGatewayJti(): Promise<string> {
  const h = await headers();
  return h.get(GATEWAY_HEADERS.USER_JTI) || '';
}

/**
 * 尝试从请求上下文（Authorization 请求头或 Cookie）中提取 JWT。
 *
 * 先查 Authorization header，不存在则回退到 Cookie。
 * 不 catch——构建期异常由 <Suspense> 静默处理，请求期这些平台 API 不会失败。
 */
async function getJwtFromRequest(): Promise<string | null> {
  const h = await headers();
  const auth = h.get('Authorization');
  if (auth && auth.toLowerCase().startsWith('bearer ')) {
    return auth.substring(7).trim();
  }
  return getJwtFromCookie();
}

/**
 * 从当前请求解析用户身份。
 *
 * 优先信任 Gateway X-User-Id（须通过 HMAC 签名校验）→ 轻量解码 JWT 获取完整 claims。
 * 兜底 JWT Cookie/Header 验签 → 适用于本地开发无 Gateway 或签名校验未通过时。
 */
export const resolveIdentity = cache(
  async (): Promise<ResolvedIdentity | null> => {
    const gatewayUserId = await getGatewayUserId();
    const token = await getJwtFromRequest();

    if (gatewayUserId) {
      const jti = await getGatewayJti();
      if (await isRequestFromTrustedGateway(gatewayUserId, jti)) {
        // Gateway 已验证 JWT 签名 + issuer + jti，Portal 补充 aud 校验（纵深防御，
        // ADR-013：AT aud = 签发对象 client_id，Gateway 信任路径的 AT 恒为 portal）
        if (token) {
          // aud 复核（纵深防御）在本模块内完成，不把解码结果带出 seam —— 见 ADR-016。
          const claims = decodeJwtPayload(token);
          if (claims && claims.aud === PORTAL_CLIENT_ID) {
            return toIdentity(gatewayUserId, claims);
          }
          if (claims && claims.aud !== PORTAL_CLIENT_ID) {
            log.warn('Gateway 信任路径 aud 不匹配', { aud: claims.aud });
          }
        }
        // 极端情况：有 X-User-Id 但无有效 JWT → 仍信任 Gateway 注入的身份。
        // 此时无 token 可解码；身份唯一来源是 HMAC 已验的 X-User-Id。
        return { userId: gatewayUserId, expiresAt: null, issuedAt: null };
      }
    }

    // Fallback：无 Gateway 或 HMAC 校验未通过 → 自验签
    if (!token) return null;

    const claims = await verifyAccessToken(token, PORTAL_CLIENT_ID, JWT_TYP.ACCESS_TOKEN);
    if (!claims) return null;

    return toIdentity(claims.sub, claims);
  },
);

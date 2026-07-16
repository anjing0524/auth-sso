import 'server-only';
import { cache } from 'react';
import { headers } from 'next/headers';
import { getJwtFromCookie } from '../session';
import { verifyAccessToken } from '@/lib/auth/token';
import { decodeJwtPayload } from '@/lib/session/jwt';
import { getGatewaySharedSecret } from '@/lib/env';
import { GATEWAY_HEADERS, PORTAL_AUD } from '@auth-sso/contracts';
import { createLogger } from '@/lib/logger';
import type { ResolvedIdentity, PortalJwtClaims } from '@/domain/auth/types';
import { verifySignature, SIGNATURE_TIMESTAMP_WINDOW_SEC } from './gateway-hmac';

const log = createLogger('Auth');

export type { ResolvedIdentity };

/**
 * Gateway 信任路径下 claims 缺失时的最小 fallback。
 *
 * 空字符串（sub/iss/aud/jti）是 Gateway 信任路径的占位哨兵值——
 * 表示这些字段未由 JWT 解析获取，而是由 Gateway 的 X-User-Id 等头注入。
 * 下游消费者（如数据范围守卫）需自行检查并处理空值，
 * 不应将空字符串与真实 JWT claims 混淆。
 */
const EMPTY_CLAIMS: PortalJwtClaims = {
  sub: '',
  iss: '',
  aud: '',
  jti: '',
};

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
  const auth = h.get('Authorization') || h.get('authorization');
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
        // Gateway 已验证 JWT 签名 + issuer + jti，Portal 补充 aud 校验（纵深防御）
        if (token) {
          const claims = decodeJwtPayload(token);
          if (claims && claims.aud === PORTAL_AUD) {
            return { userId: gatewayUserId, claims };
          }
          if (claims && claims.aud !== PORTAL_AUD) {
            log.warn('Gateway 信任路径 aud 不匹配', { aud: claims.aud });
          }
        }
        // 极端情况：有 X-User-Id 但无有效 JWT → 降级最小 claims。
        // EMPTY_CLAIMS 的 sub/iss/aud/jti 为空字符串哨兵值，仅 sub 由 Gateway userId 填充。
        // 下游消费方（如 canAccessDept）需自行处理空 aud/jti，不可假设必填字段非空。
        return { userId: gatewayUserId, claims: { ...EMPTY_CLAIMS, sub: gatewayUserId } };
      }
    }

    // Fallback：无 Gateway 或 HMAC 校验未通过 → 自验签
    if (!token) return null;

    const claims = await verifyAccessToken(token);
    if (!claims) return null;

    return { userId: claims.sub, claims };
  },
);

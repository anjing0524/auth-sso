import 'server-only';
import { timingSafeEqual } from 'crypto';

/**
 * 身份验证子模块 (Identity Verification)
 *
 * 双层策略：
 * 1. Gateway 信任路径 — 读取 X-User-Id header（须通过 HMAC 签名校验）
 *    Gateway 已完成 ES256 离线验签 + jti 黑名单校验 + userId→jti 追踪，
 *    并对 (timestamp + userId + jti) 计算 HMAC-SHA256 签名注入请求头。
 *    Portal 验证此签名以确认请求确实来自受信任的 Gateway。
 *    GATEWAY_SHARED_SECRET 为必须配置项，未配置时严格拒绝 Gateway 路径。
 * 2. JWT Cookie 验签 — 兜底路径，适用于本地开发无 Gateway 场景
 *    （直接由 Portal 自验签，不依赖 Gateway 信任链）。
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
import { getGatewaySharedSecret } from '@/lib/env';
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

/** HMAC 签名时间戳容忍窗口（秒），防止时钟偏差导致的误拒绝 */
const SIGNATURE_TIMESTAMP_WINDOW_SEC = 60;

/** HMAC-SHA256 签名头名称 */
const HEADER_SIGNATURE = 'x-gateway-signature';
const HEADER_TIMESTAMP = 'x-gateway-timestamp';

/**
 * 使用 Web Crypto API 计算 HMAC-SHA256 并以 hex 字符串返回。
 */
async function computeHmacHex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(payload));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * 校验当前请求是否来自受信任的 Gateway。
 *
 * 策略（严格模式）：
 * - 必须配置 GATEWAY_SHARED_SECRET，否则直接拒绝 Gateway 信任路径
 * - 配置后校验 HMAC-SHA256 签名 + 时间戳窗口（密码学保证）
 * - HMAC 比对使用 timingSafeEqual 防止时序侧信道攻击
 *
 * 不 catch headers() 的异常——构建期 prerendering 中断信号需要自然传播到 <Suspense>，
 * 请求期 headers() 是平台标准 API，不会 throw。
 */
async function isRequestFromTrustedGateway(userId: string, jti: string): Promise<boolean> {
  const h = await headers();
  const secret = getGatewaySharedSecret();

  // 严格要求：未配置共享密钥则直接拒绝，不走任何降级路径
  if (!secret) {
    console.warn(
      '[Auth] GATEWAY_SHARED_SECRET 未配置，Gateway 信任路径不可用。' +
      '如需启用 Gateway 路径，请在环境变量中配置 GATEWAY_SHARED_SECRET。',
    );
    return false;
  }

  // 检查必需签名头
  const signature = h.get(HEADER_SIGNATURE);
  const timestamp = h.get(HEADER_TIMESTAMP);

  if (!signature || !timestamp) {
    console.warn(
      '[Auth] GATEWAY_SHARED_SECRET 已配置，但缺少 X-Gateway-Signature 或 X-Gateway-Timestamp。' +
      '请求可能绕过 Gateway 直连 Portal，已拒绝 Gateway 信任路径。',
    );
    return false;
  }

  // 时间戳窗口校验（防重放）
  const ts = parseInt(timestamp, 10);
  if (isNaN(ts)) {
    console.warn('[Auth] X-Gateway-Timestamp 格式无效:', timestamp);
    return false;
  }
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > SIGNATURE_TIMESTAMP_WINDOW_SEC) {
    console.warn(
      `[Auth] X-Gateway-Timestamp 超出窗口 (${SIGNATURE_TIMESTAMP_WINDOW_SEC}s): ` +
      `now=${nowSec}, ts=${ts}`,
    );
    return false;
  }

  // HMAC 签名比对：使用常时比较（constant-time comparison）防止时序侧信道攻击
  const payload = `${timestamp}:${userId}:${jti}`;
  const expected = await computeHmacHex(secret, payload);
  const sigBuf = Buffer.from(signature, 'hex');
  const expBuf = Buffer.from(expected, 'hex');
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    console.warn('[Auth] HMAC 签名不匹配。请求可能被篡改或来自非受信任来源。');
    return false;
  }

  return true;
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
    }

    // Fallback：无 Gateway 或 HMAC 校验未通过 → 自验签
    if (!token) return null;

    const claims = await verifyAccessToken(token);
    if (!claims) return null;

    return { userId: claims.sub, claims };
  },
);

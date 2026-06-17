import 'server-only';

/**
 * 身份验证子模块 (Identity Verification)
 *
 * 纯 JWT Cookie 架构：从 portal_jwt_token Cookie 中提取 JWT，
 * 使用 jose 本地 JWKS 验签，完全无状态。
 *
 * 已移除 Better Auth getSession 回退——无 Session 架构。
 *
 * @module lib/auth/verify-jwt
 */
import { NextRequest } from 'next/server';
import { getJwtFromCookie } from '../session';
import { verifyAccessToken } from '@/domain/auth/token';
import type { PortalJwtClaims, ResolvedIdentity } from '@/domain/auth/types';

export type { ResolvedIdentity };

/**
 * 从当前请求解析用户身份（纯 JWT，无 Session 回退）
 *
 * @param request 可选——当前未使用（Cookie 通过 next/headers 读取），保留以兼容现有调用方
 * @returns 解析成功返回身份信息，未登录返回 null
 */
export async function resolveIdentity(
  _request?: NextRequest | Headers,
): Promise<ResolvedIdentity | null> {
  // 从 Cookie 读取 JWT 并验签
  const token = await getJwtFromCookie();
  if (!token) return null;

  const claims = await verifyAccessToken(token);
  if (!claims) return null;

  return { userId: claims.sub, claims };
}

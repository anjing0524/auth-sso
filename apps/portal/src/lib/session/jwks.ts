import 'server-only';

/**
 * JWKS 远端公钥集（懒初始化，jose 内部自动缓存 + 定期刷新）
 *
 * @module lib/session/jwks
 */
import { createRemoteJWKSet } from 'jose';
import { getJwksUri } from '@/lib/env';

/** 懒初始化的 JWKS 远端公钥集，用于验签 Portal OIDC Provider 签发的 JWT */
let jwksSet: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * 获取 JWKS 远端公钥集（单例模式）
 * jose 的 createRemoteJWKSet 内部维护缓存，自动处理 kid 匹配与刷新
 */
export function getJwksSet() {
  if (!jwksSet) {
    jwksSet = createRemoteJWKSet(new URL(getJwksUri()));
  }
  return jwksSet;
}

import 'server-only';

/**
 * JWKS 远端公钥集（懒初始化，jose 内部自动缓存 + 定期刷新）
 *
 * @module lib/session/jwks
 */
import { createRemoteJWKSet } from 'jose';

/** 懒初始化的 JWKS 远端公钥集，用于验签 Portal OIDC Provider 签发的 JWT */
let jwksSet: ReturnType<typeof createRemoteJWKSet> | null = null;

/**
 * 获取 JWKS 远端公钥集（单例模式）
 * jose 的 createRemoteJWKSet 内部维护缓存，自动处理 kid 匹配与刷新
 */
export function getJwksSet() {
  if (!jwksSet) {
    const jwksUri = (process.env.PORTAL_JWKS_URI || 'http://localhost:4100/api/auth/.well-known/jwks').trim();
    jwksSet = createRemoteJWKSet(new URL(jwksUri));
  }
  return jwksSet;
}

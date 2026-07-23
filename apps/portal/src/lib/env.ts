import 'server-only';

/**
 * Portal 服务端环境变量配置（薄 re-export 层）
 *
 * 实际逻辑在 @auth-sso/config 共享包中。
 * 此文件仅负责添加 server-only 约束，确保这些函数不会泄露到浏览器端。
 *
 * @module lib/env
 */

export {
  getAppBaseURL,
  getIssuer,
  getJwksUri,
  getTrustedOrigins,
  getGatewaySharedSecret,
  getRedisUrl,
  getEnvConfig,
  parsePortalEnv,
  isCookieSecure,
} from '@auth-sso/config';

export type { PortalEnv } from '@auth-sso/config';

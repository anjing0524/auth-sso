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
  getDatabaseUrl,
  getLogLevel,
  getEnvConfig,
  parsePortalEnv,
  isCookieSecure,
  // 公开 URL 推导的唯一实现（纯函数，接受 env 注入）——getter 只是它的缓存视图包装
  resolvePublicUrls,
} from '@auth-sso/config';

export type { PortalEnv, PublicUrlEnv, PublicUrls } from '@auth-sso/config';

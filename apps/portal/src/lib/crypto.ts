import { randomBytes, randomUUID } from 'crypto';

/**
 * 统一身份认证平台 - 安全工具库
 * 提供随机ID、OAuth Client ID 以及 Client Secret 的统一生成方法。
 */

/**
 * 生成指定长度的随机 ID (基于十六进制字符)
 * @param length 生成的 ID 长度，默认为 20
 * @returns 随机生成的 ID 字符串
 */
export function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成基于 UUID v4 的标准唯一标识符
 * @returns 标准的 UUID 字符串
 */
export function generateUUID(): string {
  return randomUUID();
}

/**
 * 生成 OAuth 2.0 客户端标识符 (ClientId)
 * @returns 带有 'client_' 前缀的唯一客户端 ID
 */
export function generateClientId(): string {
  return `client_${randomBytes(8).toString('hex')}`;
}

/**
 * 生成 OAuth 2.0 客户端密钥 (ClientSecret)
 * @returns 64个字符的安全高强度随机 Secret
 */
export function generateClientSecret(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 生成权限公共标识符 (PublicId)
 * @returns 带有 'perm_' 前缀的唯一权限 PublicId
 */
export function generatePermissionPublicId(): string {
  return `perm_${Date.now().toString(36)}${randomBytes(2).toString('hex')}`;
}

/**
 * 生成符合 PKCE 规范的高熵 Code Verifier (标准 base64url 格式)
 * @returns 密码学安全的随机 Code Verifier
 */
export function generateCodeVerifier(): string {
  return randomBytes(48).toString('base64url');
}

/**
 * 根据 PKCE Code Verifier 计算对应的 SHA-256 Code Challenge
 * @param verifier PKCE 规范的 Code Verifier 字符串
 * @returns SHA-256 base64url 编码的挑战值
 */
export function generateCodeChallenge(verifier: string): string {
  const { createHash } = require('crypto');
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * 生成用于 OIDC 授权流程中防范 CSRF 攻击的强安全 State 因子
 * @returns 64位高强度随机十六进制 State 字符串
 */
export function generateState(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 生成用于 OIDC 校验的防重放安全 Nonce 因子
 * @returns 32位高强度随机十六进制 Nonce 字符串
 */
export function generateNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * 生成用于请求追踪的链路追踪 Request ID
 * @returns 12位安全的随机 Request ID 字符串
 */
export function generateRequestId(): string {
  return generateId(12);
}



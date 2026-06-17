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
  return `perm_${randomUUID()}`;
}

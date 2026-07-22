import { randomBytes, randomUUID, createHash, createCipheriv, createDecipheriv } from 'crypto';
import bcrypt from 'bcryptjs';

/**
 * 统一身份认证平台 - 安全工具库
 * 提供随机ID、OAuth Client ID 以及 Client Secret 的统一生成方法。
 *
 * v2 变更：移除 generatePermissionPublicId（public_id 已被废除）
 */

/**
 * 生成指定长度的随机 ID (基于十六进制字符)
 * 保留用于日志表等不需要 UUID 的辅助表
 * @param length 生成的 ID 长度，默认为 20
 * @returns 随机生成的 ID 字符串
 */
export function generateId(length: number = 20): string {
  return randomBytes(length).toString('hex').slice(0, length);
}

/**
 * 生成基于 UUID v4 的标准唯一标识符
 * 用于所有核心实体表的 PK 生成（对齐 PostgreSQL uuid 类型）
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
 * 计算 token 的 SHA256 hex 摘要 — access_tokens.token_hash 的统一算法
 *
 * 签发入库（`lib/auth/token.ts`）与撤销删表（`lib/session/revoke.ts`、
 * `oauth2/revoke` 端点）必须共用此函数，保证「按 token 明文定位行」的算法一致，
 * 避免各处独立实现 createHash 导致算法漂移后撤销删不到行。
 *
 * @param token 原始 token 字符串（JWT 或不透明 token），不存明文
 * @returns 64 字符小写 hex 摘要，匹配 `access_tokens.token_hash varchar(64)`
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * 计算 Client Secret 的 bcrypt 哈希 — DC-CLI-C 安全存储要求
 *
 * Secret 原文不存入 DB，仅存储哈希值；验证时对明文做相同哈希后比较。
 * 创建/轮换时返回一次原文，之后不可再获取。
 *
 * @param secret 原始 Client Secret 字符串
 * @returns bcrypt 哈希摘要 (异步)
 */
export async function hashClientSecret(secret: string): Promise<string> {
  return bcrypt.hash(secret, 12);
}

// ── JWKS 私钥加密（AES-256-GCM）─────────────────────────────────────

const AES_ALGORITHM = 'aes-256-gcm' as const;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

function getEncryptionKey(): Buffer | null {
  const raw = process.env['JWKS_ENCRYPTION_KEY'];
  if (!raw || raw.length !== 64) return null;
  return Buffer.from(raw, 'hex');
}

/**
 * AES-256-GCM 加密 JWKS 私钥 JSON 字符串
 *
 * 加密后格式（base64 编码）：IV(12 bytes) || ciphertext || authTag(16 bytes)
 * 若 JWKS_ENCRYPTION_KEY 未配置，返回原文（向后兼容未加密部署）。
 *
 * @param plaintext 私钥 JWK JSON 字符串
 * @returns base64 编码的密文，或原文（未配置加密密钥时）
 */
export function encryptPrivateKey(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, encrypted, authTag]).toString('base64');
}

/**
 * AES-256-GCM 解密 JWKS 私钥
 *
 * 若密文不以 base64 格式开头（即仍为 JSON 明文），直接返回原文（向后兼容）。
 *
 * @param ciphertext base64 密文或 JSON 明文
 * @returns 私钥 JWK JSON 字符串
 */
export function decryptPrivateKey(ciphertext: string): string {
  const key = getEncryptionKey();
  if (!key) return ciphertext;

  let buf: Buffer;
  try {
    buf = Buffer.from(ciphertext, 'base64');
  } catch {
    return ciphertext;
  }

  // 最小长度校验：IV(12) + authTag(16) + 至少 1 字节密文 = 29
  if (buf.length < IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    return ciphertext; // 仍为明文 JSON
  }

  try {
    const iv = buf.subarray(0, IV_LENGTH);
    const authTag = buf.subarray(buf.length - AUTH_TAG_LENGTH);
    const encrypted = buf.subarray(IV_LENGTH, buf.length - AUTH_TAG_LENGTH);

    const decipher = createDecipheriv(AES_ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    return ciphertext; // 解密失败时返回原文（兼容旧数据）
  }
}

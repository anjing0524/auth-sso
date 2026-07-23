/**
 * OAuth Client 校验领域函数（纯函数，零框架依赖）
 *
 * Controller 负责 Drizzle 查询，将结果传入这些纯函数做业务判断。
 * 违反规则时抛出对应的 DomainError，由 Controller 的 mapDomainError() 统一映射。
 *
 * @module domain/auth/oauth-client
 */
import { createHash, timingSafeEqual } from 'crypto';
import bcrypt from 'bcryptjs';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import { InvalidClientError, InvalidRedirectUriError } from '@/domain/shared/errors';

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substring(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * 校验 OAuth Client 是否存在且处于激活状态
 * @param clientRow - Drizzle 查询结果（undefined 表示未找到）
 * @throws InvalidClientError 当 Client 不存在或已停用
 */
export function validateClientActive(
  clientRow: { status: string } | undefined,
): asserts clientRow is NonNullable<typeof clientRow> {
  if (!clientRow || clientRow.status !== ENTITY_ACTIVE) {
    throw new InvalidClientError('该应用系统已停用或不存在，请联系管理员。');
  }
}

/**
 * 校验 Client Secret（兼容 SHA-256 遗留数据与 bcrypt 新数据，均作定时安全比较）
 *
 * 验证时对提供值根据 DB hash 类型进行比对：
 * 1. 若为 bcrypt，使用 async compare；
 * 2. 若为 SHA-256（64位 hex），使用 timingSafeEqual。
 *
 * @param client - 包含 clientSecret 的 Client 对象
 * @param providedSecret - 请求中携带的 client_secret 原文
 * @throws InvalidClientError 当 secret 缺失或不匹配
 */
/** bcrypt 哈希前缀（识别已迁移至 bcrypt 的 Client Secret） */
const BCRYPT_PREFIXES = ['$2a$', '$2b$', '$2y$'] as const;

export async function validateClientSecret(
  client: { clientSecret: string | null; isPublic?: boolean | null },
  providedSecret?: string,
): Promise<void> {
  if (!client.clientSecret) {
    if (client.isPublic) return;
    throw new InvalidClientError('客户端密钥未配置');
  }
  if (!providedSecret) {
    throw new InvalidClientError('客户端密钥缺失');
  }
  let matched = false;
  if (BCRYPT_PREFIXES.some((prefix) => client.clientSecret!.startsWith(prefix))) {
    matched = await bcrypt.compare(providedSecret, client.clientSecret);
  } else {
    const providedHash = createHash('sha256').update(providedSecret).digest('hex');
    const bufA = hexToBytes(client.clientSecret);
    const bufB = hexToBytes(providedHash);
    if (bufA.length === bufB.length) {
      matched = timingSafeEqual(bufA, bufB);
    }
  }
  if (!matched) {
    throw new InvalidClientError('客户端密钥不匹配');
  }
}

/**
 * 校验 redirect_uri 是否在 Client 注册的白名单中（精确匹配）
 *
 * 安全注意：必须使用精确字符串比较，禁止 startsWith 前缀匹配——
 * 前缀放行会让 `https://app.example.com/cb` 错误地接受 `https://app.example.com/cb.evil.com/...`，
 * 构成开放重定向风险（OAuth 2.1 安全最佳实践 / RFC 6749 §3.1.2.3）。
 *
 * @param redirectUris - Client 注册的 redirect URI 数组（PG text[]）
 * @param redirectUri - 请求中的 redirect_uri
 * @throws InvalidRedirectUriError 当 redirect_uri 不在白名单中
 */
export function validateRedirectUri(redirectUris: string[], redirectUri: string): void {
  if (!redirectUris.includes(redirectUri)) {
    throw new InvalidRedirectUriError();
  }
}

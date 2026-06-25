/**
 * OAuth Client 校验领域函数（纯函数，零框架依赖）
 *
 * Controller 负责 Drizzle 查询，将结果传入这些纯函数做业务判断。
 * 违反规则时抛出对应的 DomainError，由 Controller 的 mapDomainError() 统一映射。
 *
 * @module domain/auth/oauth-client
 */
import { createHash } from 'crypto';
import { ENTITY_ACTIVE } from '@auth-sso/contracts';
import { InvalidClientError, InvalidRedirectUriError } from '@/domain/shared/errors';

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
 * 校验 Client Secret（v3.2: SHA-256 哈希比较，原文不入库）
 *
 * 存储的是 `SHA256(secret)` 摘要，验证时对提供值做相同哈希后比较。
 *
 * @param client - 包含 clientSecret（SHA-256 hex）的 Client 对象
 * @param providedSecret - 请求中携带的 client_secret 原文
 * @throws InvalidClientError 当 secret 缺失或不匹配
 */
export function validateClientSecret(
  client: { clientSecret: string | null },
  providedSecret?: string,
): void {
  if (client.clientSecret) {
    if (!providedSecret) {
      throw new InvalidClientError('客户端密钥缺失');
    }
    const providedHash = createHash('sha256').update(providedSecret).digest('hex');
    if (client.clientSecret !== providedHash) {
      throw new InvalidClientError('客户端密钥不匹配');
    }
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

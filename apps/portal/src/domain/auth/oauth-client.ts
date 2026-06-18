/**
 * OAuth Client 校验领域函数（纯函数，零框架依赖）
 *
 * Controller 负责 Drizzle 查询，将结果传入这些纯函数做业务判断。
 * 违反规则时抛出对应的 DomainError，由 Controller 的 mapDomainError() 统一映射。
 *
 * @module domain/auth/oauth-client
 */
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
 * 校验 Client Secret（confidential client 必须提供有效的 secret）
 * @param client - 包含 clientSecret 的 Client 对象
 * @param providedSecret - 请求中携带的 client_secret
 * @throws InvalidClientError 当 secret 缺失或不匹配
 */
export function validateClientSecret(
  client: { clientSecret: string | null },
  providedSecret?: string,
): void {
  if (client.clientSecret && (!providedSecret || client.clientSecret !== providedSecret)) {
    throw new InvalidClientError('客户端密钥缺失或不匹配');
  }
}

/**
 * 校验 redirect_uri 是否在 Client 注册的白名单中
 * @param redirectUrls - Client 注册的 redirect URI 数组（PG text[]）
 * @param redirectUri - 请求中的 redirect_uri
 * @throws InvalidRedirectUriError 当 redirect_uri 不在白名单中
 */
export function validateRedirectUri(redirectUrls: string[], redirectUri: string): void {
  if (!redirectUrls.some((uri) => redirectUri.startsWith(uri))) {
    throw new InvalidRedirectUriError();
  }
}

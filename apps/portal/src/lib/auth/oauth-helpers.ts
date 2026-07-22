import 'server-only';

/**
 * OAuth 端点共享辅助函数（编排层）
 *
 * 封装「DB 查询 + 领域校验」的组合模式，消除 introspect / revoke / token
 * 等 OAuth 端点中重复出现的 client 认证样板代码。
 *
 * @module lib/auth/oauth-helpers
 */
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';

/**
 * OAuth Client 认证：查询 DB → 校验状态 → 校验密钥。
 *
 * 对应 introspect / revoke / token 端点中重复的 5 行 boilerplate。
 * 校验失败时抛出 DomainError，由调用方的 mapDomainError 统一映射。
 *
 * @param clientId     - 请求中的 client_id
 * @param clientSecret - 请求中的 client_secret（可选）
 * @returns 匹配的 Client 行（已通过 validateClientActive 的 NonNullable 守卫）
 */
export async function authenticateOAuthClient(
  clientId: string,
  clientSecret?: string,
): Promise<typeof schema.clients.$inferSelect> {
  const rows = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.clientId, clientId))
    .limit(1);
  validateClientActive(rows[0]);
  await validateClientSecret(rows[0]!, clientSecret);
  return rows[0]!;
}

import 'server-only';

/**
 * OAuth 端点共享辅助函数（编排层）
 *
 * 封装「DB 查询 + 领域校验」的组合模式。**本模块是取得 OAuth Client 的唯一入口**：
 *
 * - {@link resolveActiveClient} —— 查询 + **激活校验**（authorize 等 PKCE 路径）
 * - {@link authenticateOAuthClient} —— 前者 + 密钥校验（token / introspect / revoke / register）
 *
 * ## 为什么收成一个 module（2026-10-13，架构评审 R2 次级候选）
 *
 * 原先只有 `authenticateOAuthClient`，它的注释自称覆盖
 * "introspect / revoke / token 端点中重复的 5 行 boilerplate" —— **恰恰漏掉 authorize**
 * （PKCE 路径不需要密钥，用不上这个函数）。于是 authorize 在**两处**各自裸写
 * `getClientByClientId + validateClientActive`，`permissions/register` 又写第三遍
 * （连查询都自己来）。同一 risk 面：**任何一处漏掉 `validateClientActive` 就会接受停用 client**。
 *
 * 现在 `getClientByClientId` 已随本模块落地而删除（它曾是"未校验的行"的唯一来源），
 * 取得 client 只能经这两个函数之一 ⇒ 漏校验在结构上不可能。
 *
 * @module lib/auth/oauth-helpers
 */
import { db, schema } from '@/infrastructure/db';
import { eq } from 'drizzle-orm';
import type { NextResponse } from 'next/server';
import { validateClientActive, validateClientSecret } from '@/domain/auth/oauth-client';

/** Client 行类型（Drizzle 原始行） */
export type ClientRow = typeof schema.clients.$inferSelect;

/**
 * 给 OAuth 协议响应加缓存禁止头（RFC 6749 §5.1 MUST；RFC 7662 §2.2 SHOULD）。
 *
 * token 响应含令牌明文，绝不能被浏览器/代理缓存；introspect/revoke/userinfo
 * 同样属于不允许缓存的协议响应。多个端点此前各自手工拼响应，缓存头全部缺失。
 */
export function withOAuthNoStore<T extends NextResponse>(response: T): T {
  response.headers.set('Cache-Control', 'no-store');
  response.headers.set('Pragma', 'no-cache');
  return response;
}

/** 按 client_id 查询原始行（私有：**不校验**，故不导出——避免又出现"未校验的行"这个出口） */
async function findByClientId(clientId: string): Promise<ClientRow | null> {
  const rows = await db
    .select()
    .from(schema.clients)
    .where(eq(schema.clients.clientId, clientId))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * 取得**可用**的 OAuth Client：查询 + 激活校验一次完成。
 *
 * 用于 authorize 等**不需要密钥**的路径（PKCE 公开客户端）。
 *
 * @param clientId 请求中的 client_id
 * @returns 已确认存在且处于 ACTIVE 的 Client 行
 * @throws InvalidClientError 不存在或已停用（由调用方的 `mapDomainError` 统一映射）
 */
export async function resolveActiveClient(clientId: string): Promise<ClientRow> {
  const row = await findByClientId(clientId);
  // 断言函数把 row 收窄为 NonNullable —— 调用方**拿不到**未校验的行
  validateClientActive(row ?? undefined);
  return row!;
}

/**
 * OAuth Client 认证：查询 DB → 校验状态 → 校验密钥。
 *
 * 校验失败时抛出 DomainError，由调用方的 mapDomainError 统一映射。
 * **查询与激活校验复用 {@link resolveActiveClient}**，本函数只加密钥这一层。
 *
 * @param clientId     - 请求中的 client_id
 * @param clientSecret - 请求中的 client_secret（可选）
 * @returns 匹配的 Client 行（已存在、ACTIVE、且密钥已校验）
 */
export async function authenticateOAuthClient(
  clientId: string,
  clientSecret?: string,
): Promise<ClientRow> {
  const client = await resolveActiveClient(clientId);
  await validateClientSecret(client, clientSecret);
  return client;
}

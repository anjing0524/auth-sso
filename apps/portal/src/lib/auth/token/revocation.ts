import 'server-only';

/**
 * Refresh Token 撤销 — 领域维度收口模块
 *
 * "撤销一个 / 一族 / 一批 RT"此前散落为 12 份相同 SQL 的编排拷贝（token.ts、
 * logout、RFC 7009 revoke、管理端 actions/tokens route），每份各自决定 client
 * 限定、家族级联与事务归属。本模块将其收敛为按领域维度命名的五个函数，
 * 撤销语义（ADR-012 家族 = (userId, clientId)）在一处定义。
 *
 * 维度语义速查（调用方按语义对号入座，禁止绕行手写 SQL）：
 * | 函数                        | where                       | 返回   | 典型调用方 |
 * | revokeRefreshTokenById      | id                          | void   | 轮换、补偿回收 |
 * | revokeRefreshTokenByTokenHash | tokenHash (+clientId 限定?) | void | 登出、RFC 7009 |
 * | revokeRefreshTokenFamily    | userId + clientId           | void   | 重放级联 (RFC 9700) |
 * | revokeUserRefreshTokens     | userId                      | void   | 登出防御纵深 |
 * | revokeClientRefreshTokens   | clientId (+ids) 仅未撤销行   | count  | 管理端撤销（需真实计数） |
 *
 * 覆盖式函数（void）不区分行是否已撤销——重复标记幂等；管理端函数仅统计
 * 本次真实翻转的行（isNull(revoked) + returning），供 UI 与审计展示。
 *
 * @module lib/auth/token/revocation
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { schema } from '@/infrastructure/db';
import type { DbExecutor } from '@/infrastructure/db';

/** 撤销执行器（DbExecutor 别名）：db 直连、事务句柄或等价 drizzle 实例，撤销可在事务内外调用 */
export type RevocationExecutor = DbExecutor;

/**
 * 撤销单个 Refresh Token（按行 ID，覆盖式）。
 *
 * 调用方：`rotateRefreshToken` 轮换旧 RT、事务提交后补偿回收新 RT。
 */
export async function revokeRefreshTokenById(
  executor: RevocationExecutor,
  id: string,
): Promise<void> {
  await executor
    .update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(eq(schema.refreshTokens.id, id));
}

/**
 * 撤销 Refresh Token（按 tokenHash 匹配，覆盖式）。
 *
 * @param opts.clientId - RFC 7009 §2.1 场景传入：仅撤销归属该 Client 名下的行，
 *   阻断跨 client 撤销 DoS；登出等无 client 上下文场景省略。
 *
 * 调用方：`/api/auth/logout`（无限定）、`/api/auth/oauth2/revoke`（client 限定）。
 */
export async function revokeRefreshTokenByTokenHash(
  executor: RevocationExecutor,
  tokenHash: string,
  opts?: { clientId?: string },
): Promise<void> {
  await executor
    .update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(opts?.clientId
      ? and(
          eq(schema.refreshTokens.tokenHash, tokenHash),
          eq(schema.refreshTokens.clientId, opts.clientId),
        )
      : eq(schema.refreshTokens.tokenHash, tokenHash));
}

/**
 * 撤销同属一个授权家族 (userId, clientId) 的全部 Refresh Token（覆盖式）。
 *
 * RFC 9700 §4.14：重放检测命中与 sender 绑定失配共用此原语——级联范围是
 * 同一授权家族而非该用户全部会话，其他 client 的会话不受牵连（消除跨
 * client DoS 放大）。事务内外均可调用（重放检测在事务外，轮换在事务内）。
 *
 * 调用方：`rotateRefreshToken`（tx 内）、`/api/auth/oauth2/token` 重放取证（db 直连）。
 */
export async function revokeRefreshTokenFamily(
  executor: RevocationExecutor,
  userId: string,
  clientId: string,
): Promise<void> {
  await executor
    .update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(and(
      eq(schema.refreshTokens.userId, userId),
      eq(schema.refreshTokens.clientId, clientId),
    ));
}

/**
 * 撤销某用户全部 Refresh Token（覆盖式）——账户封禁 / 强制下线的 RT 侧。
 *
 * 仅标记 RT 行；Access Token 的 jti 批量撤销属于 Session 侧职责
 * （`revokeUserAccessByUserId`），由编排方（`revokeAllRefreshTokens`、登出）
 * 组合，本模块不越界触碰 Redis。
 *
 * 调用方：`/api/auth/logout` 防御纵深、`revokeAllRefreshTokens`。
 */
export async function revokeUserRefreshTokens(
  executor: RevocationExecutor,
  userId: string,
): Promise<void> {
  await executor
    .update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(eq(schema.refreshTokens.userId, userId));
}

/**
 * 管理端撤销 Client 名下的 Refresh Token，返回本次真实翻转的行数。
 *
 * 与覆盖式函数的语义差异：只统计 `revoked` 从 NULL → 时间戳的行
 * （isNull 过滤 + returning），供 UI 提示与审计日志展示准确数字；重复
 * 调用同一批已撤销 token 会得到 0 而非虚增。
 *
 * @param opts.tokenIds - 传入时仅撤销指定行；省略时撤销该 client 全部未撤销 RT
 *   （RFC 9700 按授权家族整体终止续期能力，已发 AT 在 ≤1h TTL 内自然失效）。
 *
 * 调用方：`(dashboard)/clients/actions.ts`、`/api/clients/[id]/tokens`（tx + 审计）。
 */
export async function revokeClientRefreshTokens(
  executor: RevocationExecutor,
  clientId: string,
  opts?: { tokenIds?: string[] },
): Promise<number> {
  const result = await executor
    .update(schema.refreshTokens)
    .set({ revoked: new Date() })
    .where(opts?.tokenIds?.length
      ? and(
          eq(schema.refreshTokens.clientId, clientId),
          inArray(schema.refreshTokens.id, opts.tokenIds),
          isNull(schema.refreshTokens.revoked),
        )
      : and(
          eq(schema.refreshTokens.clientId, clientId),
          isNull(schema.refreshTokens.revoked),
        ))
    .returning({ id: schema.refreshTokens.id });
  return result.length;
}

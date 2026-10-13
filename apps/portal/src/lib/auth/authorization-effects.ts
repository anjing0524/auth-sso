import 'server-only';

/**
 * 权限决策变更后的收敛动作 (Authorization Effects)
 *
 * 「权限决策变了 → 受影响用户必须重新拿到权限」这件事由两个动作组成，且**必须成对**：
 *
 * 1. **撤销其 Access Token**（jti 黑名单）—— 强制重登，消除凭据与权限缓存的双源不一致
 * 2. **主动刷新其权限上下文缓存** —— 让下一次请求立即看到新权限
 *
 * ## 为什么需要它
 *
 * 此前这两个动作由 6~8 个写点各自手写配对，四种形态并存：`refresh→revoke`、
 * `revoke→refresh`（反序）、"条件撤"、"只刷不撤"。**顺序是隐式知识**，漏掉任何一半
 * 也没有任何信号——两个批量原语的返回值在全部调用点被丢弃。
 *
 * 本模块把**顺序**与**配对**收进 implementation，只暴露两个具名动词，调用方只需回答
 * 一个问题：这次变更**改变权限决策**了吗？
 *
 * | 动词 | 何时用 | 内部动作 |
 * |---|---|---|
 * | {@link revokeAndRefreshAuthorization} | 权限决策变了（角色/权限/部门归属） | 撤销 AT → 刷新缓存 |
 * | {@link refreshAuthorizationCache} | 不改变决策（角色/权限改名、描述） | 只刷新缓存 |
 *
 * ## 顺序为什么固定为「先撤销、后刷新」
 *
 * 撤销是**安全相关**动作（决定用户还能不能用旧凭据），刷新是**缓存性**动作
 * （ADR-011 fail-open）。两者都失败时，先撤后刷至少让"强制重登"生效；而重新登录时
 * token 签发路径会预填充权限缓存，因此这个顺序在部分失败下**自愈**。反过来
 * （先刷后撤）若撤销失败，旧 AT 会继续可用至自然过期——那是两者中更坏的一种残留。
 *
 * ## 日志
 *
 * 本模块**不记日志**：两个批量原语各自记录自己的成败与计数（"谁拥有该知识谁记录"）。
 *
 * @module lib/auth/authorization-effects
 */
import { refreshUsersPermissionCache } from '@/lib/permissions';
import { revokeUsersAccessByUserId } from '@/lib/session/revoke';

/** 只刷缓存的收敛结果 */
export interface CacheEffectResult {
  /** 本次涉及的受影响用户数 */
  readonly users: number;
  /** 权限上下文缓存刷新失败的**用户数** */
  readonly cacheFailed: number;
}

/** 撤销 + 刷新的收敛结果 */
export interface RevocationEffectResult {
  /** 本次涉及的受影响用户数 */
  readonly users: number;
  /** Access Token 撤销（jti 黑名单）成功的**用户数** */
  readonly atRevokeSucceeded: number;
  /** Access Token 撤销未执行的用户数（Redis 故障；ADR-011 fail-open） */
  readonly atRevokeFailed: number;
  /** 权限上下文缓存刷新失败的**用户数** */
  readonly cacheFailed: number;
}

/**
 * 只刷新权限缓存 —— 用于**不改变权限决策**的变更（角色/权限改名、描述等）。
 *
 * @param userIds 受影响的用户（无受影响者时传空数组，不做任何 I/O）
 */
export async function refreshAuthorizationCache(
  userIds: readonly string[],
): Promise<CacheEffectResult> {
  if (userIds.length === 0) return { users: 0, cacheFailed: 0 };

  const cache = await refreshUsersPermissionCache([...userIds]);
  return { users: userIds.length, cacheFailed: cache.failed };
}

/**
 * 撤销 Access Token 并刷新权限缓存 —— 用于**改变权限决策**的变更。
 *
 * @param userIds 受影响的用户（无受影响者时传空数组，不做任何 I/O）
 */
export async function revokeAndRefreshAuthorization(
  userIds: readonly string[],
): Promise<RevocationEffectResult> {
  if (userIds.length === 0) {
    return { users: 0, atRevokeSucceeded: 0, atRevokeFailed: 0, cacheFailed: 0 };
  }

  // 顺序固定：先撤销（安全相关），后刷新（缓存性）。见模块头部的理由。
  const revoke = await revokeUsersAccessByUserId([...userIds]);
  const cache = await refreshUsersPermissionCache([...userIds]);

  return {
    users: userIds.length,
    atRevokeSucceeded: revoke.succeeded,
    atRevokeFailed: revoke.failed,
    cacheFailed: cache.failed,
  };
}

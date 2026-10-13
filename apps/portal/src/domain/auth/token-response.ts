/**
 * OAuth token 端点响应组装（纯函数）—— 领域结果 → RFC 6749 §5.1 协议形状
 *
 * ## 为什么要有它（2026-10-13，架构评审 R2 次级候选「token 签发族统一返回形状」）
 *
 * 同一 token 族的两个分支产出**两种领域形状**（授权码兑换在 module 内直接给协议形状；
 * 轮换给 camelCase 的 `RefreshTokenResult`），于是协议响应被**每个调用点手拼**：
 * `/api/auth/oauth2/token` 的 refresh 分支手写
 * `{access_token, token_type, expires_in, refresh_token}` 并**漏掉 `scope`**
 * ——而 RFC 6749 §5.1 要求回报授予范围，且轮换手里本来就有 `rt.scopes`。
 *
 * 本函数是**唯一**把"领域结果"组装成协议响应的位置：`scope` 在输入里是必填，
 * 因此"漏回报 scope"这一类缺陷在结构上不再可能。
 *
 * 授权码兑换分支仍在 `lib/auth/oauth-grant` 内直接产出 `OAuthTokenResponse`
 * （它本就是协议的实现方），两侧的形状一致性由 `oauth2-token.test.ts` 的分支对照用例钉住。
 *
 * @module domain/auth/token-response
 */
import type { OAuthTokenResponse } from './types';

/** 组装协议响应的输入（领域结果形状；`scope` 必填） */
export interface TokenResponseInput {
  readonly accessToken: string;
  readonly expiresIn: number;
  readonly refreshToken?: string;
  readonly idToken?: string;
  /** 本次授予的 scope（空格分隔）—— 必填，缺席即"漏回报"缺陷 */
  readonly scope: string;
}

/**
 * 领域结果 → RFC 6749 §5.1 成功响应体。
 *
 * 可选字段用条件展开（`exactOptionalPropertyTypes` 下不能写成 `undefined` 联合）。
 */
export function toOAuthTokenResponse(input: TokenResponseInput): OAuthTokenResponse {
  return {
    access_token: input.accessToken,
    token_type: 'Bearer',
    expires_in: input.expiresIn,
    ...(input.refreshToken ? { refresh_token: input.refreshToken } : {}),
    ...(input.idToken ? { id_token: input.idToken } : {}),
    scope: input.scope,
  };
}

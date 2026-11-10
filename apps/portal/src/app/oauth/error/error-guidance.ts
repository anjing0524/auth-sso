/**
 * OAuth 错误页的错误码 → 自助恢复指引映射（PM-03）
 *
 * 纯函数、零依赖 Next.js（服务端渲染直接调用）。
 * `error` query 参数的取值来源（`buildOAuthErrorRedirect` 的调用方）：
 * - `mapServerError()` 输出的 contracts 闭合词汇表错误码（AUTH_SSO_*）
 * - authorize 路由内联的 OAuth 语义短码（session_expired / invalid_request）
 *
 * 键里的 AUTH_SSO_* 用 contracts 常量而非字面量（枚举值唯一真相源），
 * 短码字面量与 authorize 路由的调用点保持一致。
 */

import { AUTH_ERRORS, COMMON_ERRORS } from '@auth-sso/contracts';

export interface ErrorGuidance {
  /** 一句话定性（错误页副标题） */
  summary: string;
  /** 自助恢复步骤；通用兜底也给出可执行动作，不出现「请联系 @IT」类租户内部指代 */
  selfHelp: string[];
}

/** 已知错误码（含 OAuth 语义短码）→ 针对性指引 */
const GUIDANCE_MAP: Record<string, ErrorGuidance> = {
  // 入口 Host 与已注册回调地址逐字节绑定（PM-01 复核结论）：localhost 等未注册入口
  // 会构造出白名单外的 redirect_uri。给用户的自助路径：换规范入口，或管理员登记入口。
  [AUTH_ERRORS.OAUTH_INVALID_REDIRECT_URI]: {
    summary: '回调地址与该应用注册的白名单不匹配',
    selfHelp: [
      '请改用管理员提供的规范入口地址（如正式域名）访问本系统，再重新发起登录。',
      '若确需通过当前地址访问，请管理员把该入口的回调地址登记进应用的白名单后重试。',
    ],
  },
  [AUTH_ERRORS.INVALID_CLIENT]: {
    summary: '目标应用未注册或已停用',
    selfHelp: [
      '请从原系统的正式入口重新发起登录，确认链接未过期或被改动。',
      '反复出现时，请联系管理员核对该应用的注册信息与启用状态。',
    ],
  },
  [AUTH_ERRORS.INVALID_SCOPE]: {
    summary: '请求的授权范围超出了该应用的注册范围',
    selfHelp: [
      '请回原系统重新发起登录；若应用确需新增授权范围，由管理员调整应用的 scope 配置。',
    ],
  },
  [COMMON_ERRORS.FORBIDDEN]: {
    summary: '当前账号无权访问目标系统',
    selfHelp: ['请联系管理员为你的账号分配可访问该系统的角色或权限。'],
  },
  // authorize 路由内联短码（非 contracts 词汇表成员）
  session_expired: {
    summary: '授权会话已过期或与当前浏览器不匹配',
    selfHelp: ['请回到原系统重新发起登录，完成新的授权流程。'],
  },
  invalid_request: {
    summary: '授权请求参数不完整或不合法',
    selfHelp: ['请从原系统的正式入口重新发起登录；反复出现请联系管理员检查应用配置。'],
  },
  unauthorized_client: {
    summary: '该账户无权访问目标系统',
    selfHelp: ['请联系管理员为你的账号开通该系统的访问权限。'],
  },
};

/** 未知错误码的通用兜底：不给无法兑现的承诺，只给可执行动作 */
const FALLBACK: ErrorGuidance = {
  summary: '授权流程中断',
  selfHelp: ['请返回原系统重新发起登录。'],
};

/** 解析错误码 → 自助指引；未知/缺失错误码走通用兜底 */
export function resolveErrorGuidance(error: string | null | undefined): ErrorGuidance {
  return (error && GUIDANCE_MAP[error]) || FALLBACK;
}

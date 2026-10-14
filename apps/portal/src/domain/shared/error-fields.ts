/**
 * 错误码 → 表单字段：把"可判别的失败原因"落到**具体输入框**上
 *
 * ## 为什么（#82 的价值兑现点 / #92）
 *
 * #82 让服务端能报出**具体**冲突码（`USERNAME_ALREADY_EXISTS` / `EMAIL_ALREADY_EXISTS` /
 * `MOBILE_ALREADY_EXISTS` / `PASSWORD_TOO_WEAK` / …），但前端此前**零消费**：
 * 只有 `toast.error(res.message)`。于是客户端仍在**解析服务端的中文文案**——
 * 文案一改，展示与语义就脱钩，而"能定位到哪个输入框"这个能力等于白建。
 *
 * ## 约定
 *
 * - 值是**表单字段标识**：与实体表单里承载该值的字段同名
 *   （用户域 = `username`/`email`/`mobile`/`password`；角色/部门/权限 = `code`；客户端 = `clientId`）。
 * - **纯函数、无副作用**：只做码 → 字段的查表；不认识就返回 `null`，
 *   由调用方回落到原有的消息提示（不重复提示）。
 * - **自维护**：`error-fields.test.ts` 断言"契约里每个 `*_ALREADY_EXISTS` 码都必须有映射"
 *   ——新增冲突码却忘了映射，测试立刻变红。
 *
 * @module domain/shared/error-fields
 */
import {
  CLIENT_ERRORS,
  DEPARTMENT_ERRORS,
  PERMISSION_ERRORS,
  ROLE_ERRORS,
  USER_ERRORS,
  type ErrorCode,
} from '@auth-sso/contracts';

/** 表单字段标识（各实体表单里承载该值的字段名） */
export type ErrorField = 'username' | 'email' | 'mobile' | 'password' | 'code' | 'clientId';

/**
 * 错误码 → 表单字段。
 *
 * 未列出的码（含 `VALIDATION_ERROR`、`NOT_FOUND`、`FORBIDDEN` 这类**非字段级**原因）
 * 一律回落到消息提示——它们不是"某个输入框写错了"。
 */
export const ERROR_CODE_FIELDS = {
  // 用户域：具体到字段的冲突码（#82 接通的 8 个码里最需要定位的一组）
  [USER_ERRORS.USERNAME_ALREADY_EXISTS]: 'username',
  [USER_ERRORS.EMAIL_ALREADY_EXISTS]: 'email',
  [USER_ERRORS.MOBILE_ALREADY_EXISTS]: 'mobile',
  // 复合唯一约束时的实体级回落：无从判断是哪一列 ⇒ 归到最常用的登录名
  [USER_ERRORS.USER_ALREADY_EXISTS]: 'username',
  [USER_ERRORS.PASSWORD_TOO_WEAK]: 'password',
  // 其余实体的冲突码：各自表单里承载唯一值的字段
  [ROLE_ERRORS.ROLE_ALREADY_EXISTS]: 'code',
  [DEPARTMENT_ERRORS.DEPARTMENT_ALREADY_EXISTS]: 'code',
  [PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS]: 'code',
  [CLIENT_ERRORS.CLIENT_ALREADY_EXISTS]: 'clientId',
} as const satisfies Partial<Record<ErrorCode, ErrorField>>;

/**
 * 该错误码要不要落到具体字段上。
 *
 * @param code 响应里的 `error`（服务端给的**具体**码）；未知/为空 ⇒ `null`
 * @returns 字段标识；非字段级原因返回 `null`
 */
export function fieldForErrorCode(code: ErrorCode | string | undefined | null): ErrorField | null {
  if (!code) return null;
  return (ERROR_CODE_FIELDS as Record<string, ErrorField | undefined>)[code] ?? null;
}

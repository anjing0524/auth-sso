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
 *   （用户域 = `username`/`email`/`password`；角色/部门/权限 = `code`）。
 *   没有用户可编辑输入框的冲突码归入 `CONFLICT_CODES_WITHOUT_FIELD`（见下），**不在本表**。
 * - **纯函数、无副作用**：只做码 → 字段的查表；不认识就返回 `null`，
 *   由调用方回落到原有的消息提示（不重复提示）。
 * - **自维护**：`error-fields.test.ts` 断言"契约里每个 `*_ALREADY_EXISTS` 码都必须**要么有字段映射、
 *   要么在 `CONFLICT_CODES_WITHOUT_FIELD` 里写明理由**"——新增冲突码却忘了分类，测试立刻变红。
 * - **无对应字段**不是例外，而是**分类**：`MOBILE_ALREADY_EXISTS` / `CLIENT_ALREADY_EXISTS`
 *   在当前 UI 里没有用户可编辑的输入框（创建用户表单不采集 mobile；client_id 由服务端生成）
 *   ⇒ 落到提示而非某个输入框。理由必须写下来，将来表单加了字段再翻回来。
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

/**
 * 允许的字段标识（**值化清单**）。
 *
 * 为什么是值而不是纯类型：纯类型无法被测试枚举 ⇒ 会留下无人映射的 dead member
 * （本会话实测：`mobile` / `clientId` 曾出现在手工类型里，而两条映射已被归入
 * 「无对应字段」⇒ 类型比现实宽）。值化之后 `error-fields.test.ts` 可以做**双向**断言：
 * 映射的值 ⊆ 本清单，且**本清单每一项都至少被一个码用到**。
 */
export const ERROR_FIELDS = ['username', 'email', 'password', 'code'] as const;

/** 表单字段标识（各实体表单里承载该值的字段名） */
export type ErrorField = (typeof ERROR_FIELDS)[number];

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
  [USER_ERRORS.PASSWORD_TOO_WEAK]: 'password',
  // 其余实体的冲突码：各自表单里承载唯一值的字段
  [ROLE_ERRORS.ROLE_ALREADY_EXISTS]: 'code',
  [DEPARTMENT_ERRORS.DEPARTMENT_ALREADY_EXISTS]: 'code',
  [PERMISSION_ERRORS.PERMISSION_ALREADY_EXISTS]: 'code',
} as const satisfies Partial<Record<ErrorCode, ErrorField>>;

/**
 * 冲突码里**没有用户可编辑字段**的那些：落到消息提示，而不是某个输入框。
 *
 * 值与 `ERROR_CODE_FIELDS` 互补；`error-fields.test.ts` 断言两者合起来覆盖全部
 * `*_ALREADY_EXISTS` 码（**分类必须完整**，不留"忘了映射"的空档）。
 */
export const CONFLICT_CODES_WITHOUT_FIELD = {
  [USER_ERRORS.USER_ALREADY_EXISTS]:
    '复合唯一约束的实体级回落：无法判断是哪一列——把任一输入框标红都是猜测（代码评审查出）',
  [USER_ERRORS.MOBILE_ALREADY_EXISTS]:
    'UI 没有任何表单采集 mobile（用户创建/编辑表单都没有该输入框）⇒ 无处就地提示，走 toast',
  [CLIENT_ERRORS.CLIENT_ALREADY_EXISTS]:
    'client_id 由服务端生成（创建表单不采集）⇒ 此码只可能来自内部唯一约束碰撞，归属不到输入框',
} as const satisfies Partial<Record<ErrorCode, string>>;

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

/**
 * 用户域错误文案的**展示层**本地化（U-G07）。
 *
 * 领域错误 `DuplicateEntityError` 的消息模板是 `${entity} 的 ${field} 已存在`，
 * 用户创建/编辑路径传入的实体名是英文 `User` ⇒ 用户看到「User 的 email 已存在」。
 * 文案源头在 `domain/shared/errors.ts`（跨域共享，F7 不改），故在页面组件层按
 * **具体错误码**覆盖成中文；未知码回落到服务端 message（保留可诊断性）。
 */
import { USER_ERRORS } from '@auth-sso/contracts';

const FRIENDLY_BY_CODE: Record<string, string> = {
  [USER_ERRORS.USERNAME_ALREADY_EXISTS]: '该用户名已被使用，请换一个',
  [USER_ERRORS.EMAIL_ALREADY_EXISTS]: '该邮箱已被使用，请换一个',
  [USER_ERRORS.MOBILE_ALREADY_EXISTS]: '该手机号已被使用，请换一个',
  [USER_ERRORS.USER_ALREADY_EXISTS]: '该用户已存在',
};

/** 把 Action 失败响应转成用户可读中文（优先按错误码映射，其次服务端 message） */
export function userFacingMessage(
  res: { error?: string; message?: string },
  fallback = '操作失败',
): string {
  const mapped = res.error ? FRIENDLY_BY_CODE[res.error] : undefined;
  return mapped ?? res.message ?? fallback;
}

/**
 * 用户基础资料的前端校验（详情编辑共用）。
 *
 * 只做必填/长度/邮箱形状的快速反馈；最终一致性仍由服务端 Zod 决定。
 */
export interface UserBasicsInput {
  name: string;
  email: string;
}

export interface UserBasicsErrors {
  name?: string;
  email?: string;
}

export function validateUserBasics(input: UserBasicsInput): UserBasicsErrors {
  const errors: UserBasicsErrors = {};
  const name = input.name.trim();
  if (!name) errors.name = '显示名称不能为空';
  else if (name.length > 100) errors.name = '显示名称最多 100 个字符';

  const email = input.email.trim();
  if (!email) errors.email = '电子邮箱不能为空';
  else if (email.length > 255) errors.email = '电子邮箱最多 255 个字符';
  else if (!/^[^\s@]+@[^\s@]+$/.test(email)) errors.email = '电子邮箱格式不正确';

  return errors;
}

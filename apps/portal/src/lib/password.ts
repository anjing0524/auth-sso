import bcrypt from 'bcryptjs';

/**
 * 密码哈希服务 —— 基础设施层职责
 * 将密码 hash 逻辑从 Controller 层下沉到基础设施层
 *
 * @param raw 原始密码
 * @returns 哈希后的密码字符串
 */
export async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, 10);
}

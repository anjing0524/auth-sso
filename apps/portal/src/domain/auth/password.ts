/**
 * 密码哈希领域服务 (Password Hashing Domain Service)
 *
 * 封装 bcrypt 哈希与验证逻辑，纯函数无副作用。
 * 从 Better Auth 的 emailAndPassword.password 配置迁移而来。
 *
 * @module domain/auth/password
 */
import bcrypt from 'bcryptjs';

const BCRYPT_ROUNDS = 10;

/**
 * 对原始密码进行 bcrypt 哈希
 *
 * @param raw 原始明文密码
 * @returns 哈希后的密码字符串
 */
export async function hashPassword(raw: string): Promise<string> {
  return bcrypt.hash(raw, BCRYPT_ROUNDS);
}

/**
 * 验证明文密码是否与哈希匹配
 *
 * @param plaintext 用户输入的明文密码
 * @param hash      数据库中存储的密码哈希
 * @returns 验证通过返回 true
 */
export async function verifyPassword(plaintext: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}

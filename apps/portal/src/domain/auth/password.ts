/**
 * 密码哈希领域服务 (Password Hashing Domain Service)
 *
 * 封装 bcrypt 哈希与验证逻辑，纯函数无副作用。
 * 从 Better Auth 的 emailAndPassword.password 配置迁移而来。
 *
 * 所有接受密码配置的函数均支持显式注入 PasswordConfig；未注入时使用
 * 固定默认值。领域层不读取环境变量，运行环境配置须在应用边界注入。
 *
 * @module domain/auth/password
 */
import bcrypt from 'bcryptjs';

// ── 配置接口（可注入，供测试使用）─────────────────────────────────────

export interface PasswordConfig {
  bcryptRounds: number;
  passwordHistoryMax: number;
}

export const DEFAULT_PASSWORD_CONFIG: PasswordConfig = {
  bcryptRounds: 12,
  passwordHistoryMax: 5,
};

export const PASSWORD_HISTORY_MAX = DEFAULT_PASSWORD_CONFIG.passwordHistoryMax;

// ── 密码哈希与验证 ─────────────────────────────────────────────────────

/**
 * 对原始密码进行 bcrypt 哈希
 *
 * @param raw    原始明文密码
 * @param config 可选配置，未传时使用固定默认值
 * @returns 哈希后的密码字符串
 */
export async function hashPassword(raw: string, config?: PasswordConfig): Promise<string> {
  const rounds = config?.bcryptRounds ?? DEFAULT_PASSWORD_CONFIG.bcryptRounds;
  return bcrypt.hash(raw, rounds);
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

// ── 密码历史（NFR-SEC-15）───────────────────────────────────────────────

/**
 * 检查新密码是否与历史密码重复（NFR-SEC-15）
 *
 * @param newPassword  新密码明文
 * @param history      数据库 password_history 列（bcrypt hash 数组，可能为 null）
 * @returns true 表示新密码命中历史（应拒绝），false 表示可接受
 */
export async function isPasswordReused(
  newPassword: string,
  history: string[] | null,
): Promise<boolean> {
  if (!history || history.length === 0) return false;
  const results = await Promise.all(
    history.map((oldHash) => bcrypt.compare(newPassword, oldHash)),
  );
  return results.some(Boolean);
}

/**
 * 将旧密码 hash 追加到历史并截断至上限，返回新数组（不修改原数组）。
 *
 * @param prevHistory 原历史数组（可能为 null）
 * @param oldHash     本次被替换的旧密码 hash
 * @param config      可选配置，未传时使用模块级 PASSWORD_HISTORY_MAX
 * @returns 更新后的历史数组（最新在前）
 */
export function pushPasswordHistory(
  prevHistory: string[] | null,
  oldHash: string,
  config?: PasswordConfig,
): string[] {
  const max = config?.passwordHistoryMax ?? PASSWORD_HISTORY_MAX;
  const next = prevHistory ? [oldHash, ...prevHistory] : [oldHash];
  return next.slice(0, max);
}

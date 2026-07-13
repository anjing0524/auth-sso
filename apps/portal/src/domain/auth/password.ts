/**
 * 密码哈希领域服务 (Password Hashing Domain Service)
 *
 * 封装 bcrypt 哈希与验证逻辑，纯函数无副作用。
 * 从 Better Auth 的 emailAndPassword.password 配置迁移而来。
 *
 * @module domain/auth/password
 */
import bcrypt from 'bcryptjs';

/**
 * bcrypt cost factor。
 *
 * OWASP Password Storage Cheat Sheet (2024+) 建议 bcrypt cost ≥ 12。
 * 12 rounds 约耗时 250ms（取决于硬件），对登录/改密低频操作可接受，
 * 同时显著提升离线爆破难度（相比 10 rounds 提升约 4 倍）。
 */
const BCRYPT_ROUNDS = process.env['NODE_ENV'] === 'test' ? 4 : 12;

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

// ── 密码历史（NFR-SEC-15）──────────────────────────────────────────────────

/** 密码历史保留上限（禁止重用最近 N 次密码） */
export const PASSWORD_HISTORY_MAX = 5;

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
  // 并行比对历史 hash，提升性能（5次串行约 1.25s → 并行约 250ms）
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
 * @returns 更新后的历史数组（最新在前）
 */
export function pushPasswordHistory(
  prevHistory: string[] | null,
  oldHash: string,
): string[] {
  const next = prevHistory ? [oldHash, ...prevHistory] : [oldHash];
  return next.slice(0, PASSWORD_HISTORY_MAX);
}

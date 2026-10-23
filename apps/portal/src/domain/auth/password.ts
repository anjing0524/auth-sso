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

const DEFAULT_PASSWORD_CONFIG: PasswordConfig = {
  bcryptRounds: 12,
  passwordHistoryMax: 5,
};

export const PASSWORD_HISTORY_MAX = DEFAULT_PASSWORD_CONFIG.passwordHistoryMax;

/**
 * 用户不存在时用于**等价比对**的固定 bcrypt 目标哈希（成本 12，与生产一致）。
 *
 * 背景（H-04 用户枚举时延侧信道）：登录端点对不存在邮箱直接返回（≈4ms），
 * 对存在用户则执行真实 bcrypt（≈300ms），攻击者可据响应时延批量枚举有效账号。
 * 对未知用户也执行一次等成本比对即可抹平该差异；该哈希对应一个不可知的随机口令，
 * 比对必然失败，但耗时与真实路径同量级。
 */
export const DUMMY_PASSWORD_HASH =
  '$2b$12$riU0a2eUajaOnGBVnbYy1O8mBxkJkffIAej.M3ni9KckH4NZQ7l66';

/** 对**不存在的用户**执行与真实密码校验等成本的 bcrypt 比对（恒失败，仅用于消除时延差） */
export async function verifyPasswordForUnknownUser(plaintext: string): Promise<void> {
  await bcrypt.compare(plaintext, DUMMY_PASSWORD_HASH);
}

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

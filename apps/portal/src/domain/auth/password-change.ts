/**
 * 自助改密领域判定 (Self-service Password Change)
 *
 * 纯业务规则：**不含任何 DB 查询、bcrypt 异步调用或基础设施依赖**。
 * 与 `domain/auth/login.ts` 同构——bcrypt 比对/哈希、持久化与会话撤销
 * 由 `lib/account/change-password.ts` 编排。
 *
 * 存在的理由（ADR-019）：`changeOwnPassword` 原先作为步骤序列内联在
 * Server Action 里（物理 45 行），使 Controller 承担了领域判定。
 * 命名这个操作后，"改密"有了唯一可命名、可单测的规则所在。
 *
 * @module domain/auth/password-change
 */
import { BusinessRuleViolationError } from '@/domain/shared/errors';
import { pushPasswordHistory, type PasswordConfig } from './password';

/** 改密涉及的密码状态（仅取判定真正读到的字段） */
export interface PasswordChangeState {
  /** 当前密码哈希（null = 账号未设置密码，无法自助改密） */
  readonly currentHash: string | null;
  /** 密码历史（倒序，用于禁止重用） */
  readonly history: readonly string[] | null;
}

/** 改密的两个输入 */
export interface PasswordChangeInput {
  readonly newPassword: string;
  /**
   * 新密码是否命中近期历史（由 `isPasswordReused` 在 **bcrypt 层**判定后传入）。
   *
   * 之所以把它作为入参而非在此处调用：`isPasswordReused` 是异步 bcrypt 比对，
   * 而本模块是同步纯函数。判定与 I/O 的分工见文件头。
   */
  readonly reusesRecentPassword: boolean;
}

/**
 * 纯判定：当前状态下是否允许自助改密。
 *
 * @throws BusinessRuleViolationError 未设置密码 / 新密码与近期历史重复
 */
export function assertPasswordChangeAllowed(
  state: PasswordChangeState,
  input: PasswordChangeInput,
): void {
  if (!state.currentHash) {
    // 无密码的账号不能自助改密（应走管理员重置流程）
    throw new BusinessRuleViolationError('账号未设置密码，无法自助改密');
  }
  if (input.reusesRecentPassword) {
    throw new BusinessRuleViolationError('新密码不能与最近使用过的密码相同');
  }
}

/**
 * 计算改密后应写入的密码历史（旧哈希入列，按上限截断）。
 *
 * @throws BusinessRuleViolationError 未设置密码（与 {@link assertPasswordChangeAllowed} 同判据）
 */
export function nextPasswordHistory(
  state: PasswordChangeState,
  config?: PasswordConfig,
): string[] {
  if (!state.currentHash) {
    throw new BusinessRuleViolationError('账号未设置密码，无法自助改密');
  }
  return pushPasswordHistory(state.history ? [...state.history] : null, state.currentHash, config);
}

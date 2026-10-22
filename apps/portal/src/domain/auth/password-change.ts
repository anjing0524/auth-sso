/**
 * 自助改密领域判定 (Self-service Password Change)
 *
 * 纯业务规则：**不含任何 DB 查询、bcrypt 异步调用或基础设施依赖**。
 * 与 `domain/auth/login.ts` 同构——bcrypt 比对/哈希、持久化与会话撤销
 * 由 `lib/account/change-password.ts` 编排。
 *
 * 存在的理由（ADR-014 的写路径门面之上）：`changeOwnPassword` 原先作为步骤序列内联在
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

/**
 * 密码复用判定的输入。
 *
 * 只有这一个字段：新密码的**复用判定**由 `isPasswordReused` 在 bcrypt 层完成
 * （本模块是同步纯函数，不碰 I/O），此处只接收结论。
 */
export interface PasswordChangeInput {
  readonly reusesRecentPassword: boolean;
}

/**
 * 规则 ①：**自助改密**的前置——账号必须已有密码。
 *
 * 无密码的账号不能自助改密（应走管理员重置流程），故这条规则只属于自助路径；
 * 管理员重置**必须允许**目标没有密码（那正是"为从未设密码的账号设初始密码"的场景）。
 *
 * ## 为什么把它与复用判定拆开（2026-10-13，架构评审 R2 次级候选「改密收成一个 module」）
 *
 * 原先两者合成 `assertPasswordChangeAllowed`，被两条路径**都**调用，于是：
 * - 自助路径：先 `verifyPassword(currentPassword, currentHash ?? '')`（空串哨兵）必返回 false，
 *   本条规则**永不可达**，且"没密码"被报成"当前密码错误"；
 * - 管理员路径：被套上自助路径的否决判据，**挡住了给无密码账号设初始密码**，
 *   错误信息还是"无法自助改密"。
 *
 * 现在两条路径各自组合需要的规则（判定一处、投递/组合各自）。
 *
 * ## 为什么是 `asserts` 断言函数
 *
 * 它把 `currentHash` 收窄为非空，使调用方**不再需要 `?? ''` 空串哨兵**
 * （ADR-016 明令禁止"用哨兵值掩盖字段可能不存在"这一形态）。
 *
 * @throws BusinessRuleViolationError 账号未设置密码
 */
export function assertHasPassword(
  state: PasswordChangeState,
): asserts state is PasswordChangeState & { currentHash: string } {
  if (!state.currentHash) {
    throw new BusinessRuleViolationError('账号未设置密码，无法自助改密');
  }
}

/**
 * 规则 ②：新密码不得命中近期历史（NFR-SEC-15）—— **自助改密与管理员重置共用**。
 *
 * @param reusesRecentPassword 由 `isPasswordReused`（bcrypt）判定后的结论
 * @throws BusinessRuleViolationError 新密码与最近使用过的密码相同
 */
export function assertPasswordNotReused(reusesRecentPassword: boolean): void {
  if (reusesRecentPassword) {
    throw new BusinessRuleViolationError('新密码不能与最近使用过的密码相同');
  }
}

/**
 * 计算改密后应写入的密码历史（旧哈希入列，按上限截断）。
 *
 * **无旧哈希时（账号首次设密码）历史原样保留**——那里没有"旧密码"可入列，
 * 故既不抛错也不写入空串哨兵（此前 REST 路由用 `pushPasswordHistory(history, hash ?? '')`
 * 把 `''` 当成旧哈希写进了 `password_history`）。
 */
export function nextPasswordHistory(
  state: PasswordChangeState,
  config?: PasswordConfig,
): string[] {
  if (!state.currentHash) {
    return state.history ? [...state.history] : [];
  }
  return pushPasswordHistory(state.history ? [...state.history] : null, state.currentHash, config);
}

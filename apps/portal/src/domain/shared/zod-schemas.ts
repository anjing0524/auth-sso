/**
 * Domain shared Zod schema constants (single export source).
 *
 * All Zod enum schemas are defined here.
 * Domain type files import from this module instead of defining their own.
 * The single source of truth for enum value arrays remains at auth-sso/contracts.
 *
 * v2 变更：
 * - permissionTypeEnum 更新为 DIRECTORY | PAGE | API | DATA
 * - 移除 menuTypeEnum（menus 已合并进 permissions）
 *
 * @module domain/shared/zod-schemas
 */
import { z } from 'zod';
import {
  USER_STATUS_VALUES,
  ENTITY_STATUS_VALUES,
  PERMISSION_TYPE_VALUES,
} from '@auth-sso/contracts';

/** User status Zod enum */
export const userStatusEnum = z.enum(USER_STATUS_VALUES);

/** Entity status Zod enum (shared by Department, Role, Permission, Client) */
export const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES);

/** Permission type Zod enum（DIRECTORY | PAGE | API | DATA） */
export const permissionTypeEnum = z.enum(PERMISSION_TYPE_VALUES);

/**
 * 密码复杂度策略 Schema（单一真相源 — NFR-SEC-05）
 *
 * 全系统所有密码输入（管理员重置、自助改密、API 重置）必须通过此 schema 校验，
 * 禁止在各调用点重复实现密码规则，避免策略漂移。
 *
 * 规则（与 API.md 1.4 节需求矩阵 B-USR-C 对齐）：
 *   - 至少 10 位（注：API 文档初次编写时定为 8 位，经安全评审后提升至 10 位）
 *   - 大写字母 / 小写字母 / 数字 / 特殊字符 中至少包含 3 类
 */
export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_REQUIRED_CATEGORIES = 3;

const PASSWORD_CATEGORY_REGEXES: readonly RegExp[] = [
  /[a-z]/,        // 小写字母
  /[A-Z]/,        // 大写字母
  /\d/,           // 数字
  /[^a-zA-Z\d]/,  // 特殊字符（非字母数字）
];

export const PasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, `密码至少 ${PASSWORD_MIN_LENGTH} 位`)
  .refine(
    (pw) => PASSWORD_CATEGORY_REGEXES.filter((re) => re.test(pw)).length >= PASSWORD_REQUIRED_CATEGORIES,
    '密码须包含大写字母、小写字母、数字、特殊字符中的至少三类',
  );

/** 解析密码并返回首个错误消息（null 表示通过） */
export function validatePassword(raw: string): string | null {
  const result = PasswordSchema.safeParse(raw);
  return result.success ? null : result.error.issues[0]?.message ?? '密码不合规';
}

/**
 * Domain shared Zod schema constants (single export source).
 *
 * All Zod enum schemas are defined here.
 * Domain type files import from this module instead of defining their own.
 * The single source of truth for enum value arrays remains at auth-sso/contracts.
 *
 * v2 变更：
 * - permissionTypeEnum 更新为 DIRECTORY | PAGE | API
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

/** Permission type Zod enum（DIRECTORY | PAGE | API） */
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
const PASSWORD_MIN_LENGTH = 10;
const PASSWORD_REQUIRED_CATEGORIES = 3;

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

/**
 * 身份标识规范化（H-18）：邮箱一律 `trim().toLowerCase()` 后再校验/落库。
 *
 * 为什么必须单点定义：登录查询、管理员创建/编辑、自助改资料、唯一索引四处若各写一遍，
 * 任何一处漏写都会制造"大小写不同的两条身份"（`Admin@x` 与 `admin@x` 都能注册，
 * 但只有其中一种拼写能登录）。DB 侧由 `ux_users_email_ci`（lower(email) 部分唯一索引）
 * 兜底，本 Schema 保证进入领域层的值已经规范化。
 */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

/** 归一化后的邮箱 Schema（所有用户可写邮箱字段的唯一入口） */
export const EmailSchema = z.preprocess(
  (value) => (typeof value === 'string' ? normalizeEmail(value) : value),
  z.string().email('邮箱格式不合法').max(255, '邮箱最多 255 个字符'),
);

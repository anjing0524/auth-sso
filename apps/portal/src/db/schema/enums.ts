/**
 * 枚举定义 (Enum Definitions)
 *
 * 严格对齐 @auth-sso/contracts，单一真相源 (single source of truth)。
 * contracts 中 VALUES 均为 `as const` 的 readonly tuple，可直接传给 pgEnum。
 *
 * v2 变更：
 * - permissionTypeEnum 值更新为 DIRECTORY | PAGE | API（合并旧 menu_type）
 * - 新增 loginEventEnum、auditOperationEnum（替代日志表裸 text）
 * - 移除 menuTypeEnum（menus 表已合并进 permissions）
 *
 * @module db/schema/enums
 */
import { pgEnum } from 'drizzle-orm/pg-core';
import {
  USER_STATUS_VALUES,
  ENTITY_STATUS_VALUES,
  PERMISSION_TYPE_VALUES,
  LOGIN_EVENT_VALUES,
  AUDIT_OPERATION_VALUES,
  CODE_CHALLENGE_METHODS_SUPPORTED,
} from '@auth-sso/contracts';

/** 用户状态枚举 */
export const userStatusEnum = pgEnum('user_status', USER_STATUS_VALUES);

/** 实体通用状态枚举（department/role/permission/client） */
export const entityStatusEnum = pgEnum('entity_status', ENTITY_STATUS_VALUES);

/** 权限类型枚举（DIRECTORY | PAGE | API，合并旧 menu_type） */
export const permissionTypeEnum = pgEnum('permission_type', PERMISSION_TYPE_VALUES);

/** 登录事件类型枚举（替代 login_logs 裸 text） */
export const loginEventEnum = pgEnum('login_event', LOGIN_EVENT_VALUES);

/** 审计操作类型枚举（替代 audit_logs 裸 text） */
export const auditOperationEnum = pgEnum('audit_operation', AUDIT_OPERATION_VALUES);

/** PKCE code_challenge_method 枚举 (RFC 7636) */
export const codeChallengeMethodEnum = pgEnum('code_challenge_method', CODE_CHALLENGE_METHODS_SUPPORTED as unknown as [string, ...string[]]);

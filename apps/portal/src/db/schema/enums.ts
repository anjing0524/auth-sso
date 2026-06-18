/**
 * 枚举定义 (Enum Definitions)
 *
 * 严格对齐 @auth-sso/contracts，单一真相源 (single source of truth)。
 * Drizzle pgEnum 要求字面量 tuple，这里通过 contracts 的 VALUES 数组派生，
 * 并保留编译期与 Domain 实体的双向守卫（见 ./index.ts）。
 *
 * @module db/schema/enums
 */
import { pgEnum } from 'drizzle-orm/pg-core';
import {
  USER_STATUS_VALUES,
  ENTITY_STATUS_VALUES,
  DATA_SCOPE_TYPE_VALUES,
  PERMISSION_TYPE_VALUES,
  MENU_TYPE_VALUES,
} from '@auth-sso/contracts';

/** 用户状态枚举 */
export const userStatusEnum = pgEnum('user_status', USER_STATUS_VALUES as unknown as [string, ...string[]]);

/** 实体通用状态枚举（client/role/permission/department/menu） */
export const entityStatusEnum = pgEnum('entity_status', ENTITY_STATUS_VALUES as unknown as [string, ...string[]]);

/** 角色数据范围类型枚举 */
export const dataScopeTypeEnum = pgEnum('data_scope_type', DATA_SCOPE_TYPE_VALUES as unknown as [string, ...string[]]);

/** 权限类型枚举 */
export const permissionTypeEnum = pgEnum('permission_type', PERMISSION_TYPE_VALUES as unknown as [string, ...string[]]);

/** 菜单类型枚举 */
export const menuTypeEnum = pgEnum('menu_type', MENU_TYPE_VALUES as unknown as [string, ...string[]]);

/** JWKS 签名算法枚举 */
export const jwkAlgorithmEnum = pgEnum('jwk_algorithm', ['ES256']);

/** PKCE code_challenge_method 枚举 (RFC 7636) */
export const codeChallengeMethodEnum = pgEnum('code_challenge_method', ['S256']);

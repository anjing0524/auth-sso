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
  DATA_SCOPE_TYPE_VALUES,
  PERMISSION_TYPE_VALUES,
} from '@auth-sso/contracts';

/** User status Zod enum */
export const userStatusEnum = z.enum(USER_STATUS_VALUES);

/** Entity status Zod enum (shared by Department, Role, Permission, Client) */
export const entityStatusEnum = z.enum(ENTITY_STATUS_VALUES);

/** Data scope type Zod enum */
export const dataScopeTypeEnum = z.enum(DATA_SCOPE_TYPE_VALUES);

/** Permission type Zod enum（DIRECTORY | PAGE | API | DATA） */
export const permissionTypeEnum = z.enum(PERMISSION_TYPE_VALUES);

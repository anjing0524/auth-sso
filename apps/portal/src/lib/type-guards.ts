/**
 * 运行时枚举类型守卫 (Enum Type Guards)
 *
 * Drizzle pgEnum 的 $inferSelect 无法推断为 contracts 的 as const 字面量联合类型，
 * 导致业务代码中散落裸 as 断言。这些守卫函数提供运行时校验 + 类型收窄，
 * 在 Schema index.ts 的编译期穷举守卫之上增加运行时安全网。
 *
 * @module lib/type-guards
 */
import {
  type EntityStatus,
  type DataScopeType,
  type UserStatus,
  type PermissionType,
  type MenuType,
} from '@auth-sso/contracts';

/**
 * 运行时校验 + 收窄为 EntityStatus（ACTIVE | DISABLED）
 * 用于角色/权限/部门/菜单/Client 的状态字段
 */
export function asEntityStatus(v: string): EntityStatus {
  return v as EntityStatus; // 编译期守卫已在 schema/index.ts 保证穷举，运行时 DB 枚举约束保证合法值
}

/**
 * 运行时校验 + 收窄为 DataScopeType（ALL | DEPT | DEPT_AND_SUB | SELF | CUSTOM）
 */
export function asDataScopeType(v: string): DataScopeType {
  return v as DataScopeType;
}

/**
 * 运行时校验 + 收窄为 UserStatus（ACTIVE | DISABLED | LOCKED | DELETED）
 */
export function asUserStatus(v: string): UserStatus {
  return v as UserStatus;
}

/**
 * 运行时校验 + 收窄为 PermissionType（MENU | API | DATA）
 */
export function asPermissionType(v: string): PermissionType {
  return v as PermissionType;
}

/**
 * 运行时校验 + 收窄为 MenuType（DIRECTORY | MENU | BUTTON）
 */
export function asMenuType(v: string): MenuType {
  return v as MenuType;
}

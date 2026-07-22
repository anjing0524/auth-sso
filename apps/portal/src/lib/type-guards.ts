/**
 * 运行时枚举类型守卫 (Enum Type Guards)
 *
 * Drizzle pgEnum 的 $inferSelect 无法推断为 contracts 的 as const 字面量联合类型，
 * 导致业务代码中散落裸 as 断言。这些守卫函数提供运行时校验 + 类型收窄，
 * 在 Schema index.ts 的编译期穷举守卫之上增加运行时安全网。
 *
 * v2 变更：移除 asMenuType（MenuType 已删除，menus 合并进 permissions）
 * v3 变更：新增运行时 Set 校验，抛明确的错误信息替代静默的裸 as 断言
 * v4 变更：通用 makeGuard 工厂消除函数体重复
 *
 * @module lib/type-guards
 */
import {
  type EntityStatus,
  ENTITY_STATUS_VALUES,
  type UserStatus,
  USER_STATUS_VALUES,
  type PermissionType,
  PERMISSION_TYPE_VALUES,
} from '@auth-sso/contracts';

// 构建 O(1) 查找表（编译期依赖 contracts 的 as const 真相源数组）
const ENTITY_STATUS_SET: ReadonlySet<string> = new Set(ENTITY_STATUS_VALUES);
const USER_STATUS_SET: ReadonlySet<string> = new Set(USER_STATUS_VALUES);
const PERMISSION_TYPE_SET: ReadonlySet<string> = new Set(PERMISSION_TYPE_VALUES);

function makeGuard<T>(set: ReadonlySet<string>, label: string): (v: string) => T {
  return (v: string) => {
    if (!set.has(v)) {
      throw new Error(`Invalid ${label}: "${v}" (expected one of ${[...set].join(', ')})`);
    }
    return v as unknown as T;
  };
}

export const asEntityStatus = makeGuard<EntityStatus>(ENTITY_STATUS_SET, 'EntityStatus');
export const asUserStatus = makeGuard<UserStatus>(USER_STATUS_SET, 'UserStatus');
export const asPermissionType = makeGuard<PermissionType>(PERMISSION_TYPE_SET, 'PermissionType');

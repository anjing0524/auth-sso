/**
 * Drizzle Schema Barrel (聚合导出)
 *
 * 按 Drizzle 官方推荐拆分独立表到领域文件，统一从此处聚合导出。
 * drizzle.config.ts 通过 glob './src/db/schema/*.ts' 自动发现。
 *
 * v2 变更：
 * - 移除 menus、consents 导出
 * - 更新类型守卫以对齐新的 schema 类型
 *
 * @module db/schema
 */

// 枚举
export * from './enums';

// 领域表
export * from './users';
export * from './auth';
export * from './rbac';
export * from './org';
export * from './logs';

// Relations（启用 db.query.* 声明式关系查询）
export * from './relations';

// ============================================
// 编译期类型同步守卫 (Domain ↔ Drizzle 不漂移)
// ============================================
import type { User } from '@/domain/user/types';
import type { EntityStatus, DataScopeType, PermissionType } from '@auth-sso/contracts';
import type { Department } from '@/domain/department/types';
import type { Role } from '@/domain/role/types';
import type { Permission } from '@/domain/permission/types';
import type { Client } from '@/domain/client/types';
import type { users, departments, roles, permissions, clients } from './';

type UserRow = typeof users.$inferSelect;
type DeptRow = typeof departments.$inferSelect;
type RoleRow = typeof roles.$inferSelect;
type PermRow = typeof permissions.$inferSelect;
type ClientRow = typeof clients.$inferSelect;

// 守卫：Drizzle 行类型必须兼容 Domain 实体
type _UserRowCompatible = UserRow extends Omit<User, 'deptName' | 'createdAt'> ? true : never;
type _DeptRowCompatible = DeptRow extends Omit<Department, 'createdAt'> ? true : never;
type _RoleRowCompatible = RoleRow extends Omit<Role, 'createdAt'> ? true : never;
type _PermRowCompatible = PermRow extends Omit<Permission, 'createdAt'> ? true : never;
type _ClientRowCompatible = ClientRow extends Omit<Client, 'createdAt'> ? true : never;

// 守卫：枚举取值双向穷举
type _UserStatusInRow = UserRow['status'] extends import('@auth-sso/contracts').UserStatus ? true : never;
type _UserStatusInDomain = import('@auth-sso/contracts').UserStatus extends UserRow['status'] ? true : never;
type _DeptStatusInRow = DeptRow['status'] extends EntityStatus ? true : never;
type _DeptStatusInDomain = EntityStatus extends DeptRow['status'] ? true : never;
type _RoleStatusInRow = RoleRow['status'] extends EntityStatus ? true : never;
type _RoleStatusInDomain = EntityStatus extends RoleRow['status'] ? true : never;
type _RoleScopeInRow = RoleRow['dataScopeType'] extends DataScopeType ? true : never;
type _RoleScopeInDomain = DataScopeType extends RoleRow['dataScopeType'] ? true : never;
type _PermStatusInRow = PermRow['status'] extends EntityStatus ? true : never;
type _PermStatusInDomain = EntityStatus extends PermRow['status'] ? true : never;
type _PermTypeInRow = PermRow['type'] extends PermissionType ? true : never;
type _PermTypeInDomain = PermissionType extends PermRow['type'] ? true : never;
type _ClientStatusInRow = ClientRow['status'] extends EntityStatus ? true : never;
type _ClientStatusInDomain = EntityStatus extends ClientRow['status'] ? true : never;

/**
 * 授权判定 (Authorization Decisions)
 *
 * 本模块是"主体是否可执行某操作"的**唯一判定实现**，供 Portal 服务端与客户端
 * 共享。设计依据见 ADR-015。
 *
 * ## 为什么需要它
 *
 * 这条规则曾被实现七次、散落七处，且**每条规则都被同时写在服务端与客户端**：
 *
 * | 位置 | 形态 |
 * |---|---|
 * | `lib/auth/check-permission.ts:73` | `roles.some(rc => ADMIN_ROLE_CODES.includes(rc))` |
 * | `hooks/use-permissions.ts:64` | 同规则，但传入 `r.code` |
 * | `app/api/me/route.ts:37` | 同规则，第三份拷贝 |
 * | `app/(dashboard)/layout.tsx:31` | 同规则，第四份拷贝 |
 * | `app/profile/ProfileClient.tsx:271` | 同规则，第五份拷贝 |
 * | `domain/auth/oauth-authorize.ts:41` | `new Set(ADMIN_ROLE_CODES)`，第六份 |
 * | `lib/menu-tree.ts:52` | 内联 `!code \|\| isAdmin \|\| includes(code)`，第七份 |
 *
 * 服务端的 `checkList`（`requireAll` 语义）与客户端的 `hasPermission`/`hasRole`
 * 是**同一套语义的两份独立实现**，任何一处偏离都会表现为"按钮能点但提交 403"
 * 或"菜单可见但页面 403"。
 *
 * ## 放在 contracts 的理由
 *
 * - 客户端与服务端必须共享这层判定，而 `apps/portal/src/domain/**` 服务端专用
 *   （`server-only` 边界），不能跨到客户端。
 * - `packages/contracts` 已零依赖、纯 TS、无 `node:*`/`server-only`，客户端可安全导入，
 *   且它已经是 `ADMIN_ROLE_CODES` 等判定输入的单一真相源——规则与规则输入同处一包。
 *
 * ## 本模块不做的事
 *
 * 不查库、不读缓存、不抛错、不映射 HTTP 状态码。**取数**（权限上下文的读取与降级）
 * 与**判定**（本模块）是两个 seam：前者的失效语义见 ADR-011，后者是纯函数。
 *
 * @module authorization
 */
import { ADMIN_ROLE_CODES } from './admin-roles';

/** 判定所需的主体属性（只取判定真正读到的字段） */
export interface AuthorizationSubject {
  /** 主体拥有的角色编码（**应为 ACTIVE 角色**——状态过滤是取数层的职责） */
  readonly roleCodes: readonly string[];
  /** 主体拥有的权限编码 */
  readonly permissionCodes: readonly string[];
}

/** 系统管理员角色集合。集合查找优于数组 `includes`，且避免每处调用重复构造。 */
const ADMIN_ROLE_SET: ReadonlySet<string> = new Set<string>(ADMIN_ROLE_CODES);

/**
 * 是否系统管理员。
 *
 * 管理员在 Portal 内**绕过权限码检查**（角色仍可被单独要求，见 {@link hasRole}）。
 * 这是 ADR-001 的既有语义：`ADMIN_ROLE_CODES` 是系统预置角色。
 */
export function isAdminRole(roleCodes: readonly string[]): boolean {
  return roleCodes.some((code) => ADMIN_ROLE_SET.has(code));
}

/** 主体是否拥有指定权限码 */
export function hasPermissionCode(subject: AuthorizationSubject, code: string): boolean {
  return subject.permissionCodes.includes(code);
}

/**
 * 主体是否可执行需要该权限码的操作 —— **单条权限规则的唯一实现**。
 *
 * 管理员恒通过；否则看权限码。服务端 `checkPermission` 与客户端 `hasPermission`
 * 都必须委托本函数，不得各自内联。
 */
export function can(subject: AuthorizationSubject, requiredPermission: string): boolean {
  return isAdminRole(subject.roleCodes) || hasPermissionCode(subject, requiredPermission);
}

/**
 * 主体是否拥有指定角色编码（**不因管理员而恒真**）。
 *
 * 与 {@link can} 的区别是有意的：管理员绕过的是**权限**，不是角色归属。
 * 需要"必须是某角色"的场景（如仅审核员可复核）应使用本函数。
 */
export function hasRole(subject: AuthorizationSubject, code: string): boolean {
  return subject.roleCodes.includes(code);
}

/** 主体是否满足**任一**所需权限（空需求视为通过） */
export function canAny(subject: AuthorizationSubject, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  if (isAdminRole(subject.roleCodes)) return true;
  return required.some((code) => subject.permissionCodes.includes(code));
}

/** 主体是否满足**全部**所需权限（空需求视为通过） */
export function canAll(subject: AuthorizationSubject, required: readonly string[]): boolean {
  if (required.length === 0) return true;
  if (isAdminRole(subject.roleCodes)) return true;
  return required.every((code) => subject.permissionCodes.includes(code));
}

/**
 * 系统预置角色编码 (System Role Codes)
 *
 * 单独成文件而非放在 `index.ts`：`authorization.ts` 需要它来做管理员判定，
 * 而 `index.ts` 又 re-export `authorization.ts` —— 若常量留在 `index.ts`，
 * 三者形成循环依赖，正确性会依赖模块求值顺序这种脆弱性质。
 * 独立模块使依赖图无环：`admin-roles` ← `authorization` ← `index`。
 *
 * @module admin-roles
 */

/** 系统管理员角色编码集合（硬编码业务常量，ADR-001 既有语义） */
export const ADMIN_ROLE_CODES = ['SUPER_ADMIN', 'ADMIN'] as const;

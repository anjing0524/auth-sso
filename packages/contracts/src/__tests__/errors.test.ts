import { describe, expect, it } from 'vitest';
import {
  AUTH_ERRORS,
  CLIENT_ERRORS,
  COMMON_ERRORS,
  DEPARTMENT_ERRORS,
  ERROR_CODE_VALUES,
  PERMISSION_ERRORS,
  ROLE_ERRORS,
  USER_ERRORS,
  type ErrorCode,
} from '../errors';

/**
 * 错误码词汇表：**闭合类型** + 值不变量
 *
 * 本文件同时是「词汇表真的闭起来了吗」的守卫：文件末尾的类型层断言若失效
 * （`ErrorCode` 退化成 `string`/`any`），`@ts-expect-error` 会变成"未使用" ⇒ **tsc 报错**。
 *
 * ⚠️ 这条守卫**依赖本包的 `tsconfig.json` 把 `src/__tests__` 纳入编译**
 * （2026-10-14 修复 #77 之前它被 `exclude` 掉，于是放在这里的 `@ts-expect-error`
 * **根本不被检查**——实测退化成 `string` 后 `tsc --noEmit` 仍通过，守卫成了装饰）。
 * **不要**再把 `src/__tests__` 加回 `exclude`，否则本守卫会静默失效。
 */
describe('错误码词汇表', () => {
  it('覆盖全部 7 个分组、与分组派生一致、且无重复', () => {
    const groups = [
      COMMON_ERRORS,
      AUTH_ERRORS,
      USER_ERRORS,
      DEPARTMENT_ERRORS,
      ROLE_ERRORS,
      PERMISSION_ERRORS,
      CLIENT_ERRORS,
    ];
    const all = groups.flatMap((g) => Object.values(g));

    expect(ERROR_CODE_VALUES).toHaveLength(all.length);
    // 重复值会让"同一码两种含义"静默成立
    expect(new Set(ERROR_CODE_VALUES).size).toBe(all.length);
    expect([...ERROR_CODE_VALUES].sort()).toEqual([...all].sort());
  });

  it('全部码形如 AUTH_SSO_<4 位数字>', () => {
    for (const code of ERROR_CODE_VALUES) {
      expect(code).toMatch(/^AUTH_SSO_\d{4}$/);
    }
  });

  it('`INVALID_SCOPE` 已进入词汇表（曾以裸字面量上网）', () => {
    expect(AUTH_ERRORS.INVALID_SCOPE).toBe('AUTH_SSO_2037');
    expect(ERROR_CODE_VALUES as readonly string[]).toContain('AUTH_SSO_2037');
  });

  it('词汇表不含 `INVALID_SCOPE`（它已被 `AUTH_SSO_2037` 取代）', () => {
    expect(ERROR_CODE_VALUES as readonly string[]).not.toContain('INVALID_SCOPE');
  });
});

// ── 类型层断言：词汇表是闭合的 ──
//
// 若 `ErrorCode` 退化为 `string`/`any`，下面这行的 `@ts-expect-error` 会变成
// "未使用"指令 ⇒ tsc 报错 ⇒ **保护失效立刻可见**（而不是静默失去保护）。
// 这要求本包 typecheck 覆盖 `src/__tests__`——见文件头说明。
// @ts-expect-error 'INVALID_SCOPE' 不在词汇表内
const NOT_A_CODE: ErrorCode = 'INVALID_SCOPE';

describe('词汇表外的码不是 ErrorCode', () => {
  it('运行时它当然仍是字符串——这条断言的作用是让类型层指令必须有意义', () => {
    expect(NOT_A_CODE).toBe('INVALID_SCOPE');
  });
});

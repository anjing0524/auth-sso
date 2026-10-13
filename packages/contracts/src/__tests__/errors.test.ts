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
} from '../errors';

/**
 * 错误码词汇表：**值不变量**
 *
 * ⚠️ 类型层守卫（"词汇表外的码不是 `ErrorCode`"）**不在本文件**：本包的 `tsconfig.json`
 * 把 `src/__tests__` 排除在 typecheck 之外，放这里的 `@ts-expect-error` 根本不会被检查
 * ——实测把 `ErrorCode` 退化成 `string` 后 `tsc --noEmit` 仍通过（**守卫成了装饰**）。
 * 类型层断言因此放在 portal 侧真正被 typecheck 覆盖的测试里
 * （`apps/portal/src/domain/shared/__tests__/shared-kernel.test.ts`）。
 * 「contracts 的测试不被类型检查」这一既有缺口另记 issue。
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

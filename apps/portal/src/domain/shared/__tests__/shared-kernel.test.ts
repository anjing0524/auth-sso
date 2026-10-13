/**
 * Shared Kernel 测试 — error-mapping + zod-schemas
 *
 * @req R5
 * @req R7
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { mapDomainError } from '@/domain/shared/error-mapping';
import { validatePassword } from '@/domain/shared/zod-schemas';
import { AUTH_ERRORS, type ErrorCode } from '@auth-sso/contracts';
import {
  EntityNotFoundError,
  ForbiddenError,
  InvalidCredentialsError,
  AccountStatusError,
  DuplicateEntityError,
  InvalidClientError,
  BusinessRuleViolationError,
} from '@/domain/shared/errors';

describe('mapDomainError', () => {
  it('EntityNotFoundError → 404', () => {
    const r = mapDomainError(new EntityNotFoundError('用户', 'u1'));
    expect(r.status).toBe(404);
  });

  it('ForbiddenError → 403', () => {
    const r = mapDomainError(new ForbiddenError('无权操作'));
    expect(r.status).toBe(403);
  });

  it('InvalidCredentialsError → 401', () => {
    const r = mapDomainError(new InvalidCredentialsError('密码错误'));
    expect(r.status).toBe(401);
  });

  it('AccountStatusError → 403，且错误码原样流出（必须是**词汇表内的码**）', () => {
    // 2026-10-13 更正（架构评审 R2 次级候选「错误码词汇表」）：此前这里传的是
    // `'DISABLED'` —— 一个**账号状态值**，不是错误码；断言只查 status，于是
    // "错误码可以是任意字符串"这个洞被反向固化。现在 `AccountStatusError`
    // 的 code 键入 contracts 的 `ErrorCode`，传状态值会**编译失败**。
    const r = mapDomainError(new AccountStatusError(AUTH_ERRORS.ACCOUNT_DISABLED, '账号已禁用'));
    expect(r.status).toBe(403);
    expect(r.error).toBe(AUTH_ERRORS.ACCOUNT_DISABLED);
  });

  it('DuplicateEntityError → 409', () => {
    const r = mapDomainError(new DuplicateEntityError('用户', 'username'));
    expect(r.status).toBe(409);
  });

  it('InvalidClientError → 401', () => {
    const r = mapDomainError(new InvalidClientError('未知客户端'));
    expect(r.status).toBe(401);
  });

  it('BusinessRuleViolationError → 422', () => {
    const r = mapDomainError(new BusinessRuleViolationError('规则违反'));
    expect(r.status).toBe(422);
  });

  it('未知 Error → 500', () => {
    const r = mapDomainError(new Error('unknown'));
    expect(r.status).toBe(500);
  });

  it('非 Error 对象 → 500', () => {
    const r = mapDomainError('plain string');
    expect(r.status).toBe(500);
  });
});

// ── 类型层断言：错误码词汇表是**闭合**的 ──
//
// 放在 portal 而非 contracts：本包的 tsconfig 包含测试文件，会真正跑这条断言；
// contracts 的 tsconfig 排除 `src/__tests__`，放那里的 `@ts-expect-error` 不被检查
// （实测：把 `ErrorCode` 退化成 `string` 后 tsc 仍通过 ⇒ 守卫成了装饰）。
//
// 语义：`ErrorCode` 闭合时下一行**必须**报错（指令被消费）；若它退化成 `string`/`any`，
// 该行合法 ⇒ `@ts-expect-error` 变成"未使用" ⇒ **tsc 报错** ⇒ 保护失效立刻可见。
// `INVALID_SCOPE` 正是修复前 `InvalidScopeError` 直接送上网的那个码。
// @ts-expect-error 'INVALID_SCOPE' 不在词汇表内
const NOT_A_CODE: ErrorCode = 'INVALID_SCOPE';

describe('错误码词汇表', () => {
  it('**词汇表外的码不是 ErrorCode**（类型层断言见上方）', () => {
    // 运行时它当然仍是字符串——这条断言的作用是让类型层指令必须有意义
    expect(NOT_A_CODE).toBe('INVALID_SCOPE');
  });
});

describe('validatePassword', () => {
  it('≥10 位 + 3 类字符 → 通过', () => {
    expect(validatePassword('StrongP@ss1')).toBeNull();
    expect(validatePassword('ABCDefgh123456')).toBeNull();
    expect(validatePassword('a1!a1!a1!a1!')).toBeNull();
  });

  it('<10 位 → 返回错误', () => {
    const err = validatePassword('Short1!');
    expect(err).not.toBeNull();
    expect(err).toContain('至少');
  });

  it('仅 2 类字符（缺特殊字符）→ 返回错误', () => {
    const err = validatePassword('onlylettersandn124');
    expect(err).not.toBeNull();
    expect(err).toContain('三类');
  });

  it('仅 1 类字符（纯数字）→ 返回错误', () => {
    const err = validatePassword('123456789012345');
    expect(err).not.toBeNull();
  });
});

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
import { AUTH_ERRORS } from '@auth-sso/contracts';
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

// 注：错误码词汇表的**类型层守卫**已移回它的自然归属
// `packages/contracts/src/__tests__/errors.test.ts`——#77 修复后该包的 typecheck
// 已覆盖 `src/__tests__`，`@ts-expect-error` 在那儿会被真正检查。
// 本文件只保留"消费方能把词汇表用作类型"的正向证据（见下方 AccountStatusError 用例）。

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

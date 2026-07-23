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

  it('AccountStatusError → 403', () => {
    const r = mapDomainError(new AccountStatusError('DISABLED', '账号已禁用'));
    expect(r.status).toBe(403);
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

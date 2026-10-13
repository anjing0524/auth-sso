import { describe, expect, it } from 'vitest';
import { uniqueViolation } from './db-errors';

/**
 * `uniqueViolation` 单元测试 —— 只测**识别**，不碰数据库。
 *
 * 真实 PG 违例的形状由 `__tests__/api/db-unique-violation.test.ts` 用真库钉住；
 * 这里补的是一批真库**难以构造**的边界：自引用 cause、超深链、detail 缺失、
 * 非字符串 detail，以及"值绝不外泄"这条不变量。
 */
describe('uniqueViolation', () => {
  /** Drizzle 的包装形态：顶层无 code，真正错误在 cause 上 */
  const wrapped = (inner: unknown) => ({
    name: 'DrizzleQueryError',
    query: 'insert into "departments" ...',
    params: ['DUP'],
    cause: inner,
  });

  it('识别经 cause 链包装的 23505（顶层没有 code）', () => {
    const err = wrapped({
      name: 'PostgresError',
      code: '23505',
      severity: 'ERROR',
      table_name: 'departments',
      constraint_name: 'departments_code_key',
      detail: 'Key (code)=(DUP) already exists.',
    });

    expect(uniqueViolation(err)).toEqual({ table: 'departments', columns: ['code'] });
  });

  it('多列唯一约束解析出全部列名', () => {
    const err = wrapped({
      code: '23505',
      table_name: 'role_permissions',
      detail: 'Key (role_id, permission_id)=(r1, p1) already exists.',
    });

    expect(uniqueViolation(err)?.columns).toEqual(['role_id', 'permission_id']);
  });

  it('**绝不返回冲突值**（只取列名）', () => {
    const secret = 'someone-else@example.com';
    const err = wrapped({
      code: '23505',
      table_name: 'users',
      detail: `Key (email)=(${secret}) already exists.`,
    });

    const result = uniqueViolation(err);
    expect(result?.columns).toEqual(['email']);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it('非唯一违例（23502 not-null）返回 null —— 不得把一切 DB 错误都说成冲突', () => {
    const err = wrapped({ code: '23502', table_name: 'users', column_name: 'name' });

    expect(uniqueViolation(err)).toBeNull();
  });

  it('23503 外键违例返回 null', () => {
    expect(uniqueViolation(wrapped({ code: '23503', table_name: 'users' }))).toBeNull();
  });

  it('detail 缺失或非字符串时仍识别，columns 为空', () => {
    expect(uniqueViolation(wrapped({ code: '23505', table_name: 'users' }))).toEqual({
      table: 'users',
      columns: [],
    });
    expect(uniqueViolation(wrapped({ code: '23505', detail: 42 }))).toEqual({
      table: null,
      columns: [],
    });
  });

  it('自引用 cause 不会死循环', () => {
    const selfRef: Record<string, unknown> = { code: 'XX000' };
    selfRef['cause'] = selfRef;

    expect(uniqueViolation(selfRef)).toBeNull();
  });

  it('超过追溯深度返回 null', () => {
    let node: unknown = { code: '23505', table_name: 'deep' };
    for (let i = 0; i < 6; i++) node = { cause: node };

    expect(uniqueViolation(node)).toBeNull();
  });

  it('非对象、null、undefined 一律返回 null', () => {
    expect(uniqueViolation(null)).toBeNull();
    expect(uniqueViolation(undefined)).toBeNull();
    expect(uniqueViolation('boom')).toBeNull();
    expect(uniqueViolation(new Error('plain'))).toBeNull();
  });

  it('顶层就是 23505 时无需包装也能识别', () => {
    expect(
      uniqueViolation({ code: '23505', table_name: 'roles', detail: 'Key (code)=(X) already exists.' }),
    ).toEqual({ table: 'roles', columns: ['code'] });
  });
});

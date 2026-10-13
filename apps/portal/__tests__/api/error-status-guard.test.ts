/**
 * `ERROR_STATUS` 必须与 `DomainError` 子类**双向一致**
 *
 * ## 为什么要这条守卫
 *
 * `mapDomainError` 用**类名**查表：`ERROR_STATUS[err.constructor.name] ?? 400`。
 * 表是 `Record<string, number>`，于是两种漂移都**静默**发生：
 *
 * - 新增一个 `DomainError` 子类却忘了登记 → 它的所有错误都变成 **400**（而不是 404/409/422）；
 * - 表里键名写错（如 `ForbidenError`）→ 对应子类永远命中不到兜底值，同样静默。
 *
 * 键名是**类名**而非词汇表码（两个子类可以共用同一码却映射不同状态：
 * `DuplicateEntityError` → 409 与 `BusinessRuleViolationError` → 422 都带 `VALIDATION_ERROR`），
 * 所以这条不变量只能靠**源码集合比对**来钉，而不是靠类型。
 *
 * @req R5
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DOMAIN_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/domain/shared');

/** `errors.ts` 里所有 `export class X extends DomainError` 的类名 */
export function parseDomainErrorNames(source: string): string[] {
  return [...source.matchAll(/export class (\w+) extends DomainError/g)].map((m) => m[1]!);
}

/** `error-mapping.ts` 里 `ERROR_STATUS` 字面量的键 */
export function parseErrorStatusKeys(source: string): string[] {
  const block = /const ERROR_STATUS[^=]*=\s*\{([\s\S]*?)\n\};/.exec(source);
  if (!block) return [];
  return [...block[1]!.matchAll(/^\s*(\w+):/gm)].map((m) => m[1]!);
}

describe('ERROR_STATUS ↔ DomainError 子类', () => {
  it('两个集合完全一致（不漏登记、不写错键名）', () => {
    const classes = parseDomainErrorNames(readFileSync(join(DOMAIN_DIR, 'errors.ts'), 'utf-8'));
    const keys = parseErrorStatusKeys(readFileSync(join(DOMAIN_DIR, 'error-mapping.ts'), 'utf-8'));

    expect(classes.length).toBeGreaterThanOrEqual(10);
    expect(keys.sort()).toEqual(classes.sort());
  });

  it('解析器自身不是空洞的：能抓漏登记与拼错键名', () => {
    const errorsSrc = `
export class FooError extends DomainError {}
export class BarError extends DomainError {}
`;
    expect(parseDomainErrorNames(errorsSrc)).toEqual(['FooError', 'BarError']);

    // 漏登记 BarError（末尾注释里的键不得被当成键）
    const missing = `
const ERROR_STATUS: Record<string, number> = {
  FooError: 404,
  // BarError: 409,
};
`;
    expect(parseErrorStatusKeys(missing)).toEqual(['FooError']);

    // 拼错键名
    const typo = `
const ERROR_STATUS: Record<string, number> = {
  FooError: 404,
  BarrError: 409,
};
`;
    expect(parseErrorStatusKeys(typo).sort()).not.toEqual(['BarError', 'FooError'].sort());
  });
});

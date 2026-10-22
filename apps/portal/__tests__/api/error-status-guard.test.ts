/**
 * 领域错误 → HTTP 状态的**生产可复现**守卫
 *
 * ## 为什么不再按类名查表（2026-10-21 生产实测）
 *
 * 旧实现 `ERROR_STATUS[err.constructor.name] ?? 400` 在源码测试里是对的，
 * 但 Turbopack 生产构建会把类名压缩（`ForbiddenError` → 单字母）⇒ 查表全部落空，
 * 403/404/409/422 **一律退化为 400**。实机证据：受限用户调用 `/api/roles`
 * 返回 `400 {"error":"AUTH_SSO_1003","message":"权限不足"}`（应为 403）。
 *
 * 现在状态码是 `DomainError` 的实例字段（`status`），`mapDomainError` 直接读取；
 * 每个子类在 `super()` 里显式声明状态码。本测试钉住：
 * 1. `mapDomainError` 不得再依赖 `constructor.name` 查表；
 * 2. 每个 `extends DomainError` 的子类都在 `super(...)` 第三个参数里显式给出状态码。
 *
 * @req R5
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { REPO_ROOT } from '../helpers/repo-scan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const DOMAIN_DIR = join(REPO_ROOT, 'apps/portal/src/domain/shared');

/** errors.ts 里每个子类的 `super(...)` 参数（去掉注释后按 class 切块） */
function parseSubclassSupers(source: string): Array<{ name: string; superArgs: string }> {
  const clean = source.replace(/\/\*[\s\S]*?\*\//g, '');
  const blocks = clean.split(/export class /).slice(1);
  return blocks
    .map((raw) => {
      const name = /^(\w+) extends DomainError/.exec(raw)?.[1];
      const superMatch = /super\(([\s\S]*?)\);/.exec(raw);
      return name ? { name, superArgs: superMatch?.[1]?.trim() ?? '' } : null;
    })
    .filter((item): item is { name: string; superArgs: string } => item !== null);
}

describe('领域错误状态码（压缩安全）', () => {
  it('mapDomainError 读取实例 status，不再按类名查表', () => {
    const mapping = readFileSync(join(DOMAIN_DIR, 'error-mapping.ts'), 'utf-8');
    expect(mapping).toMatch(/err\.status/);
    expect(mapping).not.toMatch(/constructor\.name/);
    expect(mapping).not.toMatch(/ERROR_STATUS/);
  });

  it('每个子类都在 super() 第三参数显式声明 HTTP 状态码', () => {
    const classes = parseSubclassSupers(readFileSync(join(DOMAIN_DIR, 'errors.ts'), 'utf-8'));
    expect(classes.length).toBeGreaterThanOrEqual(10);
    const missing = classes
      .filter(({ name, superArgs }) => !/,\s*[1-5]\d\d\s*$/.test(superArgs))
      .map(({ name }) => name);
    expect(missing, `缺少显式状态码的子类：${missing.join(', ')}`).toEqual([]);
  });
});

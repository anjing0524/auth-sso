import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AUDIT_OPERATION_VALUES, RESERVED_AUDIT_OPERATIONS } from '../index';

/**
 * 审计操作的"声明 ↔ 发射"守卫
 *
 * ## 为什么需要它
 *
 * `AUDIT_OPERATION_VALUES` 里曾有（现在仍有）**已声明、无发射点**的值。契约不标注时，
 * 后人与守卫都无法区分"有意的预留"与"漏了发射" —— 2026-10-16 核实历史决策时，
 * `ROLE_PERMISSION_ASSIGN` 这个未标注的预留值就被误读成一处审计缺口。
 *
 * 本守卫把区分变成可执行的规则（双向）：
 *   ① 每个声明值**要么**在 `apps/portal/src` 被引用、**要么**列在 `RESERVED_AUDIT_OPERATIONS`；
 *   ② 列在保留清单里的值**不得**已被引用（否则标记过期，应移除）。
 */

/** 四个分区由 (是否被引用, 是否声明为保留) 决定；只有两种组合合法 */
function classify(referenced: boolean, reserved: boolean): 'emitted' | 'reserved' | 'gap' | 'stale-reservation' {
  if (referenced && reserved) return 'stale-reservation';
  if (reserved) return 'reserved';
  if (referenced) return 'emitted';
  return 'gap';
}

/**
 * 生产代码视图：跳过测试文件，并**去掉注释**。
 *
 * 为什么必须去注释（2026-10-16 两轴评审发现）：原实现直接 `src.includes(op)` 全量匹配，
 * 于是**一行注释**提到 `ROLE_PERMISSION_ASSIGN` 就会被判成"已被引用"（假红）；
 * 反方向则是把"注释里的提及"算成"已发射"（假绿）。
 * 这与网关头守卫（`gateway-header-emission.test.ts`）的"提及 ≠ 消费"口径必须一致 ——
 * 两个守卫是**同一条规则**的两个实例。
 */
export function productionTsText(raw: string): string {
  return raw
    .replace(/\/\*[\s\S]*?\*\//g, '')   // 块注释（含 JSDoc）
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))  // 行注释
    .join('\n');
}

function portalSrcText(): string {
  const dir = fileURLToPath(new URL('../../../../apps/portal/src', import.meta.url));
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.ts') && !entry.endsWith('.tsx')) continue;
    if (entry.includes('.test.')) continue;
    out.push(productionTsText(readFileSync(`${dir}/${entry}`, 'utf8')));
  }
  return out.join('\n');
}

describe('审计操作：声明 ↔ 发射（含显式保留清单）', () => {
  it('每个声明值都被发射，或被显式标记为保留', () => {
    const src = portalSrcText();
    expect(src.length, '未扫到 portal src 内容（守卫不得假绿）').toBeGreaterThan(1000);

    const reserved = new Set<string>(RESERVED_AUDIT_OPERATIONS);
    expect(AUDIT_OPERATION_VALUES.length, `实测 ${AUDIT_OPERATION_VALUES.length} 个操作值`).toBeGreaterThanOrEqual(15);

    const problems: string[] = [];
    for (const op of AUDIT_OPERATION_VALUES) {
      const kind = classify(src.includes(op), reserved.has(op));
      if (kind === 'gap') problems.push(`${op}: 已声明但 src 中无引用，且未列入 RESERVED_AUDIT_OPERATIONS`);
      if (kind === 'stale-reservation') problems.push(`${op}: 列为保留但 src 中已被引用 ⇒ 标记过期，请从保留清单移除`);
    }
    expect(problems.join('\n'), '审计操作的声明与发射不一致').toBe('');
  });

  it('夹具：注释里的提及不算消费（否则假红/假绿）', () => {
    const withComment = productionTsText('// TODO: ROLE_PERMISSION_ASSIGN 将来要用\nconst x = 1;');
    expect(withComment, '行注释未被去掉').not.toContain('ROLE_PERMISSION_ASSIGN');

    const withBlock = productionTsText('/** 见 ROLE_PERMISSION_ASSIGN */\nconst y = 2;');
    expect(withBlock, '块注释未被去掉').not.toContain('ROLE_PERMISSION_ASSIGN');

    // 真实代码里的出现仍必须保留
    expect(productionTsText("const op = 'ROLE_PERMISSION_ASSIGN';")).toContain('ROLE_PERMISSION_ASSIGN');
  });

  it('保留清单本身不含未声明的值', () => {
    const declared = new Set<string>(AUDIT_OPERATION_VALUES);
    const unknown = RESERVED_AUDIT_OPERATIONS.filter((op) => !declared.has(op));
    expect(unknown.join(','), '保留清单里出现了不在 AUDIT_OPERATION_VALUES 的值').toBe('');
  });

  it('夹具：分区判定真的会红（四种组合）', () => {
    expect(classify(true, false)).toBe('emitted');
    expect(classify(false, true)).toBe('reserved');
    expect(classify(false, false)).toBe('gap');                     // 漏发射
    expect(classify(true, true)).toBe('stale-reservation');         // 标记过期
  });
});

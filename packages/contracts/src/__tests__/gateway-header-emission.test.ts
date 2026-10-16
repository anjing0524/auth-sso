import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { GATEWAY_HEADERS, RESERVED_GATEWAY_HEADERS } from '../index';

/**
 * 网关头的"声明 ↔ 消费"守卫（与 `audit-operation-emission` 同形）
 *
 * 为什么需要：契约里声明了 `GATEWAY_HEADERS.USER_NAME`，而当前没有任何代码读它。
 * 只有注释说明时，后人与守卫都无法区分"有意的预留"与"漏了读取"。
 *
 * 双向规则：
 *   ① 每个声明的头要么在 apps/gateway/src 被消费、要么列在 RESERVED_GATEWAY_HEADERS；
 *   ② 列在保留清单里的头不得已被消费（否则标记过期）。
 *
 * 比较按小写归一：HTTP 头名大小写不敏感（契约写 x-user-id，Rust 写 X-User-Id）。
 */
/**
 * 生产代码视图：去掉 `//` 注释，并**只**截掉文件末尾的 `#[cfg(test)] mod tests { … }`。
 *
 * ## 为什么不能用 `raw.split('#[cfg(test)]')[0]`
 *
 * 那会在**首个**标记处截断。而 `#[cfg(test)]` 也可能出现在文件**中部**（仅标注一个仅供测试
 * 使用的构造函数/辅助函数），例如 `apps/gateway/src/auth/verify.rs` 第 85 行的
 * `new_without_revocation_for_test` —— 其后还有上百行生产代码，`split` 会把它们一并漏扫，
 * 于是"缝后真的消费了保留值"这种情况**静默放行**（2026-10-16 两轴评审发现）。
 *
 * 残留局限（已知、如实记录）：中部被 `#[cfg(test)]` 标注的**辅助函数体**仍会被扫到，
 * 理论上可能把"测试辅助里的提及"算成消费。当前网关无此形状；若将来出现，应改为按 item 剔除。
 */
export function productionRustText(raw: string): string {
  // 只匹配**文件末尾**的测试模块
  const withoutTrailingTestModule = raw.replace(/\n#\[cfg\(test\)\]\s*\nmod tests\s*\{[\s\S]*$/, '');
  return withoutTrailingTestModule
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
}

function gatewaySrcText(): string {
  const dir = fileURLToPath(new URL('../../../../apps/gateway/src', import.meta.url));
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.rs')) continue;
    // 只认**生产代码**：跳过测试模块（它们会"提到"某个头名——如 contract_tests.rs 里
    // 那条"USER_NAME 既不被注入也不被读取"的注释——那种提及不算消费）
    if (entry.includes('tests')) continue;
    out.push(productionRustText(readFileSync(`${dir}/${entry}`, 'utf8')));
  }
  return out.join('\n').toLowerCase();
}

/** 四分区由 (是否被生产代码消费, 是否声明为保留) 决定；只有两种组合合法 */
function classify(consumed: boolean, reserved: boolean): 'consumed' | 'reserved' | 'gap' | 'stale-reservation' {
  if (consumed && reserved) return 'stale-reservation';
  if (reserved) return 'reserved';
  if (consumed) return 'consumed';
  return 'gap';
}

describe('网关头：声明 ↔ 消费（含显式保留清单）', () => {
  it('每个声明的头都被消费，或被显式标记为保留', () => {
    const src = gatewaySrcText();
    expect(src.length, '未扫到 gateway src 内容（守卫不得假绿）').toBeGreaterThan(1000);

    const reserved = new Set<string>(RESERVED_GATEWAY_HEADERS);
    const declared = Object.keys(GATEWAY_HEADERS) as Array<keyof typeof GATEWAY_HEADERS>;
    expect(declared.length, `实测 ${declared.length} 个头`).toBeGreaterThanOrEqual(3);

    const problems: string[] = [];
    for (const key of declared) {
      const kind = classify(src.includes(GATEWAY_HEADERS[key].toLowerCase()), reserved.has(key));
      if (kind === 'gap') problems.push(`${key} = ${GATEWAY_HEADERS[key]}: gateway src 中未见消费，且未列入 RESERVED_GATEWAY_HEADERS`);
      if (kind === 'stale-reservation') problems.push(`${key}: 列为保留但 gateway src 中已被消费 ⇒ 标记过期，请从保留清单移除`);
    }
    expect(problems.join('\n'), '网关头的声明与消费不一致').toBe('');
  });

  it('夹具：分区判定真的会红（四种组合）', () => {
    expect(classify(true, false)).toBe('consumed');
    expect(classify(false, true)).toBe('reserved');
    expect(classify(false, false)).toBe('gap');                  // 声明了却没人消费
    expect(classify(true, true)).toBe('stale-reservation');      // 保留标记过期
  });

  it('夹具：中部 #[cfg(test)] 之后的代码仍被保留（评审发现的盲点不得回归）', () => {
    const raw = [
      'pub fn a() {}',
      '#[cfg(test)]',
      'pub fn only_for_test() {}',
      'pub const HEADER_LATE: &str = "x-late-header";',   // 标记之后的生产代码
      '#[cfg(test)]',
      'mod tests {',
      '  #[test]',
      '  fn t() { assert!(true); }',
      '}',
    ].join('\n');
    const view = productionRustText(raw);
    expect(view, '中部标记之后的代码被漏扫了（盲点回归）').toContain('x-late-header');
    expect(view, '末尾测试模块未被去掉').not.toContain('mod tests');
  });

  it('保留清单只允许 GATEWAY_HEADERS 的键', () => {
    const declared = new Set<string>(Object.keys(GATEWAY_HEADERS));
    const unknown = RESERVED_GATEWAY_HEADERS.filter((k) => !declared.has(k));
    expect(unknown.join(','), '保留清单里出现了不属于 GATEWAY_HEADERS 的键').toBe('');
  });
});

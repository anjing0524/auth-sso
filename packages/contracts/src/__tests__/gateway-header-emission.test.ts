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
function gatewaySrcText(): string {
  const dir = fileURLToPath(new URL('../../../../apps/gateway/src', import.meta.url));
  const out: string[] = [];
  for (const entry of readdirSync(dir, { recursive: true, encoding: 'utf8' })) {
    if (!entry.endsWith('.rs')) continue;
    // 只认**生产代码**：跳过测试模块（它们会"提到"某个头名——如 contract_tests.rs 里
    // 那条"USER_NAME 既不被注入也不被读取"的注释——那种提及不算消费）
    if (entry.includes('tests')) continue;
    // 去掉 // 注释（"文档里提到"不算消费），并截掉文件末尾的 #[cfg(test)] 模块
    // （Rust 惯例：单元测试挂在生产文件尾部的 cfg(test) 里；那里的断言提及不算消费——
    //   实测 gateway.rs 的 is_identity_header(b"x-user-name") 断言就是一处）
    const raw = readFileSync(`${dir}/${entry}`, 'utf8');
    const withoutTests = raw.split('#[cfg(test)]')[0]!;
    const stripped = withoutTests
      .split('\n')
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    out.push(stripped);
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

  it('保留清单只允许 GATEWAY_HEADERS 的键', () => {
    const declared = new Set<string>(Object.keys(GATEWAY_HEADERS));
    const unknown = RESERVED_GATEWAY_HEADERS.filter((k) => !declared.has(k));
    expect(unknown.join(','), '保留清单里出现了不属于 GATEWAY_HEADERS 的键').toBe('');
  });
});

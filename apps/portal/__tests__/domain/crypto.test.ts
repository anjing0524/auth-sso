/**
 * 安全工具库的可观察契约（`lib/crypto.ts`）
 *
 * ## 为什么需要它
 *
 * 该模块此前**没有任何专门单测**，而它生成的是全部对外凭证的随机源：
 * Refresh Token、授权码、session jti、OAuth Client ID/Secret、JWK kid。
 *
 * 本文件锁定其**可观察契约**（长度、字符集、前缀、分布），这些是断言
 * 真正能证伪的部分。**不写**"测得熵为 N bit"这类无法从输出反推的断言——
 * 那会是同义反复或必然通过的空断言。
 *
 * ## 熵的现状（记录事实，非断言）
 *
 * | 生成器 | 随机字节 | 输出承载的熵 |
 * |---|---|---|
 * | `generateClientSecret` | 32 字节 | **256 bit**（真实高强度） |
 * | `generateClientId` | 8 字节 | 128 bit |
 * | `generateId(32)` | 见下 | 128 bit（曾为 256 字节 → 浪费一半） |
 *
 * @req H-AUTH-004, H-CLI-C
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import {
  generateId,
  generateUUID,
  generateClientId,
  generateClientSecret,
  hashToken,
  hexToBytes,
} from '@/lib/crypto';

describe('generateId', () => {
  it('返回恰好 length 个字符', () => {
    for (const length of [4, 16, 20, 31, 32, 33]) {
      expect(generateId(length), `length=${length}`).toHaveLength(length);
    }
  });

  it('默认长度为 20', () => {
    expect(generateId()).toHaveLength(20);
  });

  it('仅由小写十六进制字符组成', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(generateId(32)).toMatch(/^[0-9a-f]{32}$/);
    }
  });

  it('连续取值互不相同（无固定模式/常量折叠）', () => {
    const values = new Set(Array.from({ length: 500 }, () => generateId(32)));
    expect(values.size).toBe(500);
  });
});

describe('generateClientSecret — 对外凭证，文档承诺高强度', () => {
  it('返回 64 个十六进制字符（= 32 字节 = 256 bit）', () => {
    const secret = generateClientSecret();

    expect(secret).toHaveLength(64);
    expect(secret).toMatch(/^[0-9a-f]{64}$/);
  });

  it('连续生成互不相同', () => {
    const secrets = new Set(Array.from({ length: 200 }, () => generateClientSecret()));
    expect(secrets.size).toBe(200);
  });
});

describe('generateClientId', () => {
  it("带 'client_' 前缀且其余为十六进制", () => {
    const clientId = generateClientId();

    expect(clientId.startsWith('client_')).toBe(true);
    expect(clientId.slice('client_'.length)).toMatch(/^[0-9a-f]+$/);
  });

  it('连续生成互不相同', () => {
    const ids = new Set(Array.from({ length: 200 }, () => generateClientId()));
    expect(ids.size).toBe(200);
  });
});

describe('generateUUID', () => {
  it('是合法的 UUID v4（版本位与变体位正确）', () => {
    const uuid = generateUUID();

    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});

describe('hashToken — 令牌定位的唯一算法', () => {
  it('是确定性的 SHA-256 小写 hex（64 字符），同输入同输出', () => {
    const token = 'rt_example_token';

    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('不同输入产生不同摘要', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });

  it('与 Node crypto 的 SHA-256 一致（独立真相源，非复述实现）', async () => {
    const { createHash } = await import('node:crypto');
    const token = 'rt_cross_check';

    expect(hashToken(token)).toBe(createHash('sha256').update(token).digest('hex'));
  });
});

describe('hexToBytes', () => {
  it('偶数长度 hex 精确转换', () => {
    expect(Array.from(hexToBytes('00ff10'))).toEqual([0x00, 0xff, 0x10]);
  });

  it('空串得到空数组', () => {
    expect(hexToBytes('')).toHaveLength(0);
  });

  it('转换结果长度与字节数一致（供 timingSafeEqual 前处理）', () => {
    expect(hexToBytes('a'.repeat(64))).toHaveLength(32);
  });
});

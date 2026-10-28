import { describe, expect, it } from 'vitest';
import { isIsoDate } from './iso-date';

describe('isIsoDate', () => {
  it('接受 YYYY-MM-DD 形状', () => {
    expect(isIsoDate('2026-10-29')).toBe(true);
    expect(isIsoDate('2026-13-99')).toBe(true); // 只校验形状
  });
  it('拒绝其它形状/空值', () => {
    for (const v of ['', '2026/10/29', '2026-1-1', '2026-10-29T00:00:00', null, undefined]) {
      expect(isIsoDate(v), String(v)).toBe(false);
    }
  });
});

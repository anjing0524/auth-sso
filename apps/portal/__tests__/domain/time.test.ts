import { describe, expect, it } from 'vitest';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';

describe('领域时间边界', () => {
  it('Date 与 Temporal.Instant 往返不丢失毫秒精度', () => {
    const original = new Date('2026-07-24T01:02:03.456Z');
    expect(dateFromInstant(instantFromDate(original)).getTime()).toBe(original.getTime());
  });
});

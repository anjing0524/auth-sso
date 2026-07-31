import { describe, expect, it } from 'vitest';
import { dateFromInstant, instantFromDate } from '@/domain/shared/time';
import { formatShanghaiDateTime, getShanghaiDayRange } from '@/lib/format-time';

describe('领域时间边界', () => {
  it('Date 与 Temporal.Instant 往返不丢失毫秒精度', () => {
    const original = new Date('2026-07-24T01:02:03.456Z');
    expect(dateFromInstant(instantFromDate(original)).getTime()).toBe(original.getTime());
  });

  it('统一按 Asia/Shanghai 展示 UTC 时刻', () => {
    expect(formatShanghaiDateTime('2026-07-31T00:00:00.000Z')).toContain('08:00:00');
  });

  it('Asia/Shanghai 自然日边界转换为正确 UTC 时刻', () => {
    const range = getShanghaiDayRange('2026-07-31');
    expect(range.start.toISOString()).toBe('2026-07-30T16:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-07-31T15:59:59.999Z');
  });
});

import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatTime } from './format-date';

/**
 * 日期格式化必须**确定**：服务端（Node 进程 locale）与客户端（浏览器 locale）得到同一字符串。
 * 这条需求来自真实事故：Turbopack 容器（LANG 未设置 ⇒ Node en-US）与浏览器（zh-CN）对
 * `toLocaleDateString()` 输出不同（10/19/2026 vs 2026/10/19）⇒ React hydration 文本不匹配。
 */
describe('format-date（服务端/客户端确定性）', () => {
  it('ISO 字符串按固定 zh-CN 时区输出', () => {
    expect(formatDate('2026-10-19T07:11:14.662Z')).toBe('2026/10/19');
  });

  it('同一时刻的 Date 与 ISO 字符串输出一致', () => {
    const iso = '2026-10-19T07:11:14.662Z';
    expect(formatDate(new Date(iso))).toBe(formatDate(iso));
    expect(formatDateTime(new Date(iso))).toBe(formatDateTime(iso));
  });

  it('跨 UTC 日界按 Asia/Shanghai 归类（UTC 16:00 = 次日 00:00）', () => {
    expect(formatDate('2026-10-19T16:00:00.000Z')).toBe('2026/10/20');
  });

  it('日期时间包含时分秒且为 24 小时制', () => {
    expect(formatDateTime('2026-10-19T07:11:14.662Z')).toBe('2026/10/19 15:11:14');
  });

  it('时间输出固定 Asia/Shanghai（UTC 06:32 → 14:32）', () => {
    expect(formatTime('2026-10-20T06:32:00.000Z')).toBe('14:32');
  });

  it('空值与非法值回退为 -', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
    expect(formatDateTime('not-a-date')).toBe('-');
    expect(formatTime('not-a-date')).toBe('-');
  });
});

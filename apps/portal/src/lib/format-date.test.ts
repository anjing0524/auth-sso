import { describe, expect, it } from 'vitest';

import { formatDate, formatDateTime, formatTime } from './format-date';

/**
 * 日期格式化必须**确定**：服务端（Node 进程 locale）与客户端（浏览器 locale）得到同一字符串。
 * 这条需求来自真实事故：Turbopack 容器（LANG 未设置 ⇒ Node en-US）与浏览器（zh-CN）对
 * `toLocaleDateString()` 输出不同（10/19/2026 vs 2026/10/19）⇒ React hydration 文本不匹配。
 *
 * UX-14：全站统一 `YYYY-MM-DD HH:mm:ss`（显式零填充），替代 zh-CN toLocaleString 的
 * `2026/11/6 9:05:03`（月/日/时分秒无前导零）。
 */
describe('format-date（服务端/客户端确定性 + 零填充格式）', () => {
  it('ISO 字符串按固定 Asia/Shanghai 输出 YYYY-MM-DD', () => {
    expect(formatDate('2026-10-19T07:11:14.662Z')).toBe('2026-10-19');
  });

  it('同一时刻的 Date 与 ISO 字符串输出一致', () => {
    const iso = '2026-10-19T07:11:14.662Z';
    expect(formatDate(new Date(iso))).toBe(formatDate(iso));
    expect(formatDateTime(new Date(iso))).toBe(formatDateTime(iso));
  });

  it('跨 UTC 日界按 Asia/Shanghai 归类（UTC 16:00 = 次日 00:00）', () => {
    expect(formatDate('2026-10-19T16:00:00.000Z')).toBe('2026-10-20');
  });

  it('日期时间为 YYYY-MM-DD HH:mm:ss 且月/日/时分秒全部零填充', () => {
    expect(formatDateTime('2026-10-19T07:11:14.662Z')).toBe('2026-10-19 15:11:14');
    // zh-CN toLocaleString 会输出 `2026/11/6 9:05:3` 这类无前导零形态——统一为两位
    expect(formatDateTime('2026-11-06T01:05:03.000Z')).toBe('2026-11-06 09:05:03');
    expect(formatDateTime('2026-01-05T17:00:00.000Z')).toBe('2026-01-06 01:00:00');
  });

  it('时间输出 HH:mm 且零填充（UTC 06:32 → 14:32）', () => {
    expect(formatTime('2026-10-20T06:32:00.000Z')).toBe('14:32');
    expect(formatTime('2026-10-19T17:05:00.000Z')).toBe('01:05');
  });

  it('空值与非法值回退为 -', () => {
    expect(formatDate(null)).toBe('-');
    expect(formatDate(undefined)).toBe('-');
    expect(formatDate('')).toBe('-');
    expect(formatDateTime('not-a-date')).toBe('-');
    expect(formatTime('not-a-date')).toBe('-');
  });
});

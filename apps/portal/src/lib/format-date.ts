/**
 * 日期格式化 —— **服务端与客户端必须得到同一个字符串**。
 *
 * 为什么需要这个模块：审计在真实浏览器里抓到过一次 hydration 文本不一致：
 * `new Date(user.createdAt).toLocaleDateString()` 在服务端按 **Node 进程 locale**（如 en-US）
 * 渲染成 `10/19/2026`、在客户端按**浏览器 locale**（zh-CN）渲染成 `2026/10/19`
 * ⇒ React 报 "server rendered text didn't match the client" 并重建整棵树。
 *
 * 修法不是"碰巧让两边 locale 一样"，而是**显式固定 locale 与时区 + 手工拼装**：
 * 用 `Intl.formatToParts`（`en-US` 数字、`h23` 24 小时制）取各字段再零填充拼接，
 * 输出与运行环境 locale / 时区完全解耦，且全站统一为
 * `YYYY-MM-DD` / `HH:mm` / `YYYY-MM-DD HH:mm:ss`（UX-14：`zh-CN` 的
 * `toLocaleString` 会输出无前导零的 `2026/11/6 9:05:03`，跨页比对与导出后处理成本高）。
 *
 * 注意：只用于**展示**。业务判定/存储仍用 ISO 字符串或 `Temporal`。
 */
const TIME_ZONE = 'Asia/Shanghai';

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** 在固定时区取各时间字段（en-US 纯数字 + h23 24 小时制，与运行环境 locale 解耦） */
function partsInZone(d: Date): { year: string; month: string; day: string; hour: string; minute: string; second: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(d);
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? '';
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** `2026-10-19` */
export function formatDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '-';
  const p = partsInZone(d);
  return `${p.year}-${p.month}-${p.day}`;
}

/** `15:11`（固定 Asia/Shanghai，避免服务端容器 UTC 与浏览器时区不一致） */
export function formatTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '-';
  const p = partsInZone(d);
  return `${p.hour}:${p.minute}`;
}

/** `2026-10-19 15:11:14` */
export function formatDateTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  if (!d) return '-';
  const p = partsInZone(d);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

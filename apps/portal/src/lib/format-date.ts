/**
 * 日期格式化 —— **服务端与客户端必须得到同一个字符串**。
 *
 * 为什么需要这个模块：审计在真实浏览器里抓到过一次 hydration 文本不一致：
 * `new Date(user.createdAt).toLocaleDateString()` 在服务端按 **Node 进程 locale**（如 en-US）
 * 渲染成 `10/19/2026`、在客户端按**浏览器 locale**（zh-CN）渲染成 `2026/10/19`
 * ⇒ React 报 "server rendered text didn't match the client" 并重建整棵树。
 *
 * 修法不是"碰巧让两边 locale 一样"，而是**显式固定 locale 与时区**，
 * 让同一时刻在两端的输出确定且一致（本产品面向 zh-CN / Asia/Shanghai）。
 *
 * 注意：只用于**展示**。业务判定/存储仍用 ISO 字符串或 `Temporal`。
 */
const LOCALE = 'zh-CN';
const TIME_ZONE = 'Asia/Shanghai';

function toDate(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** `2026/10/19` */
export function formatDate(value: Date | string | null | undefined): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString(LOCALE, { timeZone: TIME_ZONE }) : '-';
}

/** `15:11`（固定 Asia/Shanghai，避免服务端容器 UTC 与浏览器时区不一致） */
export function formatTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  return d
    ? d.toLocaleTimeString(LOCALE, { timeZone: TIME_ZONE, hour12: false, hour: '2-digit', minute: '2-digit' })
    : '-';
}

/** `2026/10/19 15:11:14` */
export function formatDateTime(value: Date | string | null | undefined): string {
  const d = toDate(value);
  return d
    ? d.toLocaleString(LOCALE, { timeZone: TIME_ZONE, hour12: false })
    : '-';
}

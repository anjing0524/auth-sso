/**
 * 将 IPv4-mapped IPv6（::ffff:127.0.0.1）归一为直觉的 IPv4 展示。
 * 审计/会话仍保留原始值用于排障，这里只影响 UI 展示与复制。
 */
export function formatIp(value: string | null | undefined): string {
  if (!value) return '-';
  const trimmed = value.trim();
  return trimmed.startsWith('::ffff:') ? trimmed.slice(7) : trimmed;
}

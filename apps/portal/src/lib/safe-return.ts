/**
 * 站内返回路径白名单校验。
 *
 * 只接受以指定应用内前缀开头的绝对路径，拒绝 `//host` 协议相对 URL，
 * 用于列表 → 详情 → 返回时保留筛选上下文，同时避免开放重定向。
 */
export function safeReturnPath(
  raw: string | undefined | null,
  fallback: string,
  prefix: string,
): string {
  if (!raw) return fallback;
  if (!raw.startsWith(prefix) || raw.startsWith('//')) return fallback;
  return raw;
}

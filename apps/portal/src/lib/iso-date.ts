/**
 * `YYYY-MM-DD` 格式判定（审计日期筛选/导出的唯一实现）。
 *
 * 只校验“形状”，不校验日历合法性（如 2 月 30 日）；日期范围由查询层使用，
 * 非法形状必须挡在 SQL 之前，避免异常参数穿透。
 */
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string | null | undefined): value is string {
  return typeof value === 'string' && ISO_DATE_PATTERN.test(value);
}

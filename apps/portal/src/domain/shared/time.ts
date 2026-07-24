/**
 * 领域时间边界。
 *
 * 领域规则使用 Temporal.Instant；仅 Drizzle 持久化边界保留 Date。
 */
export function instantFromDate(value: Date): Temporal.Instant {
  return Temporal.Instant.fromEpochMilliseconds(value.getTime());
}

export function dateFromInstant(value: Temporal.Instant): Date {
  return new Date(value.epochMilliseconds);
}

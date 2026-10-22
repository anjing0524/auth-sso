/**
 * UUID 判定（路由参数等**数据库外键输入**的第一道校验）
 *
 * 存在理由：详情页把 URL 参数直接传给 Drizzle；非法 UUID 会触发 PostgreSQL
 * `22P02 invalid input syntax for type uuid`，在服务端组件里表现为整页报错（实测
 * `/users/not-a-uuid` 与 `/clients/not-a-uuid`），而不是友好 404。
 * 在进入查询前判定格式，非法值直接 `notFound()`，与"不存在"同形（ADR-014）。
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 是否形如 RFC 4122 UUID（大小写不敏感；不校验版本位） */
export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

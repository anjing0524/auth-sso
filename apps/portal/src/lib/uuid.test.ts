/**
 * UUID 路由参数前置校验：挡住 22P02（invalid input syntax for type uuid）
 *
 * 背景（2026-10-20 发现轮）：`/users/not-a-uuid` 与 `/clients/not-a-uuid` 会把非法值
 * 直接送进 Drizzle ⇒ PostgreSQL 22P02 ⇒ 整页服务端报错。详情页现在先 `isUuid` 再查询。
 */
import { describe, it, expect } from 'vitest';
import { isUuid } from './uuid';

describe('isUuid', () => {
  it('接受标准 RFC 4122 UUID（大小写不敏感）', () => {
    expect(isUuid('00000000-0000-4000-8000-000000000001')).toBe(true);
    expect(isUuid('AAAAAAAA-BBBB-4CCC-8DDD-EEEEEEEEEEEE')).toBe(true);
  });

  it('拒绝非 UUID 文本', () => {
    for (const value of ['', 'not-a-uuid', '123', 'portal', '00000000-0000-4000-8000-00000000000', '00000000-0000-4000-8000-00000000000g']) {
      expect(isUuid(value), value).toBe(false);
    }
  });

  it('拒绝带 SQL/路径注入片段的字符串', () => {
    expect(isUuid("' OR 1=1 --")).toBe(false);
    expect(isUuid('../../etc/passwd')).toBe(false);
  });
});

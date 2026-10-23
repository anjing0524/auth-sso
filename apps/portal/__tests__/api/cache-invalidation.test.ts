/**
 * 写后缓存失效的「写入位置」契约
 *
 * Next.js 对两个标签失效原语的可用位置有硬性限制：`updateTag` **只能**在
 * Server Action 里调用，在 Route Handler 上下文必抛 `E872`；而抛出点在写事务
 * 提交之后——形态是**写成功 + 失效未发生 + 响应 5xx**，并诱使调用方重试。
 *
 * 本文件把「哪个位置用哪个原语」钉成契约：
 * - Server Action → `invalidateResource`（`updateTag`，立即过期）
 * - Route Handler → `invalidateResourceFromRoute`（`revalidateTag(tag, { expire: 0 })`）
 *
 * **为什么断言"调了哪个原语"而不断言"路由返回 200"**：`vitest.setup.ts` 把整个
 * `next/cache` 换成空实现，于是真实的抛错在测试里**不可观测**——这正是该缺陷能
 * 长期存活的原因。原语级契约是此处唯一能变红的缝（route 级扫描见
 * `cache-invalidation-site-guard.test.ts`）。
 *
 * @req H-CFG-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { revalidatePath, revalidateTag, updateTag } from 'next/cache';
import { invalidateResource, invalidateResourceFromRoute } from '@/lib/cache-invalidation';

const pathMock = vi.mocked(revalidatePath);
const tagMock = vi.mocked(revalidateTag);
const updateTagMock = vi.mocked(updateTag);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('invalidateResource — Server Action 位置', () => {
  it('用 updateTag 立即过期，且不调用 revalidateTag', () => {
    invalidateResource('users');

    expect(pathMock).toHaveBeenCalledWith('/users');
    expect(updateTagMock).toHaveBeenCalledWith('users-list');
    expect(tagMock).not.toHaveBeenCalled();
  });
});

describe('invalidateResourceFromRoute — Route Handler 位置', () => {
  it('绝不调用 updateTag（该原语在 route 上下文必抛 E872）', () => {
    invalidateResourceFromRoute('users');

    expect(updateTagMock).not.toHaveBeenCalled();
  });

  it('用 revalidateTag 且传 { expire: 0 }，不用已废弃的单参形式', () => {
    invalidateResourceFromRoute('users');

    expect(tagMock).toHaveBeenCalledWith('users-list', { expire: 0 });
  });

  it('页面路由仍失效（revalidatePath 在 route 上下文合法）', () => {
    invalidateResourceFromRoute('users');

    expect(pathMock).toHaveBeenCalledWith('/users');
  });

  it('extraPaths 一并失效（如含实体 ID 的详情页）', () => {
    invalidateResourceFromRoute('clients', ['/clients/abc']);

    expect(pathMock).toHaveBeenCalledWith('/clients/abc');
  });
});

describe('资源表', () => {
  it('departments 同时失效 list 标签与跨资源标签（用户表单下拉框）', () => {
    invalidateResourceFromRoute('departments');

    expect(tagMock).toHaveBeenCalledWith('departments-list', { expire: 0 });
    expect(tagMock).toHaveBeenCalledWith('departments', { expire: 0 });
  });

  it('clients 必须失效 permissions-list —— 注销经 CASCADE 删除 permissions/role_permissions（H-C-04）', () => {
    invalidateResourceFromRoute('clients');

    expect(tagMock).toHaveBeenCalledWith('clients-list', { expire: 0 });
    // 删除后 5/5 次 /api/permissions 仍返回已删权限（cacheLife hours）——审计 H-C-04 实测
    expect(tagMock).toHaveBeenCalledWith('permissions-list', { expire: 0 });
  });

  it('profile 必须失效 users-list —— 改资料会显示在用户列表里', () => {
    invalidateResource('profile');

    expect(updateTagMock).toHaveBeenCalledWith('users-list');
  });

  it('未知资源抛出，两个入口一致（不静默跳过）', () => {
    // 资源名在类型上**没有**约束：`InvalidatableResource` 是 `keyof typeof INVALIDATION`，
    // 而表是 `Record<string, …>` ⇒ `keyof` 退化为 `string`。运行时抛错是唯一防线，
    // 故这里必须真的断言它。
    expect(() => invalidateResource('nope')).toThrow(/未知的可失效资源/);
    expect(() => invalidateResourceFromRoute('nope')).toThrow(/未知的可失效资源/);
  });
});

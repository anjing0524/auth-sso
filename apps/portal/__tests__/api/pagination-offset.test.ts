/**
 * 分页参数钳制：非法页码不得产生非法 OFFSET（真实 DB）
 *
 * ## 缺陷（架构评审 R2 第二轮 · 次级候选「分页原语三套并存」）
 *
 * 页面层 `roles/page.tsx:22` 与 `users/page.tsx:28` 用**裸** `parseInt(params.page)`，
 * 而数据层把页码直接换算成 `.offset((page - 1) * pageSize)`：
 *
 * | URL | page | offset | 结果 |
 * |---|---|---|---|
 * | `?page=0` | 0 | `-20` | PG `OFFSET must not be negative` → **500** |
 * | `?page=abc` | `NaN` | `NaN` | 非法 OFFSET → **500** |
 * | `?page=-5` | -5 | `-120` | 同上 |
 *
 * 安全原语 `lib/pagination.ts` 的 `parsePagination` 早已正确钳制，但页面层没有用它
 * （它只接受 `URLSearchParams`），且**该模块本身零测试**。
 *
 * ## 为什么从读模型驱动
 *
 * 页面是 React Server Component，`page.tsx` 不易直测；而缺陷的**落点**在
 * `.offset(...)`。本文件因此断言：**任何页码进到读模型，OFFSET 都必须是合法值**。
 *
 * @req B-USR-L, B-ROL-L
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { createTestDbHandle, seedTestData } from '../helpers/test-db';

const td = createTestDbHandle();

vi.mock('@/infrastructure/db', () => ({
  get db() { return td.db; },
  get schema() { return td.schema; },
}));

// 'use cache' 指令在测试运行时无缓存语义，仅需提供同名依赖
vi.mock('next/cache', () => ({
  cacheLife: vi.fn(),
  cacheTag: vi.fn(),
  revalidatePath: vi.fn(),
  updateTag: vi.fn(),
}));

import { getRoles } from '@/app/(dashboard)/roles/data';
import { clampPage, clampPageSize, offsetFor, parsePagination } from '@/lib/pagination';
import { MAX_PAGE_SIZE } from '@auth-sso/contracts';

const ROOT_DEPT_ID = '00000000-0000-4000-8000-000000000001';
const SCOPE = { deptIds: [ROOT_DEPT_ID] } as const;
const now = new Date();

function rootDept() {
  return [{
    id: ROOT_DEPT_ID, parentId: null, name: '总公司', code: 'ROOT',
    ancestors: null, sort: 0, status: 'ACTIVE' as const, createdAt: now, updatedAt: now,
  }];
}

function role(id: string, code: string, sort: number) {
  return {
    id, name: `角色${sort}`, code, description: '',
    deptId: ROOT_DEPT_ID, isSystem: false, status: 'ACTIVE' as const, sort,
    createdAt: now, updatedAt: now,
  };
}

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => {
  await td.cleanup();
  await seedTestData(td.db, {
    departments: rootDept(),
    roles: [
      role('00000000-0000-4000-8000-000000000301', 'R1', 0),
      role('00000000-0000-4000-8000-000000000302', 'R2', 1),
      role('00000000-0000-4000-8000-000000000303', 'R3', 2),
    ],
  });
});

const BASE = { pageSize: 2, keyword: '', status: '', scope: SCOPE } as const;

describe('读模型的分页钳制（真实 DB）', () => {
  it('正常页码：取到该页数据', async () => {
    const r = await getRoles({ ...BASE, page: 1 });
    expect(r.data).toHaveLength(2);
    expect(r.pagination).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });
  });

  it('**page=0 不得产生负 OFFSET**（应视为第 1 页，而不是 500）', async () => {
    const r = await getRoles({ ...BASE, page: 0 });
    expect(r.data).toHaveLength(2);
    expect(r.pagination.page).toBe(1);
  });

  it('**page=NaN 不得产生 NaN OFFSET**', async () => {
    const r = await getRoles({ ...BASE, page: Number.NaN });
    expect(r.data).toHaveLength(2);
    expect(r.pagination.page).toBe(1);
  });

  it('负数页码同样退化为第 1 页', async () => {
    const r = await getRoles({ ...BASE, page: -5 });
    expect(r.data).toHaveLength(2);
    expect(r.pagination.page).toBe(1);
  });
});

describe('分页原语（此前零测试）', () => {
  it('clampPage：非法输入一律回到第 1 页，合法值原样通过', () => {
    expect(clampPage('1')).toBe(1);
    expect(clampPage('3')).toBe(3);
    expect(clampPage('0')).toBe(1);
    expect(clampPage('-5')).toBe(1);
    expect(clampPage('abc')).toBe(1);
    expect(clampPage('')).toBe(1);
    expect(clampPage(undefined)).toBe(1);
    expect(clampPage(null)).toBe(1);
    expect(clampPage(Number.NaN)).toBe(1);
    expect(clampPage(2.9)).toBe(2);
  });

  it('clampPageSize：钳制到 1..MAX_PAGE_SIZE，非法回到默认值', () => {
    expect(clampPageSize('30')).toBe(30);
    // 0 视为"未提供" ⇒ 回到默认（与 parsePagination 的既有语义一致）
    expect(clampPageSize('0')).toBe(20);
    expect(clampPageSize('99999')).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize('abc', 15)).toBe(15);
    expect(clampPageSize(undefined)).toBe(20);
  });

  it('offsetFor：无论页码多离谱，OFFSET 恒为非负整数', () => {
    expect(offsetFor(1, 20)).toBe(0);
    expect(offsetFor(3, 20)).toBe(40);
    expect(offsetFor(0, 20)).toBe(0);
    expect(offsetFor(-5, 20)).toBe(0);
    expect(offsetFor(Number.NaN, 20)).toBe(0);
    expect(offsetFor(Number.POSITIVE_INFINITY, 20)).toBe(0);
    expect(offsetFor(2, 0)).toBe(1); // pageSize < 1 归一为 1
  });

  it('parsePagination：URLSearchParams 版与单值版同判据', () => {
    expect(parsePagination(new URLSearchParams(''))).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination(new URLSearchParams('page=0&pageSize=0'))).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination(new URLSearchParams('page=abc'))).toEqual({ page: 1, pageSize: 20 });
    expect(parsePagination(new URLSearchParams('page=4&pageSize=99999'))).toEqual({
      page: 4,
      pageSize: MAX_PAGE_SIZE,
    });
    expect(parsePagination(new URLSearchParams(''), 15)).toEqual({ page: 1, pageSize: 15 });
  });
});

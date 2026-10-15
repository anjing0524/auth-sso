/**
 * GET /api/audit/export —— CSV 导出的**列必须来自真实行形状**
 *
 * ## 缺陷（架构评审 R2 第二轮 · 次级候选「分页原语三套并存」的 Evidence）
 *
 * 导出路由把行强制转换为 `Record<string, unknown>` 后再取字段，于是 TypeScript
 * **无法**发现不存在的字段名：
 *
 * ```ts
 * logs.data.map((l: Record<string, unknown>) =>
 *   [l.createdAt, l.operator || l.username, l.operation, l.resource, l.detail, l.ip] …)
 * ```
 *
 * 而 `getAuditLogs` 的行形状是
 * `{ id, userId, username, operation, method, url, params, ip, userAgent, status, duration, errorMsg, createdAt }`
 * ⇒ **`operator` / `resource` / `detail` 三个字段都不存在**，CSV 的「操作人/目标资源/详情」
 * 三列恒为空（`csvEscape(undefined)` → `''`）。
 *
 * 本文件是该路由**首个测试**：断言导出的每一列都取自真实字段（不含 `undefined`）。
 *
 * 只 mock 鉴权结果；真实 `withPermission`（含错误映射）、真实 DB、真实读模型全程参与。
 *
 * @req H-AUDIT-001
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest';
import { NextRequest } from 'next/server';
import { createTestDbHandle } from '../helpers/test-db';
import * as schema from '@/db/schema';
import type * as permModule from '@/lib/auth/check-permission';

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

// @allow-module-mock @/lib/auth/check-permission auth-bypass: 只为进入 handler 伪造"已授权"上下文；真实 withPermission 与真实读模型全程参与（依赖它的断言：audit-export.test.ts 全部用例）
vi.mock(import('@/lib/auth/check-permission'), async (importOriginal): Promise<Partial<typeof permModule>> => {
  const actual = await importOriginal();
  return { ...actual,
  checkPermission: async () => ({ authorized: true, userId: '00000000-0000-4000-8000-000000000101' }),
  requirePermission: async () => ({ userId: '00000000-0000-4000-8000-000000000101' }),
};
});;

import { GET } from '@/app/api/audit/export/route';

const now = new Date();

beforeAll(async () => { await td.connect(); });
afterAll(async () => { await td.close(); });
beforeEach(async () => { await td.cleanup(); });

/** 每个单元格都不含 "undefined"（旧实现在本断言上必红） */
function assertNoUndefinedCells(csv: string): void {
  expect(csv).not.toContain('undefined');
  for (const line of csv.trim().split('\n')) {
    for (const cell of line.split(',')) {
      expect(cell).not.toBe('undefined');
    }
  }
}

async function exportCsv(type: 'login' | 'operation') {
  const res = await GET(new NextRequest(`http://localhost:4100/api/audit/export?type=${type}`));
  return { status: res.status, csv: await res.text() };
}

describe('GET /api/audit/export — CSV 列取自真实行形状', () => {
  it('type=operation：操作人/目标资源/详情三列必须有值（真实字段）', async () => {
    // 日志表不在 seedTestData 的 SeedData 里 ⇒ 直接插入真实行
    await td.db.insert(schema.auditLogs).values({
      operation: 'USER_UPDATE',
      username: 'audit-user',
      method: 'POST',
      url: '/api/users/abc',
      params: { page: 1 },
      ip: '10.0.0.7',
      status: 200,
      duration: 12,
      createdAt: now,
    });

    const { status, csv } = await exportCsv('operation');

    expect(status).toBe(200);
    expect(csv).toContain('时间,操作人,操作类型,目标资源,详情,IP地址');
    assertNoUndefinedCells(csv);

    const row = csv.trim().split('\n')[1]!.split(',');
    expect(row[1]).toBe('audit-user');      // 操作人 ← username（原读 l.operator，不存在）
    expect(row[2]).toBe('USER_UPDATE');     // 操作类型 ← operation
    expect(row[3]).toBe('/api/users/abc');  // 目标资源 ← url（原读 l.resource，不存在）
    expect(row[5]).toBe('10.0.0.7');        // IP ← ip
    // 详情 ← params（原读 l.detail，不存在）：jsonb 对象会被 String() 化，只要求非空
    expect(row[4]).not.toBe('');
  });

  it('type=login：既有正确路径的回归守卫', async () => {
    await td.db.insert(schema.loginLogs).values({
      username: 'login-user',
      eventType: 'LOGIN_SUCCESS',
      ip: '10.0.0.8',
      userAgent: 'vitest',
      failReason: null,
      createdAt: now,
    });

    const { status, csv } = await exportCsv('login');

    expect(status).toBe(200);
    expect(csv).toContain('时间,用户,事件类型,IP地址,User-Agent,失败原因');
    assertNoUndefinedCells(csv);

    const row = csv.trim().split('\n')[1]!.split(',');
    expect(row[1]).toBe('login-user');
    expect(row[2]).toBe('LOGIN_SUCCESS');
    expect(row[4]).toBe('vitest');
  });
});

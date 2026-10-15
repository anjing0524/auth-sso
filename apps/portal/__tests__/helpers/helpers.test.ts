/**
 * 在用 helper 的自检（#55 收敛后）
 *
 * 改造前本文件 201 行，其中大部分在"测那些零采用者的死 adapter"——为死代码提供
 * "看起来有覆盖"的假象（判据同测试替身：它替谁服务？）。现在只自检**仍在用**的
 * helper，且每条断言都落在 helper 的真实行为上。
 *
 * 本文件属 UI（jsdom）project，**不得**连接数据库或 Redis：`createTestDbHandle`
 * 只自检"句柄形状、未连接时不建连接"，种子夹具只自检形状。
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestRequest, parseResponseJson } from './test-utils';
import { createTestDbHandle, seedTestData } from './test-db';
import {
  seedAdminUser,
  seedRootDept,
  seedTestPermission,
  seedTestUser,
} from './seed-fixtures';

describe('在用 helper 自检', () => {
  describe('createTestRequest', () => {
    it('构造 GET 请求：路径、方法与默认头正确', () => {
      const req = createTestRequest('/api/me');

      expect(req.method).toBe('GET');
      expect(req.url).toContain('/api/me');
    });

    it('构造 POST 请求：body 与 cookie 选项生效', async () => {
      const req = createTestRequest('/api/login', {
        method: 'POST',
        body: { email: 'a@b.c' },
        cookies: { portal_jwt_token: 'jwt-1' },
      });

      expect(req.method).toBe('POST');
      expect(req.headers.get('cookie')).toContain('portal_jwt_token=jwt-1');
      await expect(req.json()).resolves.toEqual({ email: 'a@b.c' });
    });
  });

  describe('parseResponseJson', () => {
    it('解析 JSON 响应体', async () => {
      const res = new Response(JSON.stringify({ ok: true }), {
        headers: { 'content-type': 'application/json' },
      });

      await expect(parseResponseJson(res)).resolves.toEqual({ ok: true });
    });
  });

  describe('createTestDbHandle', () => {
    it('返回句柄形状；未 connect 时访问 db 会抛出可诊断错误（不建连接）', () => {
      const td = createTestDbHandle();

      expect(typeof td.connect).toBe('function');
      expect(typeof td.cleanup).toBe('function');
      expect(() => td.db).toThrow(/未初始化/);
    });
  });

  describe('助手审计（#91-A5：把"逐一看形状"做成可复现的断言）', () => {
    it('助手模块里不得有静默吞异常的 catch（会把失败吞掉）', () => {
      const dir = dirname(fileURLToPath(import.meta.url));
      const modules = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'));
      // 扫描范围非空（否则这条检查是假绿）
      expect(modules.length).toBeGreaterThanOrEqual(4);

      const offenders = modules.filter((f) =>
        /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(readFileSync(join(dir, f), 'utf-8')),
      );
      expect(offenders, '助手里的空 catch 会把失败吞掉——要吞也要写明为什么').toEqual([]);
    });
  });

  describe('种子夹具的形状（与 schema 对齐）', () => {
    it('部门/用户：固定 ID 与 ACTIVE 状态', () => {
      const [dept] = seedRootDept();
      const [admin] = seedAdminUser();
      const [user] = seedTestUser();

      expect(dept!.id).toBe('00000000-0000-4000-8000-000000000001');
      expect(dept!.status).toBe('ACTIVE');
      expect(admin!.status).toBe('ACTIVE');
      expect(user!.status).toBe('ACTIVE');
      expect(admin!.id).not.toBe(user!.id);
    });

    it('seedTestData 的形状守卫：字段不是数组 ⇒ 立刻抛（不让种子被静默跳过）', async () => {
      // 不连库：守卫在任何 DB 访问**之前**就抛（UI project 不得连库）
      const fakeDb = {} as unknown as Parameters<typeof seedTestData>[0];

      await expect(
        seedTestData(fakeDb, { users: { id: 'x' } } as never),
      ).rejects.toThrow(/必须是数组/);

      // 空数组是**合法**的 no-op（不触发守卫、也不碰库）——守卫只拦"形状错"
      await expect(seedTestData(fakeDb, { users: [] })).resolves.toBeUndefined();
    });

    it('权限：code 与 type 齐备', () => {
      const [perm] = seedTestPermission({ code: 'portal:user:list' });

      expect(perm!.code).toBe('portal:user:list');
      expect(perm!.type).toBe('API');
      expect(perm!.status).toBe('ACTIVE');
    });
  });
});

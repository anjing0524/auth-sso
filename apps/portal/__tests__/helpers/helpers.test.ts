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
import { createTestRequest, parseResponseJson } from './test-utils';
import { createTestDbHandle } from './test-db';
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

    it('权限：code 与 type 齐备', () => {
      const [perm] = seedTestPermission({ code: 'portal:user:list' });

      expect(perm!.code).toBe('portal:user:list');
      expect(perm!.type).toBe('API');
      expect(perm!.status).toBe('ACTIVE');
    });
  });
});

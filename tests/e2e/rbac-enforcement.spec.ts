/**
 * E2E: RBAC 权限执行测试
 * RBAC Enforcement — U9 Layered Test Verification
 *
 * 验证管理员用户拥有全部菜单和权限，受限用户仅能访问被授权的功能，
 * 未认证用户无法访问受保护 API。
 *
 * 注意：由于 seed 数据不包含菜单记录，侧边栏使用 fallbackMenus 兜底。
 * 为了验证真正的 RBAC 过滤，本测试：
 *   1. 验证管理员可以访问全部 API
 *   2. 通过创建受限角色测试 API 级权限执行
 *   3. 验证未认证请求被正确拒绝
 *
 * @req H-ACL-001
 * @req H-ACL-002
 * @req H-ACL-003
 */

import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  loginAsUser,
  logout,
  clearAllCookies,
  createRestrictedRoleAndUser,
  PORTAL_URL,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  RESTRICTED_USER,
} from './helpers';

test.describe('RBAC Enforcement', () => {
  // ─── Happy: 管理员全权限访问 ══════════════════════════
  test.describe('Admin Full Access', () => {
    test('管理员登录后应可访问 Dashboard 并加载所有数据', async ({ page }) => {
      // @req H-ACL-001
      await loginAsAdmin(page);

      // 到达 Dashboard
      await expect(page).toHaveURL(/\/dashboard/);
      // 侧边栏应渲染 (改用 heading 定位以避免面包屑严格模式冲突)
      await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible({ timeout: 10_000 });

      // 验证 API 级权限：管理员可访问所有受保护端点
      const protectedEndpoints = [
        '/api/users?pageSize=1',
        '/api/roles?pageSize=1',
        '/api/clients?pageSize=1',
        '/api/departments?pageSize=1',
        '/api/permissions',
      ];

      for (const endpoint of protectedEndpoints) {
        const res = await page.request.get(`${PORTAL_URL}${endpoint}`);
        expect(res.ok(), `${endpoint} 应返回 200`).toBeTruthy();
      }
    });

    test('管理员应具有全部 seed 权限码', async ({ page }) => {
      await loginAsAdmin(page);

      const meRes = await page.request.get(`${PORTAL_URL}/api/me`);
      expect(meRes.ok()).toBeTruthy();
      const meBody = (await meRes.json()) as { permissions: string[] };

      // seed 中定义的 23 个权限
      const expectedPermissions = [
        'user:list', 'user:create', 'user:update', 'user:delete',
        'role:list', 'role:create', 'role:update', 'role:delete',
        'department:list', 'department:create', 'department:update', 'department:delete',
        'client:list', 'client:create', 'client:update', 'client:delete',
        'audit:read',
        'menu:list', 'menu:create', 'menu:update', 'menu:delete',
        'permission:list', 'permission:create', 'permission:update', 'permission:delete',
      ];

      for (const perm of expectedPermissions) {
        expect(
          meBody.permissions,
          `管理员应包含权限 ${perm}`,
        ).toContain(perm);
      }
    });
  });

  // ─── Edge: 受限用户 ═══════════════════════════════════
  test.describe('Restricted User', () => {
    /**
     * 在 beforeAll 中通过管理员 API 创建受限角色和用户：
     *   - 角色 VIEWER（非 ADMIN/SUPER_ADMIN）
     *   - 仅授予 user:list 权限
     *   - 创建 viewer 用户并绑定角色
     */
    test.beforeAll(async ({ browser }) => {
      // 使用独立的 browser context 以管理员身份执行 setup
      const setupContext = await browser.newContext();
      const setupPage = await setupContext.newPage();
      await loginAsAdmin(setupPage);

      // 创建受限角色和用户
      const result = await createRestrictedRoleAndUser(setupPage);

      // 将结果存储在 test 上下文中（通过 process.env 透传）
      process.env.__TEST_RESTRICTED_EMAIL = result.email;
      process.env.__TEST_RESTRICTED_PASSWORD = result.password;

      await setupPage.close();
      await setupContext.close();
    });

    test('受限用户应无法访问无权限的 API 端点', async ({ page }) => {
      // @req H-ACL-002
      const restrictedEmail = process.env.__TEST_RESTRICTED_EMAIL || RESTRICTED_USER.email;
      const restrictedPassword = process.env.__TEST_RESTRICTED_PASSWORD || RESTRICTED_USER.password;

      // 以受限用户身份登录
      await loginAsUser(page, restrictedEmail, restrictedPassword);

      // 受限用户仅有 user:list 权限
      // user:list → 应允许
      const usersRes = await page.request.get(`${PORTAL_URL}/api/users?pageSize=1`);
      expect(usersRes.ok(), 'user:list 权限 → /api/users 应允许').toBeTruthy();

      // role:list → 应被拒绝 (403)
      const rolesRes = await page.request.get(`${PORTAL_URL}/api/roles?pageSize=1`);
      expect(rolesRes.status(), '缺少 role:list → /api/roles 应返回 403').toBe(403);

      // client:list → 应被拒绝 (403)
      const clientsRes = await page.request.get(`${PORTAL_URL}/api/clients?pageSize=1`);
      expect(clientsRes.status(), '缺少 client:list → /api/clients 应返回 403').toBe(403);

      // permission:list → 应被拒绝 (403)
      const permsRes = await page.request.get(`${PORTAL_URL}/api/permissions`);
      expect(permsRes.status(), '缺少 permission:list → /api/permissions 应返回 403').toBe(403);
    });

    test('受限用户应只拥有 user:list 权限', async ({ page }) => {
      const restrictedEmail = process.env.__TEST_RESTRICTED_EMAIL || RESTRICTED_USER.email;
      const restrictedPassword = process.env.__TEST_RESTRICTED_PASSWORD || RESTRICTED_USER.password;

      await loginAsUser(page, restrictedEmail, restrictedPassword);

      // 验证 /api/me 返回的权限列表
      const meRes = await page.request.get(`${PORTAL_URL}/api/me`);
      expect(meRes.ok()).toBeTruthy();
      const meBody = (await meRes.json()) as { permissions: string[] };

      expect(meBody.permissions).toContain('user:list');
      expect(meBody.permissions).not.toContain('role:list');
      expect(meBody.permissions).not.toContain('client:list');
    });
  });

  // ─── Edge: 未认证访问 ═════════════════════════════════
  test.describe('Unauthorized Access', () => {
    test('未认证请求应返回 401', async ({ page }) => {
      // @req H-ACL-003
      await clearAllCookies(page);

      const protectedEndpoints = [
        '/api/me',
        '/api/me/permissions',
        '/api/users',
        '/api/roles',
        '/api/clients',
        '/api/departments',
        '/api/permissions',
        '/api/audit/logs',
      ];

      for (const endpoint of protectedEndpoints) {
        const res = await page.request.get(`${PORTAL_URL}${endpoint}`);
        expect(
          res.status(),
          `${endpoint} 未认证应返回 401，实际 ${res.status()}`,
        ).toBe(401);
      }
    });
  });
});

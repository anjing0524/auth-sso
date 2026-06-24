/**
 * E2E: 认证流程测试
 * Authentication Flow — U9 Layered Test Verification
 *
 * 覆盖完整 OAuth 2.1 Authorization Code + PKCE 登录流程，
 * 以及登出、错误凭据、未认证访问等边界场景。
 *
 * @req H-FLOW-001
 * @req H-FLOW-002
 * @req H-FLOW-003
 * @req H-FLOW-004
 * @req H-ACL-004
 */

import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  logout,
  clearAllCookies,
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  PORTAL_URL,
} from './helpers';

test.describe('Auth Flow', () => {
  // ─── Happy Path: 完整登录流程 ─────────────────────
  test.describe('Happy Path', () => {
    test('完整 OAuth 登录流程应成功重定向到 Dashboard', async ({ page }) => {
      // 从未登录状态开始
      await page.goto('/');
      // 未登录时首页应显示"统一身份认证管理门户"
      await expect(page.getByText('统一身份认证')).toBeVisible({ timeout: 10_000 });

      // 执行完整 OAuth 登录
      await loginAsAdmin(page);

      // 验证已到达 Dashboard
      await expect(page).toHaveURL(/\/dashboard/);
      // Dashboard 应渲染概览数据 (改用 heading 定位以避免面包屑严格模式冲突)
      await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('用户总数')).toBeVisible();
      await expect(page.getByText('安全审计动态')).toBeVisible();
    });

    test('登录成功后 /api/me 应返回用户信息和权限', async ({ page }) => {
      await loginAsAdmin(page);

      // 通过 API request context（共享 browser cookies）验证 /api/me (page.request 是只读属性)
      const meRes = await page.request.get(`${PORTAL_URL}/api/me`);
      expect(meRes.ok()).toBeTruthy();
      const meBody = (await meRes.json()) as { user: { email: string }; permissions: string[] };
      expect(meBody.user.email).toBe(ADMIN_EMAIL);
      expect(meBody.permissions).toContain('user:list');
    });
  });

  // ─── Logout ────────────────────────────────────────
  test.describe('Logout', () => {
    test('登出后 Session 应失效，受保护 API 返回 401', async ({ page }) => {
      // @req H-ACL-004
      await loginAsAdmin(page);

      // 登录后可访问 /api/me (page.request 是只读属性)
      const meBefore = await page.request.get(`${PORTAL_URL}/api/me`);
      expect(meBefore.ok()).toBeTruthy();

      // 执行登出
      await logout(page);

      // 登出后 Portal session 已被清除，API 应返回 401 (page.request 是只读属性)
      const meAfter = await page.request.get(`${PORTAL_URL}/api/me`);
      expect(meAfter.status()).toBe(401);
    });
  });

  // ─── Edge Cases ────────────────────────────────────
  test.describe('Edge Cases', () => {
    test('错误密码应在 Portal 登录页显示错误信息，不重定向', async ({ page }) => {
      // 直接打开 Portal 登录页
      await page.goto('/login');
      await expect(page.locator('#email')).toBeVisible({ timeout: 15_000 });

      // 输入错误密码
      await page.fill('#email', ADMIN_EMAIL);
      await page.fill('#password', 'WrongPassword999!');
      await page.click('button[type="submit"]');

      // 验证错误提示出现（不重定向，仍停留在 Portal 登录页）
      await expect(page.getByText('登录遇到问题')).toBeVisible({ timeout: 10_000 });
      // URL 应仍包含 /login（未被重定向回 Portal dashboard）
      expect(page.url()).toContain('/login');
    });

    test('未登录用户访问 Dashboard 应重定向到登录页', async ({ page }) => {
      // @req H-ACL-004
      await page.goto('/dashboard');
      // 未登录时，应重定向到 /login 页面
      await page.waitForURL(/\/login/, { timeout: 15_000 });
      await expect(page.getByText('企业统一身份认证')).toBeVisible();
    });

    test('登录完成后应包含 Portal JWT Cookie', async ({ page }) => {
      await loginAsAdmin(page);

      // 验证 portal_jwt_token cookie 已设置
      const cookies = await page.context().cookies();
      const sessionCookie = cookies.find((c) => c.name === 'portal_jwt_token');
      expect(sessionCookie).toBeDefined();
      expect(sessionCookie!.value.length).toBeGreaterThan(0);
    });
  });
});

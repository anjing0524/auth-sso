/**
 * E2E: 跨应用单点登录测试
 * SSO Cross-App — U9 Layered Test Verification
 *
 * 验证 Portal 登录后，Demo App 可通过 SSO 自动完成认证；
 * Portal 登出后，IdP Session 失效，Demo App 需要重新登录。
 *
 * @req SSO-CROSS-APP
 * @req SSO-DIRECT-ACCESS
 * @req SSO-LOGOUT-PROPAGATION
 * @req G-SEC-INT
 */

import { test, expect } from '@playwright/test';
import {
  loginAsAdmin,
  logout,
  clearAllCookies,
  PORTAL_URL,
  DEMO_APP_URL,
} from './helpers';

test.describe('SSO Cross-App', () => {
  // ─── Happy: Portal 登录 → Demo App SSO ═══════════════
  test.describe('SSO Auto-Authenticate', () => {
    test('Portal 登录后 Demo App 应自动完成 SSO 认证', async ({ page, context }) => {
      // @req SSO-CROSS-APP
      // @req G-SEC-INT

      // 1. 在 Portal 完成登录
      await loginAsAdmin(page);

      // 确认 IdP Session Cookie 已设置（在 127.0.0.1:4101 域）
      const allCookies = await context.cookies();
      const idpSessionCookies = allCookies.filter(
        (c) => c.domain.includes('127.0.0.1') && c.name.includes('session') && c.value.length > 0,
      );
      expect(idpSessionCookies.length).toBeGreaterThan(0);

      // 2. 打开 Demo App 新页面（同一 browser context → cookies 共享）
      const demoPage = await context.newPage();
      await demoPage.goto(DEMO_APP_URL);

      // Demo App 首页在未登录时应显示"SSO 登录"按钮
      await expect(demoPage.getByText('Demo App - SSO 测试')).toBeVisible({ timeout: 10_000 });
      await expect(demoPage.getByText('SSO 登录')).toBeVisible();

      // 3. 点击 SSO 登录 → 期望自动完成认证（不进入 IdP 登录页）
      await demoPage.click('a[href="/api/auth/login"]');

      // 由于 IdP Session 有效，OAuth 流程应自动完成并重定向回 Demo App
      // 等待 URL 回到 Demo App（非 /sign-in）
      await demoPage.waitForURL((url) => {
        return url.hostname === '127.0.0.1' && url.port === '4102';
      }, { timeout: 20_000 });

      // Demo App 已登录后应显示"已登录"状态
      await expect(demoPage.getByText('已登录')).toBeVisible({ timeout: 10_000 });
      await expect(demoPage.getByText('SSO 认证成功')).toBeVisible();

      // 验证用户信息已加载
      await expect(demoPage.getByText('邮箱')).toBeVisible();
      await expect(demoPage.getByText('admin@example.com')).toBeVisible();
    });
  });

  // ─── Edge: 直接访问 Demo App ═════════════════════════
  test.describe('Direct Access', () => {
    test('未登录用户直接访问 Demo App 应显示未登录状态', async ({ page }) => {
      // @req SSO-DIRECT-ACCESS
      await clearAllCookies(page);

      await page.goto(DEMO_APP_URL);

      // 未登录时显示"未登录"提示
      await expect(page.getByText('未登录')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('请登录以访问完整功能')).toBeVisible();
      await expect(page.getByText('SSO 登录')).toBeVisible();
    });

    test('未登录用户从 Demo App 发起 SSO 登录应跳到 IdP 登录页', async ({ page }) => {
      // @req SSO-DIRECT-ACCESS
      await clearAllCookies(page);

      await page.goto(DEMO_APP_URL);
      await page.click('a[href="/api/auth/login"]');

      // 无 IdP Session → 应跳转到 IdP sign-in 页面
      await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
      // 登录表单应可见
      await expect(page.locator('#email')).toBeVisible();
    });
  });

  // ─── Edge: Portal 登出 → Demo App SSO 失效 ═══════════
  test.describe('Logout Propagation', () => {
    test('Portal 登出后 IdP Session 被销毁，Demo App SSO 需重新登录', async ({ page, context }) => {
      // @req SSO-LOGOUT-PROPAGATION
      // @req G-SEC-INT

      // 1. Portal 登录
      await loginAsAdmin(page);

      // 2. 登出 Portal（清除 IdP Session）
      await logout(page);
      // 登出后应位于 IdP sign-in 页
      await expect(page.locator('#email')).toBeVisible({ timeout: 10_000 });
      await expect(page.getByText('统一身份认证')).toBeVisible();

      // 3. 在全新页面（或同一 context 中）打开 Demo App，尝试 SSO 登录
      const demoPage = await context.newPage();
      await demoPage.goto(DEMO_APP_URL);
      await demoPage.click('a[href="/api/auth/login"]');

      // IdP Session 已被销毁 → 应跳转到 IdP sign-in 页
      await demoPage.waitForURL(/\/sign-in/, { timeout: 15_000 });
      await expect(demoPage.locator('#email')).toBeVisible();
    });
  });
});

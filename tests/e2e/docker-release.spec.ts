/**
 * Docker release acceptance: the request enters only through the Gateway.
 *
 * @req H-AUTH-001, H-AUTH-002, H-AUTH-003, H-AUTH-005
 * @req H-SSO-004, H-FLOW-001, H-FLOW-002, H-FLOW-004
 */
import { expect, test } from '@playwright/test';

test.describe('Docker release acceptance', () => {
  test('Gateway 登录、OAuth 回调、会话下发与登出形成完整闭环', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?session_id=/);

    await page.getByLabel(/账号.*邮箱/i).fill('admin@example.com');
    await page.getByLabel('密码').fill('Admin@123456');
    await page.getByRole('button', { name: '安全登录' }).click();

    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    await expect(page.getByText('Auth-SSO').first()).toBeVisible();

    const activeCookies = await page.context().cookies();
    for (const name of ['portal_jwt_token', 'portal_refresh_token']) {
      const cookie = activeCookies.find((candidate) => candidate.name === name);
      expect(cookie, `${name} 必须由 Gateway OAuth 回调下发`).toBeDefined();
      expect(cookie?.httpOnly).toBe(true);
      expect(cookie?.secure).toBe(true);
      expect(cookie?.sameSite).toBe('Lax');
    }

    const logout = await page.request.post('/api/auth/logout');
    expect(logout.status()).toBe(200);

    const remainingCookies = await page.context().cookies();
    expect(remainingCookies.some((cookie) => cookie.name === 'portal_jwt_token')).toBe(false);
    expect(remainingCookies.some((cookie) => cookie.name === 'portal_refresh_token')).toBe(false);

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?session_id=/);
  });
});

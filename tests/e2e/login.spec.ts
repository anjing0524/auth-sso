import { expect, test } from '@playwright/test';

const authorizeUrl = '/api/auth/oauth2/authorize?response_type=code&client_id=portal&redirect_uri=http%3A%2F%2F127.0.0.1%3A4102%2Fapi%2Fauth%2Fcallback&scope=openid%20profile%20email&state=e2e-state&nonce=e2e-nonce&code_challenge=abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~&code_challenge_method=S256';

/** @req OAuth 登录入口在浏览器中可用，防止 route/module 加载回归。 */
test('登录页提供凭据表单与授权入口', async ({ page }) => {
  await page.goto('/login');

  await expect(page.getByLabel(/邮箱|用户名/i)).toBeVisible();
  await expect(page.getByLabel(/密码/i)).toBeVisible();
  await expect(page.getByRole('button', { name: /登录/i })).toBeVisible();
});

/** @req OAuth 授权码 + PKCE 浏览器完整旅程可用。 */
test('管理员登录后签发 OAuth 授权码', async ({ page }) => {
  await page.goto(authorizeUrl);
  await expect(page).toHaveURL(/\/login\?session_id=/);
  await page.getByLabel(/邮箱|用户名/i).fill('admin@example.com');
  await page.getByLabel(/密码/).fill('Admin@123456');
  const callbackRequest = page.waitForRequest((request) => {
    const url = new URL(request.url());
    return url.pathname === '/api/auth/callback' && url.searchParams.get('code')?.startsWith('auth_code_') === true;
  });
  await page.getByRole('button', { name: /安全登录/ }).click();
  expect(new URL((await callbackRequest).url()).searchParams.get('state')).toBe('e2e-state');
  expect((await page.context().cookies()).some((cookie) => cookie.name === 'login_session')).toBe(false);
});

import { expect, test } from '@playwright/test';

/**
 * 移动端侧边栏：导航后自动收起，页面不再被遮挡。
 * @req AUTH-001
 */
test.use({ viewport: { width: 390, height: 844 } });

test('移动端侧栏导航后自动收起', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('登录邮箱').fill('admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
  await page.getByRole('button', { name: '安全登录' }).click();
  await page.waitForURL(/dashboard$/);

  await page.getByRole('button', { name: '切换侧边栏' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('link', { name: '用户管理' }).first().click();

  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('body')).toHaveCSS('overflow', 'visible');
});

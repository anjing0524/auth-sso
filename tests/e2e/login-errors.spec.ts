import { expect, test } from '@playwright/test';

/**
 * 登录失败态：错误提示可见、保留邮箱、清空密码、焦点回密码框。
 * @req AUTH-001
 */
test('密码错误后保留邮箱、清空密码并聚焦密码框', async ({ page }) => {
  await page.goto('/login');
  // 唯一邮箱避免连续运行触发按账号的登录限流（限流错误仍是登录失败，但文案不同）
  const email = `nobody_${Date.now()}@example.com`;
  await page.getByLabel('登录邮箱').fill(email);
  await page.getByLabel('密码', { exact: true }).fill('WrongPass@123');
  await page.getByRole('button', { name: '安全登录' }).click();

  await expect(page.getByRole('alert').filter({ hasText: '邮箱或密码错误' })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByLabel('登录邮箱')).toHaveValue(email);
  await expect(page.getByLabel('密码', { exact: true })).toHaveValue('');
  await expect(page.getByLabel('密码', { exact: true })).toBeFocused();
});

import { expect, test } from '@playwright/test';

/**
 * 首登强制改密闭环：初始密码用户第一次登录不能进入工作台，必须完成改密；
 * 改密后旧会话失效、新密码可再次登录。
 *
 * @req US-SEC-02, NFR-SEC-13
 */
test('初始密码用户首次登录被强制改密，改密后可重新登录', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill('qa_force@example.com');
  await page.getByLabel('密码', { exact: true }).fill('QaForce@123456');
  await page.getByRole('button', { name: '安全登录' }).click();

  await expect(page).toHaveURL(/\/force-password-change$/, { timeout: 30_000 });
  await expect(page.getByRole('heading', { name: '请先修改初始密码' })).toBeVisible();

  await page.getByLabel('当前密码').fill('QaForce@123456');
  await page.getByLabel('新密码', { exact: true }).fill('QaForce@123456!New');
  await page.getByLabel('确认新密码').fill('QaForce@123456!New');
  await page.getByRole('button', { name: '修改密码并重新登录' }).click();

  await expect(page).toHaveURL(/\/login$/, { timeout: 30_000 });

  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill('qa_force@example.com');
  await page.getByLabel('密码', { exact: true }).fill('QaForce@123456!New');
  await page.getByRole('button', { name: '安全登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
});

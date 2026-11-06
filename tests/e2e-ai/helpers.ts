import { expect, type Page } from '@playwright/test';

/** 确定性登录只作为场景准备，AI 只负责探索/断言，不把登录本身变成概率测试。 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill('admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
  await page.getByRole('button', { name: '安全登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
}

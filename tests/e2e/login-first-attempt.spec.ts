import { expect, test } from '@playwright/test';

/**
 * 稳定复现回归：直接打开 /login（没有 OAuth session_id）时，admin 第一次提交
 * 就必须进入工作台。
 *
 * 背景：登录成功后若用 Next Router 做客户端跳转，首次会命中登录前的未认证
 * RSC/路由缓存，表现为“第一次失败、第二次成功”。登录是认证边界，必须整页导航，
 * 让 login_session Cookie 先落盘再进入受保护路由。
 *
 * @req H-AUTH-002, H-FLOW-001
 */
test('admin 从登录页第一次提交即进入工作台', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill('admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
  await page.getByRole('button', { name: '安全登录' }).click();

  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await expect(page.getByText('系统管理', { exact: true })).toBeVisible();
});

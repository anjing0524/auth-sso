/**
 * 用户角色分配死路回归：用户部门无角色时，空态应直接带部门筛选打开「新建角色」，
 * 且弹窗默认所属部门必须是该用户的部门。
 */
import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123456';

test.describe('用户角色分配空态链路', () => {
  test('部门无角色 → 直达创建角色并预选部门', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN_EMAIL);
    await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: '安全登录' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    await page.goto('/users', { waitUntil: 'networkidle' });
    await page.getByPlaceholder('搜索姓名/邮箱/用户名').fill('qa_lin');
    const row = page.getByRole('row').filter({ hasText: 'qa_lin' });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: /分配角色/ }).click();
    await expect(page).toHaveURL(/\/users\/[0-9a-f-]+\/roles(\?|$)/);
    await expect(page.getByText('该部门下暂无可用角色，请先为部门创建角色')).toBeVisible();

    await page.getByRole('link', { name: /创建角色/ }).click();
    await expect(page).toHaveURL(/\/roles\?deptId=.*&create=1/);
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('combobox')).toContainText('研发部');
    await page.keyboard.press('Escape');
  });
});

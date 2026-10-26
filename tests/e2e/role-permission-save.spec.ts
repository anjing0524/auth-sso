/**
 * 角色权限保存闭环（勾选 → 差异 → 确认 → 刷新持久化 → 还原）。
 * 使用 QA_TEST（基线 0 权限）避免污染内置角色；finally 还原。
 * @req B-ROLE-P, F-ROLE-PERM
 */
import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123456';

test.describe('角色权限保存', () => {
  test('QA_TEST 勾选导出审计权限 → 保存 → 刷新仍勾选 → 取消保存还原', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN_EMAIL);
    await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: '安全登录' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    await page.goto('/roles?keyword=QA_TEST', { waitUntil: 'networkidle' });
    const row = page.getByRole('row').filter({ hasText: 'QA_TEST' });
    await expect(row).toBeVisible();
    await row.getByRole('link', { name: '配置权限 质量测试角色' }).click();
    await expect(page).toHaveURL(/\/roles\/[0-9a-f-]+\/permissions/);

    const permissionCheckbox = page.getByRole('checkbox', { name: /导出审计日志/ });
    await page.getByPlaceholder('搜索当前作用域内权限...').fill('导出审计日志');
    await expect(permissionCheckbox).toBeVisible();
    await expect(permissionCheckbox).not.toBeChecked();

    try {
      await permissionCheckbox.check();
      await expect(page.getByRole('button', { name: /保存变更（1）/ })).toBeVisible();
      await page.getByRole('button', { name: /保存变更（1）/ }).click();
      await expect(page.getByRole('dialog')).toContainText('确认保存权限变更？');
      await page.getByRole('button', { name: '确认保存' }).click();
      await expect(page.getByText(/已更新角色/).first()).toBeVisible({ timeout: 15_000 });

      // 刷新页面后仍保持勾选
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByPlaceholder('搜索当前作用域内权限...').fill('导出审计日志');
      await expect(permissionCheckbox).toBeChecked();

      // 还原：取消勾选并保存
      await permissionCheckbox.uncheck();
      await page.getByRole('button', { name: /保存变更（1）/ }).click();
      await page.getByRole('button', { name: '确认保存' }).click();
      await expect(page.getByText(/已更新角色/).first()).toBeVisible({ timeout: 15_000 });
      await page.reload({ waitUntil: 'networkidle' });
      await page.getByPlaceholder('搜索当前作用域内权限...').fill('导出审计日志');
      await expect(permissionCheckbox).not.toBeChecked();
    } finally {
      // 若中途失败且已勾选，尽量还原
      try {
        if (await permissionCheckbox.isChecked()) {
          await permissionCheckbox.uncheck();
          await page.getByRole('button', { name: /保存变更/ }).click();
          await page.getByRole('button', { name: '确认保存' }).click();
        }
      } catch { /* 尽力还原 */ }
    }
  });
});

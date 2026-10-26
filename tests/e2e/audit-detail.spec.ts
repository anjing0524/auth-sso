import { test, expect } from '@playwright/test';

/**
 * 审计详情链路：列表「眼睛」→ 独立详情页（不是弹窗）。
 * 依据：弹窗内滚动被产品规范禁止；审计证据需可深链/可复制/可返回。
 */
test.describe('审计详情页', () => {
  test('登录/操作/访问日志均从列表进入独立详情页，无弹窗且可返回', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('登录邮箱').fill('admin@example.com');
    await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
    await page.getByRole('button', { name: '安全登录' }).click();
    await page.waitForURL(/dashboard$/);

    await page.goto('/audit-logs?tab=operation', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: '查看日志详情' }).first().click();
    await expect(page).toHaveURL(/\/audit-logs\/[0-9a-f-]{36}\?tab=operation/);
    await expect(page.getByRole('heading', { name: '操作日志详情' })).toBeVisible();
    await expect(page.getByText('请求上下文')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('link', { name: '返回审计日志' }).click();
    await expect(page).toHaveURL(/\/audit-logs\?tab=operation/);

    await page.goto('/audit-logs?tab=login', { waitUntil: 'networkidle' });
    await page.getByRole('link', { name: '查看日志详情' }).first().click();
    await expect(page).toHaveURL(/\/audit-logs\/[0-9a-f-]{36}\?tab=login/);
    await expect(page.getByRole('heading', { name: '登录日志详情' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // 访问日志：第三页签 → 独立详情页（读操作审计）
    await page.goto('/audit-logs?tab=access', { waitUntil: 'networkidle' });
    await expect(page.getByRole('tab', { name: '访问日志' })).toHaveAttribute('aria-selected', 'true');
    await page.getByRole('link', { name: '查看日志详情' }).first().click();
    await expect(page).toHaveURL(/\/audit-logs\/[0-9a-f-]{36}\?tab=access/);
    await expect(page.getByRole('heading', { name: '访问日志详情' })).toBeVisible();
    await expect(page.getByText('访问上下文')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
});

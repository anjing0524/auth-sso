/**
 * E2E: 权限管理 CRUD
 * Permission Management — U10 Layered Test Verification
 *
 * 覆盖权限列表展示、创建新权限码
 *
 * @req D-PRM-L
 * @req D-PRM-C
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin } from './helpers';

test.describe('Permission Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('view permission list with tabs and search', async ({ page }) => {
    await page.goto('/permissions');

    // Verify page title
    await expect(page.getByRole('heading', { name: '权限管理' })).toBeVisible({ timeout: 10_000 });

    // Verify table is rendered
    await expect(page.locator('table')).toBeVisible();

    // Verify table headers
    const headers = ['权限名称', '权限类型', '权限标识 (Code)', '状态'];
    for (const header of headers) {
      await expect(page.locator('table').getByText(header)).toBeVisible();
    }

    // Verify type filter tabs
    await expect(page.getByRole('tab', { name: '全部' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '菜单' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'API' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '数据' })).toBeVisible();

    // Verify search input
    await expect(page.getByPlaceholder('搜索名称或权限标识...')).toBeVisible();

    // Verify "新增权限" button exists
    await expect(page.getByRole('button', { name: '新增权限' })).toBeVisible();

    // Verify seed permissions are present (e.g., user:list)
    await expect(page.locator('code').getByText('user:list').first()).toBeVisible({ timeout: 5_000 });
  });

  test('create new permission code', async ({ page }) => {
    await page.goto('/permissions');

    // Click "新增权限" button
    await page.getByRole('button', { name: '新增权限' }).click();

    // Wait for dialog to appear
    await expect(page.getByText('新增权限标识')).toBeVisible({ timeout: 5_000 });

    // Fill in the permission form
    const permName = `E2E测试权限-${Date.now()}`;
    const permCode = `e2e:test:${Date.now()}`;

    const dialog = page.getByRole('dialog');
    await dialog.getByPlaceholder('例如：删除用户').fill(permName);
    await dialog.getByPlaceholder('例如：user:delete').fill(permCode);

    // By default, type is API which is fine

    // Click confirm create
    await dialog.getByRole('button', { name: '确认创建' }).click();

    // Verify success
    await expect(page.getByText('权限项创建成功')).toBeVisible({ timeout: 5_000 });

    // Verify the new permission appears in the list
    await expect(page.locator('table').getByText(permName)).toBeVisible({ timeout: 5_000 });
  });
});

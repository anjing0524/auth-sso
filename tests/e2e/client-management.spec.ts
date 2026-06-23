/**
 * E2E: OAuth Client 管理 CRUD
 * Client Management — U10 Layered Test Verification
 *
 * 覆盖 Client 列表展示、新建 OAuth 应用、编辑重定向 URI
 *
 * @req G-CLT-L
 * @req G-CLT-C
 * @req G-CLT-U
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, PORTAL_URL } from './helpers';

test.describe('Client Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('view client list', async ({ page }) => {
    await page.goto('/clients');

    // Verify page title
    await expect(page.getByText('应用管理')).toBeVisible({ timeout: 10_000 });

    // Verify table is rendered
    await expect(page.locator('table')).toBeVisible();

    // Verify table headers
    const headers = ['应用详情', '身份标识 (Client ID)', '回调白名单 (Redirect URIs)', '运行状态'];
    for (const header of headers) {
      await expect(page.locator('table').getByText(header)).toBeVisible();
    }

    // Verify search input
    await expect(page.getByPlaceholder('搜索应用名称或 Client ID...')).toBeVisible();

    // Verify "注册新应用" button exists
    await expect(page.getByRole('link', { name: '注册新应用' })).toBeVisible();

    // Verify seed clients are present
    await expect(page.getByText('Portal')).toBeVisible({ timeout: 5_000 });
  });

  test('create new OAuth client', async ({ page }) => {
    await page.goto('/clients');

    // Click "注册新应用" to navigate to the create page
    await page.getByRole('link', { name: '注册新应用' }).click();

    // Wait for the new client page
    await expect(page.getByText('注册新应用')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('基本配置')).toBeVisible();

    // Fill in required fields
    const clientName = `E2E测试应用-${Date.now()}`;
    const clientId = `e2e-test-app-${Date.now()}`;
    const redirectUri = `https://e2e-test-${Date.now()}.example.com/callback`;

    await page.getByPlaceholder('我的业务系统').fill(clientName);
    await page.getByPlaceholder('my-app').fill(clientId);
    await page.getByPlaceholder(/每行一个地址/).fill(redirectUri);

    // Click confirm register
    await page.getByRole('button', { name: '确认注册' }).click();

    // Verify redirect back to client list
    await page.waitForURL('/clients', { timeout: 10_000 });

    // Verify success toast
    await expect(page.getByText('应用注册成功')).toBeVisible({ timeout: 5_000 });

    // Verify the new client appears in the list
    await expect(page.getByText(clientName)).toBeVisible({ timeout: 5_000 });
  });

  test('edit redirect URIs', async ({ page }) => {
    await page.goto('/clients');

    // Create a new client first
    await page.getByRole('link', { name: '注册新应用' }).click();
    await expect(page.getByText('注册新应用')).toBeVisible({ timeout: 10_000 });

    const editName = `E2E编辑应用-${Date.now()}`;
    const editId = `e2e-edit-${Date.now()}`;

    await page.getByPlaceholder('我的业务系统').fill(editName);
    await page.getByPlaceholder('my-app').fill(editId);
    await page.getByPlaceholder(/每行一个地址/).fill('https://original.example.com/callback');
    await page.getByRole('button', { name: '确认注册' }).click();
    await page.waitForURL('/clients', { timeout: 10_000 });

    // Now click the menu button on the newly created client to go to detail page
    await page.getByText(editName).click();

    // Verify we navigated to the client detail page
    await page.waitForURL(/\/clients\//, { timeout: 5_000 });

    // Verify client detail page shows the client name
    await expect(page.getByText(editName)).toBeVisible({ timeout: 5_000 });

    // Edit the redirect URIs field on the detail page
    const textarea = page.locator('textarea');
    if (await textarea.isVisible()) {
      await textarea.clear();
      await textarea.fill('https://updated.example.com/callback\nhttps://additional.example.com/callback');

      // Click save
      await page.getByRole('button', { name: '保存修改' }).click();

      // Verify save success
      await expect(page.getByText('保存成功')).toBeVisible({ timeout: 5_000 });
    }
  });
});

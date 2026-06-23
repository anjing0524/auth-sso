/**
 * E2E: 用户管理 CRUD
 * User Management — U10 Layered Test Verification
 *
 * 覆盖用户管理的增删改查及搜索功能
 *
 * @req B-USR-L
 * @req B-USR-C
 * @req B-USR-S
 * @req B-USR-U
 * @req B-USR-D
 */

import { test, expect } from '@playwright/test';
import { loginAsAdmin, PORTAL_URL } from './helpers';

test.describe('User Management', () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test('list users with table and pagination', async ({ page }) => {
    // Navigate to users page
    await page.goto('/users');

    // Verify page title
    await expect(page.getByText('用户管理')).toBeVisible({ timeout: 10_000 });

    // Verify table is rendered
    await expect(page.locator('table')).toBeVisible();

    // Verify table headers
    const headers = ['用户信息', '部门', '状态', '创建时间'];
    for (const header of headers) {
      await expect(page.locator('table').getByText(header)).toBeVisible();
    }

    // Verify pagination info (should have total records from seed data)
    await expect(page.getByText('TOTAL RECORDS:')).toBeVisible();

    // Verify search input exists
    await expect(page.getByPlaceholder('搜索用户名、邮箱或姓名...')).toBeVisible();

    // Verify "新增用户" button exists
    await expect(page.getByRole('button', { name: '新增用户' })).toBeVisible();
  });

  test('create user via sheet dialog', async ({ page }) => {
    await page.goto('/users');

    // Click the "新增用户" button to open the sheet
    await page.getByRole('button', { name: '新增用户' }).click();

    // Wait for the sheet dialog to appear
    await expect(page.getByText('创建新用户')).toBeVisible({ timeout: 5_000 });

    // Fill in the user form
    const testName = `测试用户-${Date.now()}`;
    const testUsername = `testuser-${Date.now()}`;
    const testEmail = `testuser-${Date.now()}@example.com`;

    // Use placeholder text to locate inputs within the sheet
    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('例如：张三').fill(testName);
    await sheet.getByPlaceholder('例如：zhangsan').fill(testUsername);
    await sheet.getByPlaceholder('zhangsan@example.com').fill(testEmail);

    // Click confirm create button
    await sheet.getByRole('button', { name: '确认创建' }).click();

    // Verify success - sheet should close and user should appear in table
    await expect(page.getByText('创建新用户')).not.toBeVisible({ timeout: 5_000 });

    // Search for the newly created user
    await page.getByPlaceholder('搜索用户名、邮箱或姓名...').fill(testUsername);
    // Wait for table to update
    await page.waitForTimeout(1000);
    await expect(page.locator('table').getByText(testName)).toBeVisible({ timeout: 5_000 });
  });

  test('search user by keyword', async ({ page }) => {
    await page.goto('/users');

    // Search for admin user by email
    const searchInput = page.getByPlaceholder('搜索用户名、邮箱或姓名...');
    await searchInput.fill('admin@example.com');

    // Wait for table update and verify admin user appears
    await page.waitForTimeout(1000);
    await expect(page.locator('table').getByText('admin')).toBeVisible({ timeout: 5_000 });
  });

  test('edit user status via dropdown', async ({ page }) => {
    await page.goto('/users');

    // Find the first user row and toggle its status
    // The action dropdown is identified by the MoreHorizontal button
    const firstUserMenu = page.locator('table').getByRole('button').first();
    await firstUserMenu.click();

    // The dropdown should have "禁用账号" or "恢复账号" option
    // Click the status toggle option
    const toggleOption = page.getByText(/禁用账号|恢复账号/);
    await toggleOption.click();

    // Verify toast notification appears (success message)
    await expect(page.getByText(/用户状态已更新/)).toBeVisible({ timeout: 5_000 });
  });

  test('delete user with confirmation dialog', async ({ page }) => {
    // First create a test user to delete
    await page.goto('/users');

    await page.getByRole('button', { name: '新增用户' }).click();
    await expect(page.getByText('创建新用户')).toBeVisible({ timeout: 5_000 });

    const deleteName = `删除测试-${Date.now()}`;
    const deleteUsername = `deletetest-${Date.now()}`;
    const deleteEmail = `deletetest-${Date.now()}@example.com`;

    const sheet = page.getByRole('dialog');
    await sheet.getByPlaceholder('例如：张三').fill(deleteName);
    await sheet.getByPlaceholder('例如：zhangsan').fill(deleteUsername);
    await sheet.getByPlaceholder('zhangsan@example.com').fill(deleteEmail);
    await sheet.getByRole('button', { name: '确认创建' }).click();

    // Wait for sheet to close
    await expect(page.getByText('创建新用户')).not.toBeVisible({ timeout: 5_000 });

    // Navigate to the user detail page
    await page.goto(`/users?keyword=${deleteUsername}`);
    await page.waitForTimeout(1000);

    // Click on the user row to go to detail page
    // The user name in the table is a link to the detail page
    await page.locator('table').getByText(deleteName).click();
    await page.waitForURL(/\/users\//, { timeout: 5_000 });

    // Click delete button
    await page.getByRole('button', { name: '删除用户' }).click();

    // Confirm deletion in dialog
    await expect(page.getByText('确认永久删除')).toBeVisible({ timeout: 5_000 });
    await page.getByRole('button', { name: '确认删除' }).click();

    // Verify redirect back to users list
    await page.waitForURL('/users', { timeout: 10_000 });
    await expect(page.getByText('用户管理')).toBeVisible();
  });
});

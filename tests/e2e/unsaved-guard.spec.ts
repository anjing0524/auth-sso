import { expect, test } from '@playwright/test';

/**
 * 未保存修改离开守卫：侧栏导航先确认，取消保留输入，确认后离开。
 * @req AUTH-001
 */
test('用户详情未保存时离开需确认', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('登录邮箱').fill('admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
  await page.getByRole('button', { name: '安全登录' }).click();
  await page.waitForURL(/dashboard$/);

  await page.goto('/users/00000000-0000-0000-0000-000000000001', { waitUntil: 'networkidle' });
  const name = page.locator('#user-name');
  const original = await name.inputValue();
  await name.fill(`${original}未保存`);
  await expect(page.getByText('未保存的修改')).toBeVisible();

  await page.getByRole('link', { name: '用户管理' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('离开并放弃未保存的修改？');
  await page.getByRole('button', { name: '继续编辑' }).click();
  await expect(page).toHaveURL(/\/users\/00000000-0000-0000-0000-000000000001$/);
  await expect(name).toHaveValue(`${original}未保存`);

  await page.getByRole('link', { name: '用户管理' }).first().click();
  await page.getByRole('button', { name: '放弃并离开' }).click();
  await expect(page).toHaveURL(/\/users$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('新建应用未保存时离开需确认', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('登录邮箱').fill('admin@example.com');
  await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
  await page.getByRole('button', { name: '安全登录' }).click();
  await page.waitForURL(/dashboard$/);

  await page.goto('/clients/new', { waitUntil: 'networkidle' });
  await page.getByLabel('应用名称').fill('守卫测试应用');
  await page.getByRole('link', { name: '应用管理' }).first().click();
  await expect(page.getByRole('dialog')).toContainText('离开并放弃未保存的修改？');
  await page.getByRole('button', { name: '放弃并离开' }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

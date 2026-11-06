import { expect } from '@playwright/test';
import { test } from './fixture';
import { loginAsAdmin } from './helpers';

/**
 * 试点 2：用户列表与新建用户对话框的语义/布局断言。
 * 只打开对话框不提交，避免 AI 测试污染验收数据。
 */
test('AI 视觉：用户列表与新建用户页面字段完整', async ({ page, aiAssert }) => {
  await loginAsAdmin(page);
  await page.goto('/users');
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('button', { name: '新建用户' })).toBeVisible({ timeout: 15_000 });

  await aiAssert('用户管理页面展示用户表格、搜索框和“新建用户”按钮，表格有表头与数据行');
  await page.getByRole('button', { name: '新建用户' }).click();
  await expect(page).toHaveURL(/\/users\/new$/, { timeout: 15_000 });
  await expect(page.getByLabel('显示名称')).toBeVisible({ timeout: 15_000 });
  await aiAssert('新建用户页面包含显示名称、用户名、电子邮箱、初始密码字段，以及创建和返回入口');
});

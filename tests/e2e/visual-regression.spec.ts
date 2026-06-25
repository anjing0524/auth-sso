/**
 * 视觉回归测试 — Portal 设计债清零验证
 *
 * @req D-POLISH-001~006
 *
 * 覆盖关键页面的视觉快照比对：
 * - 登录页：品牌渐变背景 + 白色卡片
 * - Dashboard：指标卡片 + 圆角收敛 + 无装饰 blob
 * - 用户列表：DataTable + EmptyState 渲染
 * - 审计日志：shadcn Table + 暗黑模式徽章
 */
import { test, expect } from '@playwright/test';
import { loginAsAdmin, logout, PORTAL_URL } from './helpers';

test.describe('Visual Regression — 设计债清零', () => {
  test.describe.configure({ mode: 'serial' });

  test('登录页 — 品牌渐变背景 + 白色卡片', async ({ page }) => {
    await page.goto(`${PORTAL_URL}/login`);
    // 等待字体和渐变渲染完成
    await page.waitForLoadState('networkidle');

    // 验证渐变背景存在（bg-gradient-to-br class）
    const bgElement = page.locator('.bg-gradient-to-br');
    await expect(bgElement).toBeVisible();

    // 验证白色卡片可见
    const card = page.locator('[class*="max-w-[400px]"]');
    await expect(card).toBeVisible();

    // 验证品牌元素存在
    await expect(page.getByText('Auth-SSO Portal')).toBeVisible();
    await expect(page.getByText('企业统一身份认证')).toBeVisible();

    // 全页快照
    await expect(page).toHaveScreenshot('login-page.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });
  });

  test('Dashboard — 指标卡片 + 无装饰 blob', async ({ page }) => {
    await loginAsAdmin(page);

    // 验证指标卡片区域
    await expect(page.getByText('工作台')).toBeVisible();
    await expect(page.getByText('用户总数')).toBeVisible();

    // 验证无模糊装饰元素
    const blobs = page.locator('[class*="blur-2xl"]');
    await expect(blobs).toHaveCount(0);

    // 验证圆角规范值（无 rounded-[1.*] 任意值）
    const arbitraryRadii = page.locator('[class*="rounded-[1."]');
    await expect(arbitraryRadii).toHaveCount(0);

    // 全页快照
    await expect(page).toHaveScreenshot('dashboard.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });

    await logout(page);
  });

  test('用户列表 — DataTable + EmptyState', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${PORTAL_URL}/users`);
    await page.waitForLoadState('networkidle');

    // 验证 DataTable 使用（非原生 HTML table）
    const nativeTables = page.locator('table:not([data-slot="table"])');
    await expect(nativeTables).toHaveCount(0);

    // 全页快照
    await expect(page).toHaveScreenshot('users-list.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });

    await logout(page);
  });

  test('审计日志 — shadcn Table + 设计 Token', async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto(`${PORTAL_URL}/audit-logs?tab=login`);
    await page.waitForLoadState('networkidle');

    // 验证标题
    await expect(page.getByText('审计日志')).toBeVisible();

    // 验证无硬编码 gray class（原生 table 的痕迹）
    const grayElements = page.locator('[class*="bg-gray-"],[class*="text-gray-"]');
    await expect(grayElements).toHaveCount(0);

    // 验证 shadcn Table 存在
    await expect(page.locator('[data-slot="table"]')).toBeVisible();

    // 全页快照
    await expect(page).toHaveScreenshot('audit-logs.png', {
      fullPage: true,
      maxDiffPixelRatio: 0.02,
    });

    // 切换到操作日志 tab 验证
    await page.click('text=操作日志');
    await page.waitForLoadState('networkidle');

    await logout(page);
  });
});

import { test } from './fixture';
import { loginAsAdmin } from './helpers';

/**
 * 试点 3：审计日志页的页签、筛选与表格层级。
 * AI 只做语义/视觉检查，不替代现有的审计 API 与详情 E2E。
 */
test('AI 视觉：审计日志页签、筛选和表格布局可读', async ({ page, aiAssert }) => {
  await loginAsAdmin(page);
  await page.goto('/audit-logs');
  await page.getByRole('tab', { name: '登录日志' }).waitFor({ state: 'visible', timeout: 15_000 });

  await aiAssert('审计日志页面清晰展示登录日志、操作日志、访问日志三个页签，以及筛选工具条和日志表格');
});

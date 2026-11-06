import { expect } from '@playwright/test';
import { test } from './fixture';
import { loginAsAdmin } from './helpers';

/**
 * 试点 1：工作台的 AI 视觉理解。
 *
 * 登录动作本身是认证边界，继续用确定性 Playwright；AI 只断言页面语义与布局，
 * 避免把"输入/点击"这类已确定的契约变成概率测试。
 */
test('AI 视觉：登录后识别工作台语义与主要区域', async ({ page, aiAssert }) => {
  await loginAsAdmin(page);
  await page.waitForLoadState('networkidle');
  await expect(page.getByRole('heading', { name: '工作台' })).toBeVisible({ timeout: 15_000 });
  await aiAssert('当前显示 Auth-SSO 工作台：左侧有系统管理导航，主区域有“工作台”标题和数据概览卡片');
});

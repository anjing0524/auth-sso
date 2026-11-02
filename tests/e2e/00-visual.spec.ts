/**
 * 桌面视觉回归（opt-in：E2E_VISUAL=1）。
 *
 * 覆盖用户要求的关键页面：登录、工作台、用户列表/详情、审计列表/详情、角色权限。
 * 两条视口：1440×900、1280×720。
 *
 * 稳定性策略：
 * - 只跑在 Docker 验收栈的固定种子数据上；
 * - 日期/时间/UUID/User-Agent 用 Playwright mask 盖住（固定灰色），避免时间变化导致假红；
 * - 其余布局（卡片高度、列宽、按钮位置）进入截图基线。
 */
import { test, expect, type Page } from '@playwright/test';

test.skip(process.env.E2E_VISUAL !== '1', '视觉基线只在 E2E_VISUAL=1（Docker Playwright）运行');
test.setTimeout(120_000);

const PASSWORD = 'Admin@123456';
const dynamicMasks = (page: Page) => [
  page.getByText(/\d{4}\/\d{2}\/\d{2}/),
  page.getByText(/\d{2}:\d{2}(:\d{2})?/),
  page.getByText(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i),
  page.getByText(/Mozilla\/5\.0/),
];

async function screenshot(page: Page, name: string) {
  await page.waitForTimeout(200);
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    mask: dynamicMasks(page),
    maskColor: '#e5e7eb',
    maxDiffPixelRatio: 0.01,
  });
}

for (const viewport of [
  { name: '1440', width: 1440, height: 900 },
  { name: '1280', width: 1280, height: 720 },
]) {
  test(`desktop visual ${viewport.name}`, async ({ browser }) => {
    const context = await browser.newContext({
      ignoreHTTPSErrors: true,
      viewport: { width: viewport.width, height: viewport.height },
      colorScheme: 'light',
    });
    const page = await context.newPage();
    const base = process.env.E2E_BASE_URL ?? 'https://127.0.0.1:19443';

    await page.goto(`${base}/login`, { waitUntil: 'networkidle' });
    await screenshot(page, `login-${viewport.name}.png`);

    await page.getByLabel('登录邮箱').fill('admin@example.com');
    await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
    await page.getByRole('button', { name: '安全登录' }).click();
    await page.waitForURL(/\/dashboard$/, { timeout: 60_000 });

    await page.goto(`${base}/dashboard`, { waitUntil: 'networkidle' });
    await screenshot(page, `dashboard-${viewport.name}.png`);

    await page.goto(`${base}/users`, { waitUntil: 'networkidle' });
    await screenshot(page, `users-${viewport.name}.png`);

    const userHref = await page.getByRole('link', { name: /详情/ }).first().getAttribute('href');
    if (!userHref) throw new Error('找不到用户详情链接');
    await page.goto(`${base}${userHref}`, { waitUntil: 'networkidle' });
    await screenshot(page, `user-detail-${viewport.name}.png`);

    await page.goto(`${base}/roles`, { waitUntil: 'networkidle' });
    const permissionHref = await page.locator('a[href^="/roles/"][href*="/permissions"]').first().getAttribute('href');
    if (!permissionHref) throw new Error('找不到角色权限入口');
    await page.goto(`${base}${permissionHref}`, { waitUntil: 'networkidle' });
    await screenshot(page, `role-permissions-${viewport.name}.png`);

    await page.goto(`${base}/audit-logs?tab=login`, { waitUntil: 'networkidle' });
    await screenshot(page, `audit-logs-${viewport.name}.png`);

    const detailHref = await page.locator('a[href^="/audit-logs/"]').first().getAttribute('href');
    if (!detailHref) throw new Error('找不到审计详情链接');
    await page.goto(`${base}${detailHref}`, { waitUntil: 'networkidle' });
    await screenshot(page, `audit-detail-${viewport.name}.png`);

    await context.close();
  });
}

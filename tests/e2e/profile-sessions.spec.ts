/**
 * 个人中心会话闭环：多设备 → 撤销指定会话 → 两台设备的会话列表目标行都消失。
 * @req FR-PROFILE, U-PF02
 */
import { expect, test, type BrowserContext, type Page } from '@playwright/test';

test.setTimeout(120_000);

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123456';

async function login(ctx: BrowserContext): Promise<Page> {
  const page = await ctx.newPage();
  await page.goto('/login');
  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN_EMAIL);
  await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: '安全登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  return page;
}

test.describe('个人中心会话', () => {
  test('撤销最新会话后两台设备的会话列表都消失', async ({ browser }) => {
    const ctx1 = await browser.newContext({ ignoreHTTPSErrors: true });
    const ctx2 = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
      const page1 = await login(ctx1);
      // 第二台设备登录 → 最新会话
      const page2 = await login(ctx2);

      await page1.goto('/profile', { waitUntil: 'networkidle' });
      // 当前设备由 access token sid 与会话行 id 比对得出
      await expect(page1.getByText('当前设备').first()).toBeVisible({ timeout: 15_000 });
      const revokeButtons = page1.getByRole('button', { name: /^撤销会话 / });
      await expect(revokeButtons.first()).toBeVisible({ timeout: 15000 });
      const labels = await revokeButtons.evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? ''));
      expect(new Set(labels).size).toBe(labels.length); // 每行 aria-label 唯一
      const targetLabel = labels[0]!;
      expect(targetLabel).toMatch(/撤销会话 .*（portal · [0-9a-f]{8}）/);
      const shortId = targetLabel.match(/· ([0-9a-f]{8})）$/)?.[1];
      expect(shortId).toBeTruthy();

      // 目标会话同时出现在第二台设备的列表里，并在该设备上标记为“当前设备”
      await page2.goto('/profile', { waitUntil: 'networkidle' });
      await expect(page2.getByText(`#${shortId}`).first()).toBeVisible();
      await expect(page2.getByText('当前设备').first()).toBeVisible();
      await expect(page2.getByRole('button', { name: targetLabel })).toHaveCount(0);

      await revokeButtons.first().click();
      await expect(page1.getByRole('dialog')).toContainText('撤销该会话？');
      await page1.getByRole('button', { name: '确认撤销' }).click();
      await expect(page1.getByText(/已撤销该会话/).first()).toBeVisible({ timeout: 15000 });

      // 刷新后目标行不再出现（即使列表被 10 条上限截断，旧行也不会复现）
      await page1.reload({ waitUntil: 'networkidle' });
      await expect(page1.getByRole('button', { name: targetLabel })).toHaveCount(0);

      // 第二台设备刷新后，目标会话行同样消失（撤销命中该设备；AT 仍可能有效，
      // 因此不断言 refresh 立即 401——refresh 在 AT 剩余 >5min 时会返回 skipped）
      await page2.reload({ waitUntil: 'networkidle' });
      await expect(page2.getByText(`#${shortId}`)).toHaveCount(0);
    } finally {
      await ctx1.request.post('/api/auth/logout', { failOnStatusCode: false }).catch(() => {});
      await ctx2.request.post('/api/auth/logout', { failOnStatusCode: false }).catch(() => {});
      await ctx1.close();
      await ctx2.close();
    }
  });
});

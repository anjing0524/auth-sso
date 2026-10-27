/**
 * 应用注册闭环：填写 → 一次性 Secret → 复制 → 前往列表 → 注销清理。
 * @req F-CLIENT-C, H-C-03
 */
import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123456';

test.describe('应用注册', () => {
  test('注册应用 → Secret 仅一次展示/复制 → 列表注销', async ({ page }) => {
    const suffix = Date.now().toString(36);
    const name = `e2e_app_${suffix}`;
    let clientId: string | null = null;

    await page.goto('/login');
    await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN_EMAIL);
    await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASSWORD);
    await page.getByRole('button', { name: '安全登录' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    try {
      await page.goto('/clients/new', { waitUntil: 'networkidle' });
      await page.getByLabel('应用名称 *').fill(name);
      await page.getByLabel('回调地址（每行一个） *').fill('https://example.com/api/auth/callback');
      // TTL 预设应有选中态（aria-pressed）
      await expect(page.getByRole('button', { name: '1 小时' })).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: '确认注册' }).click();

      const dialog = page.getByRole('dialog');
      await expect(dialog).toContainText('应用注册成功', { timeout: 15_000 });
      const codes = dialog.locator('code');
      clientId = (await codes.nth(0).textContent())?.trim() ?? null;
      const secret = (await codes.nth(1).textContent())?.trim() ?? '';
      expect(clientId).toBeTruthy();
      expect(secret.length).toBeGreaterThan(20);

      await dialog.getByRole('button', { name: '复制 Client Secret' }).click();
      await expect(dialog.getByRole('button', { name: '复制 Client Secret' })).toContainText('已复制');
      await dialog.getByRole('button', { name: '我已保存，前往应用列表' }).click();
      await expect(page).toHaveURL(/\/clients$/, { timeout: 15_000 });

      // 详情页核心操作：禁用 → 启用 → 轮换 Secret → 授权记录
      await page.getByPlaceholder('搜索应用或 Client ID').fill(name);
      await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('row').filter({ hasText: name }).getByRole('link', { name: '编辑 OAuth 配置' }).click();
      await expect(page).toHaveURL(new RegExp(`/clients/${clientId}(\\?|$)`));

      // WAI-ARIA tabs：方向键切换、tabpanel 关联
      const infoTab = page.getByRole('tab', { name: '基本信息' });
      await expect(infoTab).toHaveAttribute('aria-controls', 'client-panel-info');
      await infoTab.focus();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: '授权记录' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'client-tab-tokens');
      await page.keyboard.press('Home');
      await expect(infoTab).toHaveAttribute('aria-selected', 'true');

      // 无改动不可保存；编辑后出现未保存状态，可放弃修改
      await expect(page.getByRole('button', { name: '无修改' })).toBeDisabled();
      await page.locator('#client-detail-name').fill(`${name}2`);
      await expect(page.getByText('未保存的修改')).toBeVisible();
      await expect(page.getByRole('button', { name: '保存修改' })).toBeEnabled();
      await page.getByRole('button', { name: '放弃修改' }).click();
      await expect(page.locator('#client-detail-name')).toHaveValue(name);

      await page.getByRole('button', { name: '禁用', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('切换应用状态？');
      await page.getByRole('button', { name: '确认切换' }).click();
      await expect(page.getByText('应用已禁用').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: '启用', exact: true }).click();
      await expect(page.getByRole('dialog')).toContainText('切换应用状态？');
      await page.getByRole('button', { name: '确认切换' }).click();
      await expect(page.getByText('应用已启用').first()).toBeVisible({ timeout: 15_000 });

      await page.getByRole('button', { name: '重新生成 Secret' }).click();
      await expect(page.getByRole('dialog')).toContainText('重新生成 Client Secret？');
      await page.getByRole('button', { name: '确认重新生成' }).click();
      await expect(page.getByText('新 Secret 已生成，请立即保存（只显示一次）').first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('button', { name: '复制新 Secret' })).toBeVisible();

      await page.getByRole('tab', { name: '授权记录' }).click();
      await expect(page.getByText(/暂无.*Token|暂无授权|暂无记录/).first()).toBeVisible({ timeout: 15_000 });

      await page.goto('/clients', { waitUntil: 'networkidle' });
      await page.getByPlaceholder('搜索应用或 Client ID').fill(name);
      await expect(page.getByRole('row').filter({ hasText: name })).toBeVisible({ timeout: 15_000 });
      await page.getByRole('row').filter({ hasText: name }).getByRole('button', { name: '注销应用' }).click();
      await expect(page.getByRole('dialog')).toContainText(`注销应用「${name}」？`);
      await page.getByRole('button', { name: '确认注销' }).click();
      await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0, { timeout: 15_000 });
      clientId = null; // 已清理
    } finally {
      if (clientId) {
        try {
          await page.goto('/clients', { waitUntil: 'networkidle' });
          await page.getByPlaceholder('搜索应用或 Client ID').fill(name);
          await page.waitForTimeout(400);
          const row = page.getByRole('row').filter({ hasText: name });
          if (await row.count()) {
            await row.getByRole('button', { name: '注销应用' }).click();
            await page.getByRole('button', { name: '确认注销' }).click();
          }
        } catch { /* 尽力清理 */ }
      }
    }
  });
});

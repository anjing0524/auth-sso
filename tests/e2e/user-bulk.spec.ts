/**
 * 用户批量禁用/恢复闭环（列表多选 → 确认 → 状态刷新 → 清理）。
 * @req B-USR-ST, B-USR-U
 */
import { expect, test } from '@playwright/test';

test.setTimeout(120_000);

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123456';

test.describe('用户批量操作', () => {
  test('多选两名用户 → 批量禁用 → 批量恢复 → 删除清理', async ({ browser }) => {
    const suffix = Date.now().toString(36);
    const prefix = `bulk_${suffix}`;
    const password = 'Bulk@123456';
    const ids: string[] = [];
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await ctx.newPage();

    try {
      await page.goto('/login');
      await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN_EMAIL);
      await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: '安全登录' }).click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

      // 创建两名无角色用户（禁用/恢复不依赖角色）
      for (const n of [1, 2]) {
        await page.goto('/users', { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: '新建用户' }).click();
        await page.getByLabel('显示名称').fill(`批量探针${n}`);
        await page.getByLabel('用户名（唯一标识）').fill(`${prefix}_${n}`);
        await page.getByLabel('电子邮箱').fill(`${prefix}_${n}@example.com`);
        await page.getByLabel('初始密码').fill(password);
        await page.getByRole('button', { name: '创建', exact: true }).click();
        await expect(page.getByText(/用户创建成功/)).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(300);
      }

      await page.goto(`/users?keyword=${encodeURIComponent(prefix)}`, { waitUntil: 'networkidle' });
      await expect(page.getByText(`${prefix}_1`)).toBeVisible();
      await expect(page.getByText(`${prefix}_2`)).toBeVisible();
      const detailLinks = page.getByRole('link', { name: '查看详情' });
      // 详情链接带 ?returnTo=...；只取 pathname 末段，避免把查询串当成 ID
      const idFromHref = (href: string) => new URL(href, 'https://127.0.0.1').pathname.split('/').pop()!;
      ids.push(idFromHref((await detailLinks.nth(0).getAttribute('href'))!));
      ids.push(idFromHref((await detailLinks.nth(1).getAttribute('href'))!));

      // 批量禁用：确认弹窗需列出两人
      await page.getByRole('checkbox', { name: /选择用户/ }).nth(0).check();
      await page.getByRole('checkbox', { name: /选择用户/ }).nth(1).check();
      await expect(page.getByText('已选 2 人')).toBeVisible();
      await page.getByRole('button', { name: '批量禁用' }).click();
      await expect(page.getByRole('dialog')).toContainText('批量禁用用户？');
      await expect(page.getByRole('dialog')).toContainText('批量探针1');
      await page.getByRole('button', { name: /确认禁用 2 人/ }).click();
      await expect(page.getByText(/已禁用 2 个用户/).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('row').filter({ hasText: `${prefix}_1` })).toContainText('已禁用');

      // 批量恢复：重新选择当前页两人
      await page.getByRole('checkbox', { name: /选择用户/ }).nth(0).check();
      await page.getByRole('checkbox', { name: /选择用户/ }).nth(1).check();
      await page.getByRole('button', { name: '批量恢复' }).click();
      await expect(page.getByRole('dialog')).toContainText('批量恢复用户？');
      await page.getByRole('button', { name: /确认恢复 2 人/ }).click();
      await expect(page.getByText(/已恢复 2 个用户/).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole('row').filter({ hasText: `${prefix}_1` })).toContainText('正常');

      // 清理：逐个删除（逻辑删除）
      for (const id of ids) {
        await page.goto(`/users/${id}`, { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: '删除用户' }).click();
        await page.getByRole('button', { name: '确认删除' }).click();
        await expect(page).toHaveURL(/\/users$/, { timeout: 15_000 });
      }
      ids.length = 0;
    } finally {
      for (const id of ids) {
        try {
          await page.goto(`/users/${id}`, { waitUntil: 'networkidle' });
          await page.getByRole('button', { name: '删除用户' }).click();
          await page.getByRole('button', { name: '确认删除' }).click();
        } catch { /* 清理尽力而为 */ }
      }
      await ctx.close();
    }
  });
});

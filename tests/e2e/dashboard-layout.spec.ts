/**
 * 工作台布局回归：窄/矮视口下「最近操作」「快捷操作」「需要关注」不得互相覆盖。
 * 背景：flex 容器曾把网格行压到 2px，卡片内容溢出并叠在统计条上。
 */
import { expect, test } from '@playwright/test';

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123456';

async function loginAndOpenDashboard(page: import('@playwright/test').Page, width: number, height: number) {
  await page.setViewportSize({ width, height });
  await page.goto('/login');
  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN_EMAIL);
  await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: '安全登录' }).click();
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
  await page.waitForLoadState('networkidle');
}

test.describe('工作台自适应布局', () => {
  test('900×600：最近操作与快捷操作上下排列，均不覆盖需要关注', async ({ page }) => {
    await loginAndOpenDashboard(page, 900, 600);
    const recent = page.getByText('最近操作', { exact: true }).locator('xpath=ancestor::div[@data-slot="card"]');
    const quick = page.getByText('快捷操作', { exact: true }).locator('xpath=ancestor::div[@data-slot="card"]');
    const attention = page.getByText('按你的部门数据范围统计').locator('xpath=ancestor::div[1]');

    const recentBox = await recent.boundingBox();
    const quickBox = await quick.boundingBox();
    const attentionBox = await attention.boundingBox();
    expect(recentBox).not.toBeNull();
    expect(quickBox).not.toBeNull();
    expect(attentionBox).not.toBeNull();
    expect(quickBox!.y).toBeGreaterThanOrEqual(recentBox!.y + recentBox!.height - 1);
    expect(recentBox!.y + recentBox!.height).toBeLessThanOrEqual(attentionBox!.y + 1);
    expect(quickBox!.y + quickBox!.height).toBeLessThanOrEqual(attentionBox!.y + 1);
  });

  test('1024×500：表格卡与快捷卡不覆盖统计条', async ({ page }) => {
    await loginAndOpenDashboard(page, 1024, 500);
    const recent = page.getByText('最近操作', { exact: true }).locator('xpath=ancestor::div[@data-slot="card"]');
    const quick = page.getByText('快捷操作', { exact: true }).locator('xpath=ancestor::div[@data-slot="card"]');
    const attention = page.getByText('按你的部门数据范围统计').locator('xpath=ancestor::div[1]');

    const recentBox = await recent.boundingBox();
    const quickBox = await quick.boundingBox();
    const attentionBox = await attention.boundingBox();
    expect(recentBox).not.toBeNull();
    expect(quickBox).not.toBeNull();
    expect(attentionBox).not.toBeNull();
    expect(recentBox!.y + recentBox!.height).toBeLessThanOrEqual(attentionBox!.y + 1);
    expect(quickBox!.y + quickBox!.height).toBeLessThanOrEqual(attentionBox!.y + 1);
  });
});

test.describe('列表与弹窗自适应', () => {
  test('1139×500：权限表格内部滚动且分页始终可见', async ({ page }) => {
    await loginAndOpenDashboard(page, 1139, 500);
    await page.goto('/permissions', { waitUntil: 'networkidle' });
    const table = page.getByRole('table', { name: '权限列表' });
    await expect(table).toBeVisible();
    const pagination = page.getByRole('navigation', { name: '分页' });
    await expect(pagination).toBeVisible();
    const paginationBox = await pagination.boundingBox();
    expect(paginationBox).not.toBeNull();
    expect(paginationBox!.y + paginationBox!.height).toBeLessThanOrEqual(500);

    const scrollState = await table.evaluate((el) => {
      const scroll = el.closest('.overflow-auto') as HTMLElement | null;
      return scroll ? { scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight } : null;
    });
    expect(scrollState).not.toBeNull();
    expect(scrollState!.scrollHeight).toBeGreaterThan(scrollState!.clientHeight);
  });

  test('1024×400：新建角色弹窗底部动作仍可见', async ({ page }) => {
    await loginAndOpenDashboard(page, 1024, 400);
    await page.goto('/roles?create=1', { waitUntil: 'networkidle' });
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // 超矮视口：底栏回到滚动流，滚动到底后动作必须可见可点，且不得覆盖字段
    await dialog.evaluate((el) => { el.scrollTop = el.scrollHeight; });
    const create = dialog.getByRole('button', { name: '创建' });
    await expect(create).toBeVisible();
    const box = await create.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(400);
  });
});

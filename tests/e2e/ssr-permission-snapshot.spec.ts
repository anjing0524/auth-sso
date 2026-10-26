/**
 * SSR 权限快照 / 网关存活探针回归
 *
 * 2026-10-22 边界优化：权限上下文由服务端布局经 <PermissionsProvider> 一次传给客户端，
 * 客户端不再为同一份数据请求 /api/me/permissions；受保护按钮应出现在 SSR HTML 中。
 * 同时验证 Gateway 自身 /healthz 不依赖 Portal。
 *
 * @req H-ACL-001, E-GW-HEALTH
 */
import { expect, test } from '@playwright/test';

const ADMIN = { email: 'admin@example.com', password: 'Admin@123456' };

test.describe('SSR 权限快照与网关健康探针', () => {
  test('Gateway /healthz 自身存活探针不依赖 Portal 会话', async ({ request }) => {
    const res = await request.get('/healthz');
    expect(res.status()).toBe(200);
    expect(await res.text()).toBe('ok\n');
    expect(res.headers()['cache-control']).toBe('no-store');
  });

  test('后台不再请求 /api/me/permissions，且受保护按钮在 SSR HTML 中', async ({ page }) => {
    const permissionRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/me/permissions')) permissionRequests.push(req.url());
    });

    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?session_id=/);
    await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN.email);
    await page.getByLabel('密码').fill(ADMIN.password);
    await page.getByRole('button', { name: '安全登录' }).click();
    await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });

    await page.goto('/users');
    await expect(page.getByRole('button', { name: '新建用户' })).toBeVisible();
    expect(permissionRequests, '权限快照应来自服务端布局，客户端不得再发权限 API').toHaveLength(0);

    // 受保护入口已渲染（按钮来自服务端权限快照；不再依赖 /api/me/permissions 返回后才出现）
    const content = await page.content();
    expect(content).toContain('新建用户');
    expect(content).toContain('分配角色');
  });
});

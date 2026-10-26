/**
 * 用户生命周期闭环：建号 → 分配角色 → 邮箱登录 → 审计可追溯 → 删除回收。
 *
 * @req B-USR-C, B-USR-U, B-USR-ST, B-USR-D, FR-USR-10
 *
 * 为什么用唯一后缀：CI 可能重复跑；数据不撞车才能稳定断言。
 * 清理放在 finally：即使中间断言失败也尽量删除测试账号，避免污染验收库。
 */
import { expect, test } from '@playwright/test';

test.setTimeout(90_000);

const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@example.com';
const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'Admin@123456';

test.describe('用户生命周期', () => {
  test('创建用户 → 分配管理员角色 → 邮箱登录 → 审计可追溯 → 删除', async ({ browser }) => {
    const suffix = Date.now().toString(36);
    const username = `e2e_user_${suffix}`;
    const email = `e2e_${suffix}@example.com`;
    const password = 'E2e@123456';

    const adminCtx = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await adminCtx.newPage();
    let userId: string | null = null;

    const loginAdmin = async () => {
      await page.goto('/login');
      await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(ADMIN_EMAIL);
      await page.getByLabel('密码', { exact: true }).fill(ADMIN_PASSWORD);
      await page.getByRole('button', { name: '安全登录' }).click();
      await expect(page).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
    };

    try {
      await loginAdmin();

      // 1. 建号（默认部门=根部门，确保角色候选可见）
      await page.goto('/users', { waitUntil: 'networkidle' });
      await page.getByRole('button', { name: '新建用户' }).click();
      await page.getByLabel('显示名称').fill('E2E 生命周期用户');
      await page.getByLabel('用户名（唯一标识）').fill(username);
      await page.getByLabel('电子邮箱').fill(email);
      await page.getByLabel('初始密码').fill(password);
      await page.getByRole('button', { name: '创建', exact: true }).click();
      await expect(page.getByText(/用户创建成功/)).toBeVisible({ timeout: 15_000 });

      await page.goto(`/users?keyword=${encodeURIComponent(username)}`, { waitUntil: 'networkidle' });
      await expect(page.getByText(username).first()).toBeVisible();
      const detailHref = await page.getByRole('link', { name: '查看详情' }).first().getAttribute('href');
      expect(detailHref).toContain('/users/');
      userId = detailHref!.split('/').pop()!;

      // 2. 分配「系统管理员」角色（有权限，才能登录门户）
      await page.goto(`/users/${userId}/roles`, { waitUntil: 'networkidle' });
      await expect(page.getByText(/仅展示所属部门的启用角色/)).toBeVisible();
      await page.locator('label').filter({ hasText: '系统管理员' }).click();
      await page.getByRole('button', { name: /保存变更/ }).click();
      await page.getByRole('button', { name: '确认保存' }).click();
      await expect(page.getByText(/已更新角色/)).toBeVisible({ timeout: 15_000 });

      // 3. 新用户用「登录邮箱」登录（用户名不是登录凭据）
      const userCtx = await browser.newContext({ ignoreHTTPSErrors: true });
      const userPage = await userCtx.newPage();
      await userPage.goto('/login');
      await userPage.getByLabel(/登录邮箱|账号.*邮箱/i).fill(email);
      await userPage.getByLabel('密码', { exact: true }).fill(password);
      await userPage.getByRole('button', { name: '安全登录' }).click();
      await expect(userPage).toHaveURL(/\/dashboard$/, { timeout: 30_000 });
      await expect(userPage.getByText('Auth-SSO').first()).toBeVisible();
      await userCtx.close();

      // 4. 审计可追溯：登录日志按用户名命中
      await page.goto(`/audit-logs?tab=login&keyword=${encodeURIComponent(username)}`, { waitUntil: 'networkidle' });
      await expect(page.getByText(username).first()).toBeVisible({ timeout: 15_000 });
      await expect(page.getByText('登录成功').first()).toBeVisible();
    } finally {
      // 5. 清理：删除测试用户（即使上面断言失败也尝试）
      try {
        if (userId) {
          await page.goto(`/users/${userId}`, { waitUntil: 'networkidle' });
          await page.getByRole('button', { name: '删除用户' }).click();
          await page.getByRole('button', { name: '确认删除' }).click();
          await expect(page).toHaveURL(/\/users$/, { timeout: 15_000 });
        }
      } catch {
        // 清理失败不掩盖原始断言；测试库会由唯一用户名标识残留数据
      }
      await adminCtx.close();
    }
  });
});

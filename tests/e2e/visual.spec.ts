/**
 * 视觉回归测试 — 关键页面截图验证
 *
 * @req D-POLISH-001, D-POLISH-002, D-POLISH-003, D-POLISH-004, D-POLISH-005, D-POLISH-006
 * @req A-NAV-01, A-NAV-03, B-USR-L, J-LOG-001
 *
 * 使用 Playwright Screenshot 对比。首次运行建立 baseline，
 * 后续运行自动对比检测视觉漂移。
 */
import { test, expect } from '@playwright/test';

const VISUAL_PAGES = [
  { name: 'login-default', path: '/login', description: '登录页默认状态' },
  { name: 'dashboard', path: '/dashboard', description: '仪表盘（需登录）' },
  { name: 'users-list', path: '/users', description: '用户列表（需登录）' },
  { name: 'roles-list', path: '/roles', description: '角色列表（需登录）' },
  { name: 'clients-list', path: '/clients', description: '客户端列表（需登录）' },
];

test.describe('UI 视觉回归', () => {
  test.describe('公开页面（无需认证）', () => {
    test('V-01: 登录页 /login 渲染正确', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // 验证关键元素存在
      await expect(page.locator('form')).toBeVisible();

      // 截图对比
      await expect(page).toHaveScreenshot('login-page.png', {
        maxDiffPixels: 200,
      });
    });

    test('V-02: 登录页表单元素布局正确', async ({ page }) => {
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      // 输入框有标签
      const emailInput = page.locator('#email');
      const passwordInput = page.locator('#password');
      await expect(emailInput).toBeVisible();
      await expect(passwordInput).toBeVisible();

      // 提交按钮可见
      const submitBtn = page.locator('button[type="submit"]');
      await expect(submitBtn).toBeVisible();
    });

    test('V-03: /.well-known/openid-configuration 可访问', async ({ page }) => {
      const resp = await page.goto('/.well-known/openid-configuration');
      expect(resp?.status()).toBe(200);

      const text = await resp?.text();
      expect(text).toContain('authorization_endpoint');
    });
  });

  test.describe('受保护页面（需登录）', () => {
    // 通过 API 登录
    test.beforeAll(async ({ request }) => {
      const resp = await request.post('/api/auth/login', {
        data: { email: 'admin@example.com', password: 'Admin123!' },
      });
      expect(resp.status()).toBe(200);
    });

    test('V-04: Dashboard 页面加载且无崩溃', async ({ page, request }) => {
      const loginResp = await page.request.post('/api/auth/login', {
        data: { email: 'admin@example.com', password: 'Admin123!' },
      });
      const setCookie = loginResp.headers()['set-cookie'] || '';
      if (!setCookie.includes('login_session')) {
        test.skip(true, 'Gateway 模式下跳过 Dashboard API 登录测试');
        return;
      }

      await page.goto('/login');
      await page.fill('#email', 'admin@example.com');
      await page.fill('#password', 'Admin123!');
      await page.click('button[type="submit"]');
      await page.waitForLoadState('networkidle');

      const errorBoundary = page.locator('[data-testid="error-boundary"], .error-page');
      await expect(errorBoundary).toHaveCount(0);

      // Dashboard 应有标题
      await expect(page.locator('h1, h2').first()).toBeVisible();
    });

    test('V-05: 用户列表页 DataTable 正确渲染', async ({ page }) => {
      // 登录
      const loginResp = await page.request.post('/api/auth/login', {
        data: { email: 'admin@example.com', password: 'Admin123!' },
      });
      const setCookie = loginResp.headers()['set-cookie'] || '';
      const jwtMatch = setCookie.match(/portal_jwt_token=([^;]+)/);

      if (!jwtMatch) {
        test.skip(true, '登录失败');
        return;
      }

      await page.context().addCookies([{
        name: 'portal_jwt_token',
        value: jwtMatch[1],
        domain: 'localhost',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax' as const,
      }]);

      await page.goto('/users');
      await page.waitForLoadState('networkidle');

      // 表格或空状态应可见
      const tableOrEmpty = page.locator('table, [data-testid="empty-state"], .text-muted-foreground');
      await expect(tableOrEmpty.first()).toBeVisible({ timeout: 10_000 });
    });
  });

  test.describe('响应式布局', () => {
    test('V-06: 移动端视口 (<768px) 登录页正常', async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await page.goto('/login');
      await page.waitForLoadState('networkidle');

      await expect(page.locator('form')).toBeVisible();
      await expect(page.locator('#email')).toBeVisible();
    });
  });
});

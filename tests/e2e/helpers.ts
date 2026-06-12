/**
 * E2E 测试共享辅助函数
 * Shared helpers for Playwright E2E tests
 *
 * 提供可复用的 Page Object 模式：登录/登出/用户创建
 * 测试凭证与 seed 数据一致（scripts/seed-v2.ts）
 */

import { Page, expect } from '@playwright/test';

// ─── 测试凭证 ─────────────────────────────────────────
export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'Admin@123456';

export const RESTRICTED_USER = {
  username: 'viewer',
  email: 'viewer@example.com',
  password: 'Viewer@123456',
  name: '查看者',
};

// ─── 服务 URL ─────────────────────────────────────────
export const PORTAL_URL = 'http://127.0.0.1:4100';
export const DEMO_APP_URL = 'http://127.0.0.1:4102';

// ─── 登录 / 登出 辅助函数 ────────────────────────────

/**
 * 以管理员身份完成完整的 OAuth 登录流程
 *
 * Flow:
 *   Portal /login → 点击 SSO 登录 → Portal OAuth authorize →
 *   Portal /sign-in → 填写凭证 → 提交 → Portal 授权 →
 *   Portal callback → Portal /dashboard
 */
export async function loginAsAdmin(page: Page): Promise<void> {
  await loginAsUser(page, ADMIN_EMAIL, ADMIN_PASSWORD);
}

/**
 * 以指定凭据完成 OAuth 登录
 */
export async function loginAsUser(page: Page, email: string, password: string): Promise<void> {
  // 1. 打开 Portal 登录页
  await page.goto('/login');
  await expect(page.getByText('使用统一身份登录')).toBeVisible({ timeout: 10_000 });

  // 2. 点击 SSO 登录按钮，触发 OAuth 跳转
  await page.click('a[href="/api/auth/login"]');

  // 3. 等待重定向到 Portal 登录页
  //    Better Auth 未登录时会将请求转为 /sign-in 页面
  await page.waitForURL(/\/sign-in/, { timeout: 20_000 });

  // 4. 填写登录表单
  await page.fill('#email', email);
  await page.fill('#password', password);

  // 5. 提交表单 —— 表单使用 fetch + window.location.href 跳转
  await page.click('button[type="submit"]');

  // 6. 等待最终跳转到 Portal dashboard（成功标志）
  await page.waitForURL(/\/dashboard/, { timeout: 25_000 });
}

/**
 * 登出当前用户
 *
 * 调用 Portal GET /api/auth/logout 清除 Portal Session，
 * 随后重定向到 Portal sign-in（SSO 登出）
 */
export async function logout(page: Page): Promise<void> {
  await page.goto('/api/auth/logout');
  // 登出后会被重定向到 Portal sign-in 页
  await page.waitForURL(/\/sign-in/, { timeout: 15_000 });
}

/**
 * 清除浏览器上下文中的所有 cookies（模拟全新未登录用户）
 */
export async function clearAllCookies(page: Page): Promise<void> {
  const context = page.context();
  await context.clearCookies();
}

// ─── API 辅助函数 ─────────────────────────────────────

/**
 * 创建受限角色和用户
 * 需要已在 browser context 中以管理员身份登录（page.request 共享 cookies）
 *
 * 返回 { email, password, userId, roleId, rolePublicId }
 */
export async function createRestrictedRoleAndUser(page: Page): Promise<{
  email: string;
  password: string;
  userId: string;
  roleId: string;
}> {
  const request = page.request();

  // 1. 获取现有权限列表，找到 user:list 权限 ID
  const permsRes = await request.get(`${PORTAL_URL}/api/permissions`);
  expect(permsRes.ok()).toBeTruthy();
  const permsData = (await permsRes.json()) as { data: Array<{ id: string; code: string }> };
  const userListPerm = permsData.data.find((p) => p.code === 'user:list');
  expect(userListPerm, 'user:list 权限必须存在于 seed 数据中').toBeDefined();

  // 2. 创建受限角色（code != ADMIN/SUPER_ADMIN，避免超级管理员绕过）
  const roleRes = await request.post(`${PORTAL_URL}/api/roles`, {
    data: { name: '查看者', code: 'VIEWER', dataScopeType: 'SELF' },
  });
  expect(roleRes.ok()).toBeTruthy();
  const roleBody = (await roleRes.json()) as { data: { id: string } };
  const roleId = roleBody.data.id;

  // 3. 仅赋予 user:list 权限
  const permAssignRes = await request.post(
    `${PORTAL_URL}/api/roles/${roleId}/permissions`,
    { data: { permissionIds: [userListPerm.id] } },
  );
  expect(permAssignRes.ok()).toBeTruthy();

  // 4. 创建受限用户
  const userRes = await request.post(`${PORTAL_URL}/api/users`, {
    data: {
      username: RESTRICTED_USER.username,
      email: RESTRICTED_USER.email,
      password: RESTRICTED_USER.password,
      name: RESTRICTED_USER.name,
    },
  });
  expect(userRes.ok()).toBeTruthy();
  const userBody = (await userRes.json()) as { data: { id: string } };
  const userId = userBody.data.id;

  // 5. 将受限角色分配给该用户
  const roleAssignRes = await request.post(
    `${PORTAL_URL}/api/users/${userId}/roles`,
    { data: { roleIds: [roleId] } },
  );
  expect(roleAssignRes.ok()).toBeTruthy();

  return {
    email: RESTRICTED_USER.email,
    password: RESTRICTED_USER.password,
    userId,
    roleId,
  };
}

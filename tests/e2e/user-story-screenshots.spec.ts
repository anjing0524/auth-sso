import { test, expect } from '@playwright/test';
import path from 'path';
import { loginAsUser, logout, clearAllCookies } from './helpers';

/**
 * 用户故事截图测试
 *
 * @req H-FLOW-001, H-FLOW-002, H-FLOW-003, H-FLOW-004
 * @req H-AUTH-001, H-AUTH-002, H-AUTH-005, H-AUTH-006
 * @req B-USR-L, B-USR-C
 */

// 截图保存路径
const SCREENSHOT_DIR = '/Users/liushuo/.gemini/antigravity-cli/brain/3c5d860b-2ddb-4662-8d17-d2f8d9036798';

// 覆盖默认配置，访问网关的 HTTPS 端口（18443），并忽略自签名证书错误
test.use({
  baseURL: 'https://localhost:18443',
  ignoreHTTPSErrors: true,
});

test.describe('Auth-SSO User Stories Verification', () => {
  
  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`));
    page.on('pageerror', err => console.error(`[BROWSER ERROR] ${err.message}`));
    // 确保每次测试都是全新的未登录状态
    await clearAllCookies(page);
  });

  // ---------------------------------------------------------------------------
  // 场景 1：张三（SUPER_ADMIN 超级管理员）
  // ---------------------------------------------------------------------------
  test('Scenario 1: Super Admin ZhangSan', async ({ page }) => {
    // US-H-AUTH-01 & 02: 访问受保护页面重定向到登录页并登录
    console.log('Logging in as Zhang San (Super Admin)...');
    await loginAsUser(page, 'zhangsan@example.com', 'Test@123456');

    // US-A-01: 侧边栏根据权限动态渲染（超级管理员应看到所有菜单项）
    console.log('Verifying Super Admin sidebar...');
    // 等待侧边栏渲染出来
    await page.waitForSelector('nav', { timeout: 10000 });
    
    // 截屏侧边栏及工作台
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_a_01_super_admin_sidebar.png'),
      fullPage: false
    });

    // US-B-01: 超级管理员查看全部用户列表
    console.log('Navigating to user management...');
    await page.click('text=用户管理');
    await page.waitForURL(/\/admin\/users/, { timeout: 10000 });
    await page.waitForSelector('table', { timeout: 10000 });
    
    // 截图完整用户列表
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_b_01_super_admin_user_list.png'),
    });

    // US-B-06: 实时搜索用户（输入"赵"）
    console.log('Searching for "赵"...');
    const searchInput = page.locator('input[placeholder*="搜索"], input[placeholder*="用户名/邮箱"]');
    if (await searchInput.count() > 0) {
      await searchInput.fill('赵');
      // 等待 debounce 300ms 以及过滤数据渲染
      await page.waitForTimeout(1000);
      // 截图搜索过滤结果
      await page.screenshot({
        path: path.join(SCREENSHOT_DIR, 'us_b_06_user_search_zhao.png'),
      });
      // 清空输入框以防影响后续操作
      await searchInput.fill('');
      await page.waitForTimeout(500);
    } else {
      console.warn('Search input not found, skipping screenshot for search.');
    }

    // US-C-01: 角色管理列表
    console.log('Navigating to role management...');
    await page.click('text=角色管理');
    await page.waitForURL(/\/admin\/roles/, { timeout: 10000 });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_c_01_role_management_list.png'),
    });

    // US-D-01: 权限管理列表
    console.log('Navigating to permission management...');
    await page.click('text=权限管理');
    await page.waitForURL(/\/admin\/permissions/, { timeout: 10000 });
    await page.waitForSelector('table, [class*="card"]', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_d_01_permission_registry_list.png'),
    });

    // US-F-01: 部门管理（组织架构树）
    console.log('Navigating to department management...');
    await page.click('text=部门管理');
    await page.waitForURL(/\/admin\/departments/, { timeout: 10000 });
    await page.waitForSelector('text=干了科技', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_f_01_department_organization_tree.png'),
    });

    // US-G-01: 客户端管理列表
    console.log('Navigating to client management...');
    await page.click('text=客户端管理');
    await page.waitForURL(/\/admin\/clients/, { timeout: 10000 });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_g_01_client_management_list.png'),
    });
  });

  // ---------------------------------------------------------------------------
  // 场景 2：赵六（EMPLOYEE 普通员工）
  // ---------------------------------------------------------------------------
  test('Scenario 2: Employee ZhaoLiu', async ({ page }) => {
    console.log('Logging in as Zhao Liu (Employee)...');
    await loginAsUser(page, 'zhaoliu@example.com', 'Test@123456');

    // US-A-02: 侧边栏仅展示“仪表盘”且隐藏其他项
    console.log('Verifying Employee sidebar...');
    await page.waitForSelector('nav', { timeout: 10000 });
    
    // 截屏侧边栏，可见菜单应该明显少于超级管理员
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_a_02_employee_sidebar_dashboard_only.png'),
    });

    // US-B-04: 普通员工仅在用户列表中查看自己
    // 赵六虽然没有用户管理菜单，但在 API 级别他仍然能访问自己的数据 scope
    // 如果他强行访问用户管理页面 /admin/users
    console.log('Navigating directly to users page...');
    await page.goto('/admin/users');
    await page.waitForTimeout(2000);
    // 截图用户列表（应该只有他自己，或者显示 403 页面，取决于 RBAC 设置。按照 US-B-04 验收标准：列表仅展示赵六本人）
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_b_04_employee_view_self_only.png'),
    });
  });

  // ---------------------------------------------------------------------------
  // 场景 3：吴九（无角色员工）
  // ---------------------------------------------------------------------------
  test('Scenario 3: No-Role User WuJiu', async ({ page }) => {
    console.log('Logging in as Wu Jiu (No-role)...');
    await loginAsUser(page, 'wujiu@example.com', 'Test@123456');

    // US-A-03: 无角色用户看到空侧边栏和提示信息
    console.log('Verifying No-role page content...');
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_a_03_no_role_empty_sidebar.png'),
    });
  });

  // ---------------------------------------------------------------------------
  // 场景 4：周八（AUDIT_VIEWER 审计员）
  // ---------------------------------------------------------------------------
  test('Scenario 4: Audit Viewer ZhouBa', async ({ page }) => {
    console.log('Logging in as Zhou Ba (Audit Viewer)...');
    await loginAsUser(page, 'zhouba@example.com', 'Test@123456');

    // US-AUDIT-01: 查看审计日志
    console.log('Navigating to audit logs...');
    await page.click('text=审计日志');
    await page.waitForURL(/\/admin\/audit/, { timeout: 10000 });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_audit_01_audit_log_viewer.png'),
    });

    // US-AUDIT-03: 查看登录日志
    console.log('Navigating to login logs...');
    await page.click('text=登录日志');
    await page.waitForURL(/\/admin\/login-logs/, { timeout: 10000 });
    await page.waitForSelector('table', { timeout: 10000 });
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_audit_03_login_log_viewer.png'),
    });
  });

  // ---------------------------------------------------------------------------
  // 场景 5：陈十（DISABLED 禁用账户）
  // ---------------------------------------------------------------------------
  test('Scenario 5: Disabled User ChenShi', async ({ page }) => {
    console.log('Attempting to log in as Disabled User Chen Shi...');
    await page.goto('/login');
    await page.waitForSelector('#email', { timeout: 10000 });
    await page.fill('#email', 'chenshi@example.com');
    await page.fill('#password', 'Test@123456');
    await page.click('button[type="submit"]');
    
    // 等待并截图显示登录失败的提示信息（优先于角色校验，提示被禁用）
    await page.waitForTimeout(2000);
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_b_12_disabled_user_login_blocked.png'),
    });
  });

  // ---------------------------------------------------------------------------
  // 场景 6：安全拦截（未授权客户端访问拦截）
  // ---------------------------------------------------------------------------
  test('Scenario 6: SSO Block - Unauthorized Client', async ({ page }) => {
    // US-G-05: 角色未授权应用强拦截
    // 我们让赵六去登录 ERP 应用（其 clientId 为 erp-app，redirectUri 为 https://erp.example.com/callback）
    // OIDC 授权请求格式：/api/auth/oauth2/authorize?client_id=erp-app&redirect_uri=https://erp.example.com/callback&response_type=code&scope=openid+profile+email&state=123
    console.log('Navigating to unauthorized OIDC authorize URL...');
    const authUrl = '/api/auth/oauth2/authorize?client_id=erp-app&redirect_uri=https%3A%2F%2Ferp.example.com%2Fcallback&response_type=code&scope=openid+profile+email&state=123';
    
    // 先用赵六登录 Portal，再请求 authorize
    await loginAsUser(page, 'zhaoliu@example.com', 'Test@123456');
    await page.goto(authUrl);
    await page.waitForTimeout(2000);
    
    // 截图应该显示“没有权限访问该应用”的警告或错误页面
    await page.screenshot({
      path: path.join(SCREENSHOT_DIR, 'us_g_05_unauthorized_client_blocked.png'),
    });
  });

});

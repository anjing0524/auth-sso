#!/usr/bin/env node
/**
 * UX 量化审计脚本（本地验收栈）
 *
 * 用途：给产品/设计决策提供参数——页面 chrome 占比、可见行数、页面级滚动、
 * 控件高度、表头吸顶、弹窗是否溢出。**不是**视觉回归工具，也不进 CI 门禁。
 *
 * 用法：
 *   node scripts/ux/measure.mjs                    # 输出 Markdown
 *   BASE_URL=... ADMIN_EMAIL=... ADMIN_PASSWORD=... node scripts/ux/measure.mjs
 *
 * 前置：验收栈已启动（`docker compose -f docker/compose/test.yml up -d --wait --wait-timeout 600` 或 docker compose test.yml up）。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.BASE_URL ?? 'https://127.0.0.1:19443';
const EMAIL = process.env.ADMIN_EMAIL ?? 'admin@example.com';
const PASSWORD = process.env.ADMIN_PASSWORD ?? 'Admin@123456';
const VIEWPORTS = [
  { width: 1512, height: 800 },
  { width: 1512, height: 700 },
  { width: 1139, height: 600 },
  { width: 390, height: 844 },
];
const ROUTES = [
  '/dashboard',
  '/users',
  '/roles',
  '/permissions',
  '/departments',
  '/clients',
  '/audit-logs',
  '/profile',
];

const round = (n) => (n == null ? '-' : Math.round(n));

/** 页面级度量（不含内部表格滚动） */
async function measurePage(page) {
  return page.evaluate(() => {
    const doc = document.scrollingElement;
    const main = document.querySelector('#main-content') ?? document.querySelector('main');
    // 主内容区自身是滚动容器（main overflow-hidden，内层 div overflow-auto）；
    // 只查 document 会漏掉内容溢出，导致"无页面滚动"假绿。
    const content = main?.firstElementChild;
    const row = document.querySelector('tbody tr');
    const rowTop = row ? row.getBoundingClientRect().top : null;
    const rows = [...document.querySelectorAll('tbody tr')].filter((tr) => {
      const r = tr.getBoundingClientRect();
      return r.height > 0 && r.bottom <= innerHeight + 1;
    }).length;
    const toolbarInput = document.querySelector('[data-slot=card] input, main input');
    const toolbarBtn = [...document.querySelectorAll('main button')].find((b) => b.getBoundingClientRect().height >= 28);
    const th = document.querySelector('th');
    return {
      docScroll: doc ? doc.scrollHeight > innerHeight + 1 : false,
      mainScroll: main ? main.scrollHeight > main.clientHeight + 1 : false,
      contentScroll: content ? content.scrollHeight > content.clientHeight + 1 : false,
      docOverflowX: doc ? doc.scrollWidth > innerWidth + 1 : false,
      chromePct: rowTop == null ? null : Math.round((rowTop / innerHeight) * 100),
      visibleRows: rows,
      inputH: toolbarInput ? Math.round(toolbarInput.getBoundingClientRect().height) : null,
      btnH: toolbarBtn ? Math.round(toolbarBtn.getBoundingClientRect().height) : null,
      thSticky: th ? getComputedStyle(th).position : null,
    };
  });
}

/** 表格滚动 120px 后表头是否仍固定在容器顶 */
async function measureSticky(page) {
  return page.evaluate(() => {
    const scroller = document.querySelector('[data-slot=table-container]')?.parentElement;
    const th = document.querySelector('th');
    if (!scroller || !th) return null;
    const before = Math.round(th.getBoundingClientRect().top);
    scroller.scrollTop = 120;
    const after = Math.round(th.getBoundingClientRect().top);
    return { before, after, sticky: Math.abs(before - after) <= 2 };
  });
}

/** 打开指定按钮触发的弹窗，量是否超出视口 */
async function measureDialog(page, buttonName) {
  try {
    await page.getByRole('button', { name: buttonName }).first().click({ timeout: 2000 });
    await page.waitForTimeout(200);
    const info = await page.evaluate(() => {
      const d = document.querySelector('[role=dialog]');
      if (!d) return null;
      const r = d.getBoundingClientRect();
      const footerButtons = [...d.querySelectorAll('button')].map((b) => b.getBoundingClientRect().bottom);
      return {
        height: Math.round(r.height),
        bottom: Math.round(r.bottom),
        fits: r.bottom <= innerHeight + 1 && r.top >= -1,
        footerVisible: footerButtons.length === 0 ? true : Math.max(...footerButtons) <= innerHeight + 1,
        overflowY: getComputedStyle(d).overflowY,
      };
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(120);
    return info;
  } catch {
    return null;
  }
}

const results = [];
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome' });

for (const vp of VIEWPORTS) {
  const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: vp });
  const page = await context.newPage();

  // 未登录：登录页
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  const login = await page.evaluate(() => ({
    scroll: document.scrollingElement.scrollHeight > innerHeight + 1,
    scrollH: document.scrollingElement.scrollHeight,
    innerH: innerHeight,
    loginBtnVisible: [...document.querySelectorAll('button')].some((b) => b.textContent?.includes('安全登录') && b.getBoundingClientRect().bottom <= innerHeight + 1),
  }));
  results.push({ viewport: `${vp.width}x${vp.height}`, route: '/login（未登录）', ...login });

  await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(EMAIL);
  await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: '安全登录' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30000 });

  for (const route of ROUTES) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const m = await measurePage(page);
    const sticky = route === '/roles' ? await measureSticky(page) : null;
    results.push({ viewport: `${vp.width}x${vp.height}`, route, ...m, sticky: sticky ? sticky.sticky : null });
  }

  // 详情/表单页（从列表取真实 ID）
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
  const userHref = await page.locator('a[aria-label="查看详情"]').first().getAttribute('href').catch(() => null);
  await page.goto(`${BASE}/roles`, { waitUntil: 'networkidle' });
  const permHref = await page.locator('a[aria-label*="配置权限"]').first().getAttribute('href').catch(() => null);
  for (const route of ['/permissions/new', '/clients/new', userHref, permHref, '/users/' + (userHref?.split('/')[2] ?? '') + '/roles']) {
    if (!route || route.includes('undefined')) continue;
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const m = await measurePage(page);
    results.push({ viewport: `${vp.width}x${vp.height}`, route, ...m, sticky: null });
  }

  // 弹窗抽检（600px 高为主）
  if (vp.height <= 700) {
    await page.goto(`${BASE}/roles`, { waitUntil: 'networkidle' });
    const d1 = await measureDialog(page, /新建角色/);
    await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
    const d2 = await measureDialog(page, /新建用户/);
    await page.goto(`${BASE}/permissions`, { waitUntil: 'networkidle' });
    const d3 = await measureDialog(page, /删除权限/);
    results.push({ viewport: `${vp.width}x${vp.height}`, route: 'dialog:roles-create', ...(d1 ?? {}) });
    results.push({ viewport: `${vp.width}x${vp.height}`, route: 'dialog:users-create', ...(d2 ?? {}) });
    results.push({ viewport: `${vp.width}x${vp.height}`, route: 'dialog:permissions-delete', ...(d3 ?? {}) });
  }

  await context.close();
}
await browser.close();

// ── Markdown 输出 ──
const lines = [];
lines.push('| 视口 | 路由 | 页面滚动 | 横向溢出 | chrome% | 可见行 | 控件高(输入/按钮) | 表头吸顶 |');
lines.push('|---|---|---|---|---|---|---|---|');
for (const r of results) {
  lines.push(
    `| ${r.viewport} | \`${r.route}\` | ${r.docScroll ? '**有**' : '无'} | ${r.contentScroll ? '**有**' : '无'} | ${r.docOverflowX ? '**有**' : '无'} | ${round(r.chromePct)} | ${round(r.visibleRows)} | ${round(r.inputH)}/${round(r.btnH)} | ${r.sticky === true ? '✓' : r.sticky === false ? '✗' : '-'} |`,
  );
}
const dialogs = results.filter((r) => r.route.startsWith('dialog:') && r.height != null);
lines.push('', '**弹窗（600/700px 高）**', '', '| 视口 | 弹窗 | 高度 | 是否完整在视口内 | 底部操作可见 | overflowY |', '|---|---|---|---|---|---|');
for (const r of dialogs) {
  lines.push(`| ${r.viewport} | ${r.route} | ${r.height} | ${r.fits ? '✓' : '✗ 溢出'} | ${r.footerVisible ? '✓' : '✗'} | ${r.overflowY} |`);
}
console.log(lines.join('\n'));

import { chromium } from '@playwright/test';

const BASE = 'https://127.0.0.1:19443';
const ADMIN = { email: 'admin@example.com', password: 'Admin@123456' };
const USER_ID = '00000000-0000-0000-0000-000000000001';
const routes = [
  '/dashboard', '/users', '/users/new', `/users/${USER_ID}`, '/roles', '/permissions',
  '/departments', '/clients', '/clients/portal', '/clients/new', '/permissions/new',
  '/audit-logs?tab=login', '/audit-logs?tab=operation', '/audit-logs?tab=access', '/profile',
  '/login', '/nonexistent', '/users/00000000-0000-0000-0000-0000000000ff', '/clients/unknown',
];
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 720 },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const results = [];
for (const vp of viewports) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: vp.width, height: vp.height } });
  const page = await ctx.newPage();
  const errors = [];
  const failed = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('requestfailed', r => failed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`));
  page.on('response', r => { if (r.status() >= 500) failed.push(`${r.status()} ${r.url()}`); });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `/tmp/ui-audit-${vp.name}-login.png` });

  // 错误密码必须给出可读错误，不能只留空白/崩溃
  await page.getByLabel('登录邮箱').fill(ADMIN.email);
  await page.getByLabel('密码', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: '安全登录' }).click();
  await page.waitForTimeout(1000);
  const loginErrorVisible = await page.getByText(/密码|错误|失败/).first().isVisible().catch(() => false);
  if (!loginErrorVisible) errors.push('login: 错误密码后未显示可读错误');
  await page.screenshot({ path: `/tmp/ui-audit-${vp.name}-login-error.png` });

  await page.getByLabel('密码', { exact: true }).fill(ADMIN.password);
  await page.getByRole('button', { name: '安全登录' }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 60000 });

  for (const route of routes) {
    const pageErrors = [];
    const pageFailed = [];
    const onErr = e => pageErrors.push(`pageerror: ${e.message}`);
    const onConsole = m => { if (m.type() === 'error') pageErrors.push(`console: ${m.text()}`); };
    const onReqFail = r => pageFailed.push(`${r.method()} ${r.url()} ${r.failure()?.errorText ?? ''}`);
    const onResp = r => { if (r.status() >= 500) pageFailed.push(`${r.status()} ${r.url()}`); };
    page.on('pageerror', onErr); page.on('console', onConsole); page.on('requestfailed', onReqFail); page.on('response', onResp);
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const vw = window.innerWidth;
      const ignoredAncestor = (el) => {
        for (let p = el.parentElement; p; p = p.parentElement) {
          const s = getComputedStyle(p);
          if (['auto', 'scroll', 'hidden', 'clip'].includes(s.overflowX) && p !== document.body) return true;
        }
        return false;
      };
      const offenders = [];
      for (const el of document.querySelectorAll('body *')) {
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        if (r.width <= 0 || r.height <= 0 || s.visibility === 'hidden' || s.display === 'none') continue;
        if (r.right > vw + 1 || r.left < -1) {
          if (ignoredAncestor(el)) continue;
          offenders.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0,2).join('.')} [${Math.round(r.left)},${Math.round(r.right)}]`);
          if (offenders.length >= 6) break;
        }
      }
      return { scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth, offenders };
    });
    const shot = `/tmp/ui-audit-${vp.name}-${route.replace(/[/?=&]/g, '_')}.png`;
    await page.screenshot({ path: shot, fullPage: false });
    results.push({ viewport: vp.name, route, layout, errors: pageErrors, failed: pageFailed, shot });
    page.off('pageerror', onErr); page.off('console', onConsole); page.off('requestfailed', onReqFail); page.off('response', onResp);
  }
  results.push({ viewport: vp.name, loginErrors: errors, loginFailed: failed });
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify(results, null, 2));

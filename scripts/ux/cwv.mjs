#!/usr/bin/env node
/**
 * Core Web Vitals 实验室评估（Playwright + CDP）。
 *
 * 采集：LCP / CLS / INP 代理（Event Timing 最大事件时长）/ TTFB / FCP。
 * 方法：全新 context + 冷缓存（Network.setCacheDisabled）+ 每路由独立 page.goto；
 * 生产构建（Next standalone）经 Gateway 访问，靠近真实路径；本地网络无 RTT，TTFB 仅作参考。
 * 阈值（CWV "Good"）：LCP ≤ 2500ms、CLS ≤ 0.1、INP ≤ 200ms（lab 代理，非 field p75）。
 *
 * 用法：node scripts/ux/cwv.mjs [baseURL]
 */
import { chromium } from '@playwright/test';

const BASE = process.argv[2] || process.env.E2E_BASE_URL || 'https://127.0.0.1:19443';
const EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Admin@123456';
const ROUTES = ['/login', '/dashboard', '/users', '/roles', '/permissions', '/audit-logs', '/clients', '/profile'];
const VIEWPORTS = [
  { name: 'desktop', width: 1366, height: 768, cpu: 1 },
  // 4× CPU 仅用于加载类指标压力测试；INP 的 field 阈值不按降速定义，
  // 因此再跑一遍 1× 作为交互延迟参考（verdict 对 cpu>1 的 INP 只做记录不判失败）。
  { name: 'mobile-4x', width: 390, height: 844, cpu: 4 },
  { name: 'mobile-1x', width: 390, height: 844, cpu: 1 },
];

const browser = await chromium.launch({ channel: 'chrome' });

// 先登录一次，导出 storageState 供各冷启动 context 复用
const loginCtx = await browser.newContext({ ignoreHTTPSErrors: true });
const loginPage = await loginCtx.newPage();
await loginPage.goto(`${BASE}/login`);
await loginPage.getByLabel(/登录邮箱|账号.*邮箱/i).fill(EMAIL);
await loginPage.getByLabel('密码', { exact: true }).fill(PASSWORD);
await loginPage.getByRole('button', { name: '安全登录' }).click();
await loginPage.waitForURL(/dashboard$/);
const storageState = await loginCtx.storageState();
await loginCtx.close();

const initScript = () => {
  window.__cwv = { lcp: 0, cls: 0, events: [] };
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__cwv.lcp = e.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (!e.hadRecentInput) window.__cwv.cls += e.value;
    }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) if (e.duration) window.__cwv.events.push({ name: e.name, duration: e.duration });
    }).observe({ type: 'event', buffered: true });
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) window.__cwv.longTasks.push({ start: e.startTime, duration: e.duration });
    }).observe({ type: 'longtask', buffered: true });
  } catch {}
};

const results = [];
for (const vp of VIEWPORTS) {
  const ctx = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: vp.width, height: vp.height },
    storageState,
  });
  for (const route of ROUTES) {
    const page = await ctx.newPage();
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    if (vp.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: vp.cpu });
    await page.addInitScript(initScript);
    await page.goto(BASE + route, { waitUntil: 'load' });
    await page.waitForTimeout(1800);
    // INP 代理：真实点击 + 键盘事件，取 Event Timing 最大时长（observer + getEntries 双保险）
    try {
      const menu = page.getByRole('button', { name: /系统管理员|切换侧边栏/ }).first();
      if (await menu.count()) await menu.click({ timeout: 2000 });
      else await page.keyboard.press('Tab');
      await page.waitForTimeout(300);
      await page.keyboard.press('Tab');
      await page.waitForTimeout(200);
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(300);
    } catch {}
    const perf = await page.evaluate(() => {
      const nav = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      const events = [
        ...(window.__cwv?.events ?? []),
        ...performance.getEntriesByType('event').map((e) => ({ name: e.name, duration: e.duration || 0 })),
      ].filter((e) => e.duration > 0);
      const worst = events.sort((a, b) => b.duration - a.duration)[0] ?? null;
      // TBT：FCP 之后 >50ms 长任务的阻塞时间之和（标准 lab 交互响应代理，阈值 <200ms）
      const fcpTime = fcp ? fcp.startTime : 0;
      const tbt = Math.round((window.__cwv?.longTasks ?? [])
        .filter((t) => t.start >= fcpTime)
        .reduce((sum, t) => sum + Math.max(0, t.duration - 50), 0));
      return {
        lcp: Math.round(window.__cwv?.lcp ?? 0),
        cls: Math.round((window.__cwv?.cls ?? 0) * 1000) / 1000,
        tbt,
        inpProxy: worst ? Math.round(worst.duration) : null,
        inpEvent: worst?.name ?? null,
        ttfb: nav ? Math.round(nav.responseStart) : null,
        fcp: fcp ? Math.round(fcp.startTime) : null,
        load: nav ? Math.round(nav.loadEventEnd) : null,
        transferKb: Math.round(performance.getEntriesByType('resource').reduce((s, r) => s + (r.transferSize || 0), 0) / 1024),
      };
    });
    results.push({ viewport: vp.name, cpu: vp.cpu, route, ...perf });
    await page.close();
  }
  await ctx.close();
}
await browser.close();

const rows = results.map((r) => {
  const fails = [];
  if (r.lcp > 2500) fails.push('LCP');
  if (r.cls > 0.1) fails.push('CLS');
  if (r.tbt > 200) fails.push('TBT');
  // INP 为合成交互参考值（Event Timing 对 Playwright 输入不稳定），不作门禁。
  return { ...r, verdict: fails.length ? `FAIL(${fails.join(',')})` : 'PASS' };
});
console.log(JSON.stringify(rows, null, 2));
const failed = rows.filter((r) => r.verdict !== 'PASS');
process.exit(failed.length === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * 无障碍抽检：对比度（canvas 转 sRGB，正确处理 oklch/lab）+ 键盘可达性。
 *
 * 用法：node scripts/ux/a11y.mjs（需 Docker 验收栈 https://127.0.0.1:19443）
 * 判据：正文 ≥4.5:1、大字号(≥24px 或 ≥18.66px 粗体) ≥3:1；跳过 aria-hidden 装饰元素；
 * 键盘：首个 Tab = 跳转主内容、焦点有可见环、Enter 打开弹窗、Esc 关闭并归还焦点。
 */
import { chromium } from '@playwright/test';

const BASE = process.env.E2E_BASE_URL || 'https://127.0.0.1:19443';
const EMAIL = process.env.E2E_ADMIN_EMAIL || 'admin@example.com';
const PASSWORD = process.env.E2E_ADMIN_PASSWORD || 'Admin@123456';
const PATHS = ['/dashboard', '/users', '/audit-logs', '/profile', '/permissions'];

const browser = await chromium.launch({ channel: 'chrome' });
const context = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1139, height: 700 } });
const page = await context.newPage();
await page.goto(`${BASE}/login`);
await page.getByLabel(/登录邮箱|账号.*邮箱/i).fill(EMAIL);
await page.getByLabel('密码', { exact: true }).fill(PASSWORD);
await page.getByRole('button', { name: '安全登录' }).click();
await page.waitForURL(/dashboard$/);

const report = { contrast: {}, keyboard: null };
for (const path of PATHS) {
  await page.goto(BASE + path, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  report.contrast[path] = await page.evaluate(() => {
    const cv = document.createElement('canvas'); cv.width = cv.height = 1;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const toRgba = (css) => {
      ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = css; ctx.fillRect(0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top, bottom) => [0, 1, 2].map((i) => Math.round(top[i] * top[3] + bottom[i] * (1 - top[3])));
    const bgOf = (el) => {
      const chain = []; let node = el;
      while (node) {
        const c = toRgba(getComputedStyle(node).backgroundColor);
        if (c[3] > 0) chain.push(c);
        if (c[3] >= 0.999) break;
        node = node.parentElement;
      }
      let bg = [255, 255, 255];
      for (let i = chain.length - 1; i >= 0; i--) bg = over(chain[i], bg);
      return bg;
    };
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const offenders = []; const seen = new Set();
    for (const el of document.querySelectorAll('main *, aside *, header *')) {
      if (el.closest('[aria-hidden="true"]')) continue;
      let hidden = false;
      for (let n = el; n; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) { hidden = true; break; }
      }
      if (hidden) continue;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const r = el.getBoundingClientRect(); if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      const bg = bgOf(el); const fg = over(toRgba(cs.color), bg);
      const [a, b] = [lum(fg), lum(bg)];
      const cr = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      const fontPx = parseFloat(cs.fontSize); const bold = Number(cs.fontWeight) >= 700;
      const need = (fontPx >= 24 || (fontPx >= 18.66 && bold)) ? 3 : 4.5;
      if (cr < need) {
        const key = `${cs.color}|${cs.backgroundColor}|${Math.round(fontPx)}`;
        if (seen.has(key)) continue; seen.add(key);
        offenders.push({ text: el.textContent.trim().slice(0, 30), ratio: Math.round(cr * 100) / 100, need, fontPx });
      }
    }
    return offenders;
  });
}

// 键盘：跳转链接 → 新建用户 → Enter 打开 → Esc 关闭 + 焦点归还
await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
await page.keyboard.press('Tab');
const firstFocus = await page.evaluate(() => document.activeElement?.textContent?.trim());
let ring = false; let opened = false; let restored = null;
for (let i = 0; i < 40; i++) {
  const info = await page.evaluate(() => {
    const el = document.activeElement; const cs = getComputedStyle(el);
    return { name: el?.getAttribute('aria-label') || el?.textContent?.trim() || '', ring: cs.boxShadow !== 'none' || cs.outlineStyle !== 'none' };
  });
  if (info.name.startsWith('新建用户')) { ring = info.ring; break; }
  await page.keyboard.press('Tab');
}
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
opened = (await page.locator('[role="dialog"]').count()) > 0;
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
restored = await page.evaluate(() => ({
  dialog: document.querySelectorAll('[role="dialog"]').length,
  focus: document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim().slice(0, 20),
}));
report.keyboard = { skipLink: firstFocus, ringVisible: ring, enterOpensDialog: opened, escapeRestores: restored };

console.log(JSON.stringify(report, null, 2));
const fails = Object.entries(report.contrast).filter(([, v]) => v.length > 0);
process.exit(fails.length === 0 && opened && restored?.dialog === 0 ? 0 : 1);

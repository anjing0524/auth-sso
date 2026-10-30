import { chromium } from '@playwright/test';

const BASE = 'https://127.0.0.1:19443';
const errors = [];
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
page.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

async function step(name, fn) {
  try { await fn(); console.log(`✅ ${name}`); }
  catch (e) { console.log(`✗ ${name}: ${e.message.split('\n')[0]}`); errors.push(`${name}: ${e.message}`); }
}
const closeDialog = async () => {
  const btn = page.getByRole('button', { name: '关闭' }).last();
  await btn.click();
  await page.waitForTimeout(200);
};

await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
await page.getByLabel('登录邮箱').fill('admin@example.com');
await page.getByLabel('密码', { exact: true }).fill('Admin@123456');
await page.getByRole('button', { name: '安全登录' }).click();
await page.waitForURL(/\/dashboard$/, { timeout: 60000 });

await step('用户列表 → 新建用户页面', async () => {
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建用户' }).click();
  await page.waitForURL(/\/users\/new$/, { timeout: 10000 });
});
await step('用户列表 → 用户详情', async () => {
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /详情/ }).first().click();
  await page.waitForURL(/\/users\/[0-9a-f-]+/, { timeout: 10000 });
});
await step('角色新建弹窗开合', async () => {
  await page.goto(`${BASE}/roles`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建角色' }).click();
  await page.getByRole('dialog').waitFor();
  await closeDialog();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
});
await step('部门新建弹窗开合', async () => {
  await page.goto(`${BASE}/departments`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '新建部门' }).click();
  await page.getByRole('dialog').waitFor();
  await closeDialog();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
});
await step('应用编辑 → 详情页', async () => {
  await page.goto(`${BASE}/clients`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /编辑配置/ }).first().click();
  await page.waitForURL(/\/clients\/portal(?:\?|$)/, { timeout: 10000 });
});
await step('应用详情页签切换', async () => {
  await page.getByRole('tab', { name: '授权记录' }).click();
  await page.getByRole('tab', { name: '基本信息' }).click();
});
await step('个人中心编辑资料弹窗开合', async () => {
  await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '编辑资料' }).click();
  await page.getByRole('dialog').waitFor();
  await closeDialog();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
});
await step('个人中心修改密码弹窗开合', async () => {
  await page.getByRole('button', { name: '修改密码' }).click();
  await page.getByRole('dialog').waitFor();
  await closeDialog();
  await page.getByRole('dialog').waitFor({ state: 'detached' });
});
await step('权限列表 → 新建权限页面', async () => {
  await page.goto(`${BASE}/permissions`, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: /新建权限/ }).first().click();
  await page.waitForURL(/\/permissions\/new/, { timeout: 10000 });
});
await step('用户搜索过滤', async () => {
  await page.goto(`${BASE}/users`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder('搜索姓名/邮箱/用户名').fill('qa');
  await page.keyboard.press('Enter');
  await page.waitForURL(/keyword=qa/, { timeout: 10000 });
  await page.getByText('QA 林').first().waitFor();
});
await step('审计 CSV 导出', async () => {
  await page.goto(`${BASE}/audit-logs?tab=operation`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '导出 CSV' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 15000 }),
    page.getByRole('menuitem', { name: /导出操作日志/ }).click(),
  ]);
  const path = await download.path();
  if (!path) throw new Error('下载文件为空');
  const fs = await import('node:fs');
  if (fs.statSync(path).size === 0) throw new Error('CSV 为空');
});
await step('命令面板开合', async () => {
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'networkidle' });
  await page.keyboard.press('Control+k');
  await page.getByRole('dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'detached' });
});
await step('侧栏折叠/展开', async () => {
  await page.getByRole('button', { name: '切换侧边栏' }).click();
  await page.getByRole('button', { name: '切换侧边栏' }).click();
});
await step('审计三页签切换', async () => {
  await page.goto(`${BASE}/audit-logs`, { waitUntil: 'networkidle' });
  await page.getByRole('tab', { name: '操作日志' }).click();
  await page.getByRole('tab', { name: '访问日志' }).click();
  await page.getByRole('tab', { name: '登录日志' }).click();
});
await step('权限分页翻页', async () => {
  await page.goto(`${BASE}/permissions`, { waitUntil: 'networkidle' });
  await page.getByLabel('下一页').click();
  await page.waitForURL(/page=2/, { timeout: 10000 });
});

await browser.close();
console.log(`\nERRORS=${errors.length}`);
if (errors.length) { console.log(errors.join('\n')); process.exit(1); }

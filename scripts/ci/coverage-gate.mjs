#!/usr/bin/env node
/**
 * 覆盖率门禁：只对核心安全域设最低线，不追求全仓高覆盖。
 *
 * 基线（2026-11-02，主分支）：
 *   lines: total 60.55 · auth 88.58 · permission 91.63 · oauth 84.39%
 *   branch: total 48.70 · auth 79.49 · permission 87.77 · oauth 74.00%
 *
 * 阈值刻意贴着基线下方 1% 左右：允许正常波动，但关键域掉下来必须红。
 * 数据来源：vitest --coverage --coverage.reporter=json-summary 的 coverage-summary.json。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SUMMARY = join(ROOT, 'coverage', 'coverage-summary.json');

const THRESHOLDS = {
  overall: { lines: 60, branches: 48 },
  auth: { lines: 88, branches: 78 },
  permission: { lines: 91, branches: 87 },
  oauth: { lines: 83, branches: 72 },
};

const inAuth = (path) =>
  path.startsWith('apps/portal/src/domain/auth/') ||
  path.startsWith('apps/portal/src/lib/auth/') ||
  path.startsWith('apps/portal/src/app/api/auth/');

const inPermission = (path) =>
  path.startsWith('apps/portal/src/domain/permission/') ||
  path.startsWith('apps/portal/src/app/api/permissions/') ||
  [
    'apps/portal/src/lib/permissions.ts',
    'apps/portal/src/lib/auth/check-permission.ts',
    'apps/portal/src/lib/role-permission-assignment.ts',
  ].includes(path);

const inOauth = (path) => inAuth(path) && path.toLowerCase().includes('oauth');

let summary;
try {
  summary = JSON.parse(readFileSync(SUMMARY, 'utf8'));
} catch {
  console.error(`✗ 找不到覆盖率摘要：${SUMMARY}`);
  console.error('  先运行 pnpm test:coverage');
  process.exit(1);
}

const stats = {};
for (const [absolute, value] of Object.entries(summary)) {
  if (absolute === 'total') continue;
  const path = absolute.replace(`${ROOT}/`, '');
  const groups = ['overall'];
  if (inAuth(path)) groups.push('auth');
  if (inPermission(path)) groups.push('permission');
  if (inOauth(path)) groups.push('oauth');
  for (const group of groups) {
    const current = (stats[group] ??= {
      lines: { covered: 0, total: 0 },
      branches: { covered: 0, total: 0 },
    });
    current.lines.covered += value.lines.covered;
    current.lines.total += value.lines.total;
    current.branches.covered += value.branches.covered;
    current.branches.total += value.branches.total;
  }
}

const pct = (metric) => (metric.total === 0 ? 100 : (metric.covered / metric.total) * 100);
const rows = Object.entries(THRESHOLDS).map(([group, threshold]) => {
  const current = stats[group] ?? {
    lines: { covered: 0, total: 0 },
    branches: { covered: 0, total: 0 },
  };
  return {
    group,
    threshold,
    lines: pct(current.lines),
    branches: pct(current.branches),
    covered: current.lines.covered,
    total: current.lines.total,
  };
});

console.log('\n覆盖率门禁：');
for (const row of rows) {
  console.log(
    `  ${row.group.padEnd(11)} lines ${row.lines.toFixed(2).padStart(6)}% (阈值 ${row.threshold.lines}%)` +
      ` · branches ${row.branches.toFixed(2).padStart(6)}% (阈值 ${row.threshold.branches}%)` +
      ` · ${row.covered}/${row.total}`,
  );
}

const failed = rows.filter(
  (row) => row.lines < row.threshold.lines || row.branches < row.threshold.branches,
);
if (failed.length > 0) {
  console.error(`\n✗ 覆盖率低于阈值：${failed.map((row) => row.group).join(', ')}`);
  process.exit(1);
}
console.log('\n✅ 覆盖率门禁通过');

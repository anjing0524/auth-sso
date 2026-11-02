#!/usr/bin/env node
/**
 * 覆盖率门禁：只对核心安全域设最低线，不追求全仓高覆盖。
 *
 * 基线（2026-11-02，主分支）：
 *   total lines 60.53% · auth 88.40% · permission 91.63% · oauth 83.91%
 *
 * 阈值刻意贴着基线下方 1% 左右：允许正常波动，但关键域掉下来必须红。
 * 数据来源：vitest --coverage --coverage.reporter=json-summary 的 coverage-summary.json。
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const SUMMARY = join(ROOT, 'coverage', 'coverage-summary.json');

const THRESHOLDS = {
  overall: 60,
  auth: 88,
  permission: 91,
  oauth: 83,
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
    const current = (stats[group] ??= { covered: 0, total: 0 });
    current.covered += value.lines.covered;
    current.total += value.lines.total;
  }
}

const rows = Object.entries(THRESHOLDS).map(([group, threshold]) => {
  const current = stats[group] ?? { covered: 0, total: 0 };
  const pct = current.total === 0 ? 100 : (current.covered / current.total) * 100;
  return { group, threshold, pct, covered: current.covered, total: current.total };
});

console.log('\n覆盖率门禁（行覆盖）：');
for (const row of rows) {
  console.log(
    `  ${row.group.padEnd(11)} ${row.pct.toFixed(2).padStart(6)}%  (阈值 ${row.threshold}%, ${row.covered}/${row.total})`,
  );
}

const failed = rows.filter((row) => row.pct < row.threshold);
if (failed.length > 0) {
  console.error(`\n✗ 覆盖率低于阈值：${failed.map((row) => row.group).join(', ')}`);
  process.exit(1);
}
console.log('\n✅ 覆盖率门禁通过');

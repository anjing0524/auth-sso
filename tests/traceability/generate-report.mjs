#!/usr/bin/env node

/**
 * Auth-SSO 需求追溯性报告生成器
 * Requirements Traceability Report Generator
 *
 * 递归扫描 apps/X/__tests__/ 和 tests/e2e/ 下的测试文件，
 * 提取 @req 标注（文件级和行级），与 REQUIREMENTS_MATRIX.md 中的需求进行匹配，
 * 生成覆盖率报告（控制台 + Markdown 文件）。
 *
 * 支持的 @req 格式：
 *   - 单 ID:      @req A-NAV-01
 *   - 逗号分隔:   @req D-PRM-L, D-PRM-C, D-PRM-U, D-PRM-D
 *   - 范围:       @req AUTH-001~005  → AUTH-001 ... AUTH-005
 *   - 斜杠分隔:   @req F-DEP-L/C/U/D → F-DEP-L, F-DEP-C, F-DEP-U, F-DEP-D
 *   - 混合:       @req F-DEP-L/C/U/D, SCOPE-001~005
 *
 * 用法:
 *   node tests/traceability/generate-report.mjs
 *   node tests/traceability/generate-report.mjs --threshold 90
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');

// ─── 配置 ───────────────────────────────────────────────────
const TEST_SOURCE_DIRS = [
  path.join(ROOT, 'apps'),
  path.join(ROOT, 'tests', 'e2e'),
];

const REQUIREMENTS_MATRIX_PATH = path.join(ROOT, 'docs', 'spec', 'REQUIREMENTS_MATRIX.md');
const ARCHITECTURE_CONSTRAINTS_PATH = path.join(ROOT, 'docs', 'spec', 'ARCHITECTURE_CONSTRAINTS.md');

const IGNORE_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  '.git',
  'coverage',
  '.worktrees',
]);

const TEST_FILE_PATTERNS = ['.test.ts', '.test.tsx', '.spec.ts', '.test.js'];

// ======================================================================
//  1. 解析 REQUIREMENTS_MATRIX.md
// ======================================================================

/**
 * @returns {{ modules: Array<{name: string, reqs: string[]}>, allReqs: Array<{id: string, module: string}> }}
 */
function parseRequirementsMatrix(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  const modules = [];
  const allReqs = [];
  let currentModule = '';
  let inRequirementsSection = true; // 只在需求表格区域提取 ID，汇总/追溯表不提取

  for (const line of lines) {
    // 遇到「需求汇总」或「追溯关系」章节 → 停止提取需求 ID（后续 **ID** 为非需求条目）
    if (/^##\s+(需求汇总|追溯关系)/.test(line)) {
      inRequirementsSection = false;
      continue;
    }

    if (!inRequirementsSection) continue;

    // 模块标题: ## 模块 A: Portal Infrastructure
    const modMatch = line.match(/^##\s+模块\s+([A-Z]):\s+(.+)/);
    if (modMatch) {
      currentModule = `${modMatch[1]}: ${modMatch[2].trim()}`;
      modules.push({ name: currentModule, reqs: [] });
      continue;
    }

    // 子模块标题: ### H-AUTH: OAuth 2.1 Authentication Flow
    const subModMatch = line.match(/^###\s+([A-Z]-[A-Z]+):\s+(.+)/);
    if (subModMatch) {
      currentModule = `${subModMatch[1].split('-')[0]}: ${subModMatch[2].trim()}`;
      modules.push({ name: currentModule, reqs: [] });
      continue;
    }

    // 提取 **ID** 格式的需求编号（表格内的加粗文本）
    const boldReqs = line.matchAll(/\*\*([A-Z0-9]+(?:-[A-Z0-9]+)+)\*\*/g);
    for (const match of boldReqs) {
      const id = match[1];
      allReqs.push({ id, module: currentModule });
      const lastMod = modules[modules.length - 1];
      if (lastMod && !lastMod.reqs.includes(id)) {
        lastMod.reqs.push(id);
      }
    }
  }

  return { modules, allReqs };
}

// ======================================================================
//  2. 扫描测试文件
// ======================================================================

function walkDir(dir) {
  const files = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...walkDir(fullPath));
      } else if (TEST_FILE_PATTERNS.some((p) => entry.name.endsWith(p))) {
        files.push(fullPath);
      }
    }
  } catch {
    // 跳过不可访问目录
  }
  return files;
}

function classifyTestType(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  if (normalized.includes('/e2e/') || filePath.endsWith('.spec.ts')) return 'E2E';
  if (normalized.includes('/__tests__/components/')) return 'Component';
  if (normalized.includes('/__tests__/api/')) return 'API';
  return 'Unit';
}

function scanTestFiles() {
  const results = [];
  for (const dir of TEST_SOURCE_DIRS) {
    if (!fs.existsSync(dir)) continue;
    for (const filePath of walkDir(dir)) {
      const annotations = extractAnnotations(filePath);
      const relativePath = path.relative(ROOT, filePath);
      results.push({
        path: relativePath,
        type: classifyTestType(filePath),
        annotations,
      });
    }
  }
  return results;
}

// ======================================================================
//  3. 提取 @req 标注
// ======================================================================

/**
 * 从文件中提取所有 @req 标注
 * 支持文件级 `@req XXX` 和行级 `// @req XXX`
 */
function extractAnnotations(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const annotations = [];

  // 匹配 @req 后跟的内容，直到行尾或 */ 闭合
  const reqRegex = /@req\s+(.+?)(?:\s*\*\/|\s*$)/gm;
  let match;
  while ((match = reqRegex.exec(content)) !== null) {
    const value = match[1].trim();
    // 跳过误匹配: @vitest-environment 等
    if (value.startsWith('vitest') || value.startsWith('environment')) continue;

    const ids = expandReqString(value);
    for (const id of ids) {
      if (!annotations.includes(id)) {
        annotations.push(id);
      }
    }
  }

  return annotations;
}

/**
 * 展开 @req 值字符串为具体需求 ID 列表
 *
 * 支持的格式:
 *   - "A-NAV-01"                    → [A-NAV-01]
 *   - "D-PRM-L, D-PRM-C"           → [D-PRM-L, D-PRM-C]
 *   - "AUTH-001~005"               → [AUTH-001, AUTH-002, ..., AUTH-005]
 *   - "F-DEP-L/C/U/D"              → [F-DEP-L, F-DEP-C, F-DEP-U, F-DEP-D]
 *   - "F-DEP-L/C/U/D, SCOPE-001~005" → [F-DEP-L, F-DEP-C, ..., SCOPE-001, ..., SCOPE-005]
 */
function expandReqString(value) {
  const ids = [];

  // 按逗号分割
  const parts = value.split(',').map((p) => p.trim()).filter(Boolean);

  for (const part of parts) {
    // 1) 斜杠分隔: F-DEP-L/C/U/D  → F-DEP-L, F-DEP-C, F-DEP-U, F-DEP-D
    const slashMatch = part.match(/^([A-Z]+-[A-Z]+-)([A-Z](?:\/[A-Z])+)$/);
    if (slashMatch) {
      const prefix = slashMatch[1];
      for (const suffix of slashMatch[2].split('/')) {
        ids.push(`${prefix}${suffix}`);
      }
      continue;
    }

    // 2) 范围: H-SESS-001~006 → H-SESS-001 ... H-SESS-006
    //    支持单/多段: AUTH-001~005, A-NAV-01~03, H-SESS-001~006
    const rangeMatch = part.match(/^([A-Z]+(?:-[A-Z]+)*-\d+)~(\d+)$/);
    if (rangeMatch) {
      const baseStr = rangeMatch[1]; // e.g. "H-SESS-001"
      const endNum = parseInt(rangeMatch[2], 10);

      const dashIdx = baseStr.lastIndexOf('-');
      const prefix = baseStr.substring(0, dashIdx + 1); // e.g. "H-SESS-"
      const startStr = baseStr.substring(dashIdx + 1);  // e.g. "001"
      const startNum = parseInt(startStr, 10);
      const padding = startStr.length;

      for (let i = startNum; i <= endNum; i++) {
        ids.push(`${prefix}${String(i).padStart(padding, '0')}`);
      }
      continue;
    }

    // 3) 单 ID: A-NAV-01, G-SEC-INT
    if (/^[A-Z0-9]+(?:-[A-Z0-9]+)+$/.test(part)) {
      ids.push(part);
    }
  }

  return ids;
}

// ======================================================================
//  4. 生成覆盖率报告
// ======================================================================

function generateReport(requirements, testFiles, threshold, archReqs = []) {
  // 构建覆盖率映射: reqId -> { coveredBy: [{path, type}] }
  const coverage = {};
  for (const req of requirements) {
    coverage[req.id] = { ...req, coveredBy: [] };
  }

  // 将测试文件的 @req 标注映射到需求
  const allTestReqIds = new Set();
  for (const file of testFiles) {
    for (const reqId of file.annotations) {
      allTestReqIds.add(reqId);
      if (coverage[reqId]) {
        coverage[reqId].coveredBy.push({
          path: file.path,
          type: file.type,
        });
      }
    }
  }

  // 架构约束覆盖率（单独追踪，不计入需求覆盖率）
  const archCoverage = {};
  for (const req of archReqs) {
    archCoverage[req.id] = { ...req, coveredBy: [] };
  }
  for (const file of testFiles) {
    for (const reqId of file.annotations) {
      if (archCoverage[reqId]) {
        archCoverage[reqId].coveredBy.push({ path: file.path, type: file.type });
      }
    }
  }
  const archCovered = Object.values(archCoverage).filter((r) => r.coveredBy.length > 0).length;

  // 未识别 ID（不在需求矩阵或架构约束中，但被 @req 引用）
  const unrecognized = [...allTestReqIds]
    .filter((id) => !coverage[id] && !archCoverage[id])
    .sort();

  // 按模块分组
  const moduleMap = {};
  for (const req of Object.values(coverage)) {
    if (!req.module) continue;
    if (!moduleMap[req.module]) moduleMap[req.module] = [];
    moduleMap[req.module].push(req);
  }

  let totalCovered = 0;
  const totalReqs = requirements.length;

  // ── 控制台输出 ──
  const lines = [];
  lines.push('='.repeat(60));
  lines.push('  REQUIREMENTS COVERAGE REPORT');
  lines.push('='.repeat(60));
  lines.push('');

  // 无模块的需求（解析异常情况）
  const orphanReqs = Object.values(coverage).filter((r) => !r.module);
  const moduleKeys = Object.keys(moduleMap).sort();

  for (const modName of moduleKeys) {
    const reqs = moduleMap[modName];
    const covered = reqs.filter((r) => r.coveredBy.length > 0).length;
    totalCovered += covered;

    lines.push(`  ${modName} (${reqs.length} reqs, ${covered}/${reqs.length} covered)`);
    lines.push(`  ${'-'.repeat(50)}`);

    for (const req of reqs) {
      if (req.coveredBy.length > 0) {
        const refs = req.coveredBy.map((r) => `${r.type}: ${r.path}`).join('\n        ');
        lines.push(`  ✅ ${req.id}`);
        lines.push(`        ${refs}`);
      } else {
        lines.push(`  ⚠️  ${req.id} → [NOT COVERED]`);
      }
    }
    lines.push('');
  }

  if (orphanReqs.length > 0) {
    lines.push('  Orphan Requirements (no module):');
    for (const req of orphanReqs) {
      lines.push(`    ${req.id}: ${req.coveredBy.length > 0 ? 'covered' : 'NOT COVERED'}`);
    }
    lines.push('');
  }

  const pct = totalReqs > 0 ? ((totalCovered / totalReqs) * 100).toFixed(1) : '0.0';
  lines.push('='.repeat(60));
  lines.push(`  TOTAL (Requirements): ${totalCovered}/${totalReqs} (${pct}%)`);
  if (archReqs.length > 0) {
    lines.push(`  Architecture Constraints: ${archCovered}/${archReqs.length} covered`);
  }
  lines.push('='.repeat(60));

  if (unrecognized.length > 0) {
    lines.push('');
    lines.push(`  Unrecognized @req IDs (${unrecognized.length} — not in requirements matrix):`);
    for (const id of unrecognized) {
      lines.push(`    ${id}`);
    }
  }

  console.log(lines.join('\n'));

  // ── Markdown 报告 ──
  const reportDir = path.dirname(
    path.join(ROOT, 'tests', 'traceability', 'coverage-report.md'),
  );
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true });
  }
  const reportPath = path.join(reportDir, 'coverage-report.md');

  const mdLines = [
    '# Requirements Coverage Report',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `**Requirements:** ${totalCovered}/${totalReqs} covered (**${pct}%**)`,
    ...(archReqs.length > 0 ? [`**Architecture Constraints:** ${archCovered}/${archReqs.length} covered`] : []),
    '',
    '---',
    '',
  ];

  for (const modName of moduleKeys) {
    const reqs = moduleMap[modName];
    const covered = reqs.filter((r) => r.coveredBy.length > 0).length;
    mdLines.push(`## ${modName}`);
    mdLines.push('');
    mdLines.push(`Coverage: **${covered}/${reqs.length}**`);
    mdLines.push('');
    mdLines.push('| Requirement | Status | Test Files |');
    mdLines.push('| --- | --- | --- |');
    for (const req of reqs) {
      if (req.coveredBy.length > 0) {
        const refs = req.coveredBy
          .map((r) => `\`${r.path}\``)
          .join('<br>');
        mdLines.push(`| ${req.id} | ✅ | ${refs} |`);
      } else {
        mdLines.push(`| ${req.id} | ⚠️ | — |`);
      }
    }
    mdLines.push('');
  }

  if (unrecognized.length > 0) {
    mdLines.push('## Unrecognized @req IDs');
    mdLines.push('');
    mdLines.push(
      'These IDs appear in `@req` annotations but are not found in the requirements matrix:',
    );
    mdLines.push('');
    for (const id of unrecognized) {
      mdLines.push(`- \`${id}\``);
    }
    mdLines.push('');
  }

  fs.writeFileSync(reportPath, mdLines.join('\n'), 'utf-8');
  console.log(`\nDetailed report written to: tests/traceability/coverage-report.md`);

  // ── 阈值检查 ──
  const numericPct = parseFloat(pct);
  if (threshold !== null && numericPct < threshold) {
    console.log(
      `\n  FAIL: Coverage ${pct}% is below threshold ${threshold}%`,
    );
    process.exit(1);
  }

  if (threshold !== null) {
    console.log(`  PASS: Coverage ${pct}% meets threshold ${threshold}%`);
  }

  return { totalCovered, totalReqs, pct };
}

// ======================================================================
//  Main
// ======================================================================

function main() {
  const args = process.argv.slice(2);
  let threshold = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--threshold' && i + 1 < args.length) {
      threshold = parseInt(args[i + 1], 10);
      if (isNaN(threshold) || threshold < 0 || threshold > 100) {
        console.error('Error: --threshold must be an integer between 0 and 100');
        process.exit(1);
      }
      i++;
    }
  }

  // 解析需求矩阵
  if (!fs.existsSync(REQUIREMENTS_MATRIX_PATH)) {
    console.error(`Error: Requirements matrix not found: ${REQUIREMENTS_MATRIX_PATH}`);
    process.exit(1);
  }
  console.log(`Parsing requirements matrix...`);
  const { allReqs, modules } = parseRequirementsMatrix(REQUIREMENTS_MATRIX_PATH);
  console.log(`  Found ${allReqs.length} requirements across ${modules.length} modules`);

  // 解析架构约束（含 DC-* 领域模型约束 ID）——单独追踪，不计入需求覆盖率分母
  let archReqs = [];
  if (fs.existsSync(ARCHITECTURE_CONSTRAINTS_PATH)) {
    archReqs = parseRequirementsMatrix(ARCHITECTURE_CONSTRAINTS_PATH).allReqs;
    console.log(`  + ${archReqs.length} architecture constraint IDs from ARCHITECTURE_CONSTRAINTS.md (tracked separately)`);
  }

  for (const mod of modules) {
    console.log(`    ${mod.name}: ${mod.reqs.length} reqs`);
  }

  // 扫描测试文件
  console.log(`\nScanning test files...`);
  const testFiles = scanTestFiles();
  console.log(`  Found ${testFiles.length} test files`);
  for (const file of testFiles) {
    if (file.annotations.length > 0) {
      console.log(`    ${file.type}: ${file.path} (${file.annotations.length} @req refs)`);
    }
  }

  // 生成报告
  console.log(`\nGenerating coverage report...\n`);
  generateReport(allReqs, testFiles, threshold, archReqs);
}

main();

/**
 * 治理技能套件守卫（确定性检查）
 *
 * ## 为什么
 *
 * `.dsh/skills/` 是 DSH 的**运行时输入**：frontmatter 非法、`name` 不合法或资源缺失的 skill
 * 会被静默跳过（DSH 只在宿主日志里给 warning，模型目录收不到逐 skill 诊断）。手写 Markdown 的
 * 结构性错误没有编译期检查 ⇒ 用守卫把「能不能被加载、是否与标准清单一致」变成确定性检查。
 *
 * ## 覆盖
 *
 * 1. frontmatter：必填字段、name 与目录名一致、严格 YAML 子集（引号闭合、重复键、制表符）、长度上限；
 * 2. 固定章节：行级锚定（`### 定位` 不算 `## 定位`）且每节恰好一次、顺序正确；
 * 3. 单技能行数预算；正文引用的 `references/…` / `scripts/…` 资源真实存在；
 * 4. 编排脚本：可解析、失败路径**真实执行**后返回 `ok:false`（不静默吞子 agent 失败）、成功路径返回 `ok:true`；
 * 5. 标准文档 §三 技能清单与目录双向同步、`docs/README.md` 的 `.dsh/skills/ (N)` 计数等于目录实测；
 * 6. 唯一入口：`.claude/skills`、`.agents/skills`、`CLAUDE.md`、`skills-lock.json` 不回归；`AGENTS.md` 只有一句指针；
 * 7. 导航互指：标准文档、`.dsh/README.md`、`docs/README.md`、根 `README.md`、ADR-027 存在并互相指向。
 *
 * 注：本守卫不映射需求矩阵条目，故不写 `@req`（治理机制不是产品需求）。
 *
 * @vitest-environment node
 */
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT, assertScannedNonEmpty } from '../helpers/repo-scan';

const SKILLS_ROOT = join(REPO_ROOT, '.dsh/skills');
const STANDARD_DOC = join(REPO_ROOT, 'docs/agent-governance.md');
const AGENTS_MD = join(REPO_ROOT, 'AGENTS.md');
const DOCS_README = join(REPO_ROOT, 'docs/README.md');
const ROOT_README = join(REPO_ROOT, 'README.md');
const ADR = join(REPO_ROOT, 'docs/adr/ADR-027-agent-governance-skills.md');
const DSH_README = join(REPO_ROOT, '.dsh/README.md');
const WORKFLOW_SCRIPT = join(SKILLS_ROOT, 'governance-workflow/scripts/governance-audit.workflow.mjs');

/** 固定章节（顺序即标准，插入新章节时同步 docs/agent-governance.md §二） */
const REQUIRED_SECTIONS = [
  '## 定位',
  '## 判据',
  '## 流程',
  '## 输出与验收',
  '## 禁止',
  '## 参考',
] as const;
const REQUIRED_KEYS = ['name', 'description', 'whenToUse'];
/** 标准只声明四个顶层键（metadata 仅作人类标签）；其余键一律判违规 */
const ALLOWED_KEYS = new Set([...REQUIRED_KEYS, 'metadata']);
const MAX_DESCRIPTION_CHARS = 200;
const MAX_SKILL_LINES = 160;
const MIN_SKILLS = 5;

interface Skill {
  dir: string;
  file: string;
  data: Record<string, string>;
  body: string;
  frontmatterIssues: string[];
}

/** 解析本仓技能使用的 YAML 子集，并把格式问题收集为 issues（不用外部 YAML 依赖） */
function parseFrontmatter(source: string): {
  data: Record<string, string>;
  body: string;
  issues: string[];
} {
  const match = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) throw new Error('缺少 YAML frontmatter（必须以 `---` 开头并有闭合 `---`）');
  const data: Record<string, string> = {};
  const issues: string[] = [];
  for (const raw of match[1]!.split('\n')) {
    if (raw.trim() === '') continue;
    if (/^\t/.test(raw)) {
      issues.push(`frontmatter 使用制表符缩进：${raw.trim()}`);
      continue;
    }
    if (/^ /.test(raw)) continue; // metadata 的嵌套键，语义由人类阅读
    const kv = raw.match(/^([A-Za-z-]+):[ \t]*(.*)$/);
    if (!kv) {
      issues.push(`无法解析的 frontmatter 行：${raw.trim()}`);
      continue;
    }
    const key = kv[1]!;
    let value = kv[2]!.trim();
    if (Object.prototype.hasOwnProperty.call(data, key)) issues.push(`重复的 frontmatter 键：${key}`);
    if (value !== '' && (value.startsWith('"') || value.startsWith("'"))) {
      const quote = value[0]!;
      if (value.length < 2 || !value.endsWith(quote)) issues.push(`frontmatter 值引号未闭合：${key}`);
      else value = value.slice(1, -1);
    }
    data[key] = value;
  }
  return { data, body: match[2]!, issues };
}

/** 正文里反引号包裹的 bundle 资源引用（只认 `references/…` 与 `scripts/…`） */
function referenceTokens(body: string): string[] {
  return [...body.matchAll(/`((?:references|scripts)\/[^`\s]+)`/g)].map((m) => m[1]!);
}

/** 章节必须**整行匹配**且每节恰好一次，按标准顺序出现 */
function sectionViolations(body: string): string[] {
  const lines = body.split('\n');
  const violations: string[] = [];
  let previous = -1;
  for (const section of REQUIRED_SECTIONS) {
    const hits = lines.flatMap((line, index) => (line.trim() === section ? [index] : []));
    if (hits.length === 0) {
      violations.push(`缺少章节「${section}」`);
      continue;
    }
    if (hits.length > 1) violations.push(`章节「${section}」重复 ${hits.length} 次`);
    if (hits[0]! < previous) violations.push(`章节「${section}」顺序错误`);
    previous = hits[0]!;
  }
  return violations;
}

function skillDirs(): string[] {
  if (!existsSync(SKILLS_ROOT)) return [];
  return readdirSync(SKILLS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function loadSkills(): Skill[] {
  return skillDirs().map((dir) => {
    const file = join(SKILLS_ROOT, dir, 'SKILL.md');
    if (!existsSync(file)) throw new Error(`技能目录缺少 SKILL.md：.dsh/skills/${dir}/SKILL.md`);
    const source = readFileSync(file, 'utf-8');
    const parsed = parseFrontmatter(source);
    return { dir, file, data: parsed.data, body: parsed.body, frontmatterIssues: parsed.issues };
  });
}

/** 标准文档 §三 技能清单表里的技能名（限定范围，避免正文提及掩盖漏行） */
function listedSkillNames(doc: string): string[] {
  const start = doc.indexOf('## 三、技能清单');
  const end = doc.indexOf('## 四、');
  expect(start, '标准文档缺少「## 三、技能清单」').toBeGreaterThan(-1);
  expect(end, '标准文档缺少「## 四、」').toBeGreaterThan(start);
  return [...new Set([...doc.slice(start, end).matchAll(/`(governance-[a-z][a-z0-9-]*)`/g)].map((m) => m[1]!))];
}

/** 编译 workflow 脚本体（只编译；执行由测试注入 stub 钩子完成） */
type CompiledWorkflow = (...params: unknown[]) => Promise<Record<string, unknown>>;
function compileWorkflow(source: string): CompiledWorkflow {
  return new Function(
    'agent',
    'parallel',
    'pipeline',
    'phase',
    'log',
    'args',
    `return (async () => {\n${source}\n})();`,
  ) as unknown as CompiledWorkflow;
}

describe('治理技能套件', () => {
  it('抽取器本身可信（frontmatter 严格性、资源抽取、章节锚定都有已知答案）', () => {
    const sample = parseFrontmatter(
      '---\nname: demo\ndescription: "一句话"\nwhenToUse: 触发条件\nmetadata:\n  suite: governance\n---\n\n# 标题\n\n## 定位\n\n见 `references/x.md` 与 `scripts/y.mjs`。\n',
    );
    expect(sample.data).toMatchObject({ name: 'demo', description: '一句话', whenToUse: '触发条件' });
    expect(sample.data).not.toHaveProperty('suite');
    expect(sample.issues).toEqual([]);
    expect(referenceTokens(sample.body)).toEqual(['references/x.md', 'scripts/y.mjs']);

    const broken = parseFrontmatter('---\nname: demo\ndescription: "未闭合\nwhenToUse: x\n---\n');
    expect(broken.issues.some((issue) => issue.includes('引号未闭合'))).toBe(true);
    const duplicated = parseFrontmatter('---\nname: demo\nname: again\ndescription: x\nwhenToUse: y\n---\n');
    expect(duplicated.issues.some((issue) => issue.includes('重复'))).toBe(true);

    expect(sectionViolations('## 定位\n\n## 判据\n\n## 流程\n\n## 输出与验收\n\n## 禁止\n\n## 参考\n')).toEqual([]);
    expect(sectionViolations('### 定位\n\n## 判据\n')).toContain('缺少章节「## 定位」');
    expect(sectionViolations('## 定位\n\n## 定位\n')).toContain('章节「## 定位」重复 2 次');
  });

  it('技能目录非空且每个目录都有 SKILL.md', () => {
    const dirs = skillDirs();
    assertScannedNonEmpty(dirs, '`.dsh/skills/` 下的技能目录', 1);
    expect(dirs.length, `治理技能套件应至少有 ${MIN_SKILLS} 个技能，实测 ${dirs.length}`).toBeGreaterThanOrEqual(
      MIN_SKILLS,
    );
    const broken = dirs
      .filter((dir) => !existsSync(join(SKILLS_ROOT, dir, 'SKILL.md')))
      .map((dir) => `.dsh/skills/${dir}/SKILL.md 不存在`);
    expect(broken).toEqual([]);
  });

  it('frontmatter 合法：name 等于目录名、必填字段非空、无未声明键、description 不超长', () => {
    const violations: string[] = [];
    for (const skill of loadSkills()) {
      const { data } = skill;
      violations.push(...skill.frontmatterIssues.map((issue) => `.dsh/skills/${skill.dir}: ${issue}`));

      const unknown = Object.keys(data).filter((key) => !ALLOWED_KEYS.has(key));
      if (unknown.length > 0) violations.push(`.dsh/skills/${skill.dir}: 未声明的 frontmatter 键 ${unknown.join(', ')}`);

      const missing = REQUIRED_KEYS.filter((key) => (data[key] ?? '').trim() === '');
      if (missing.length > 0) violations.push(`.dsh/skills/${skill.dir}: 缺少必填字段 ${missing.join(', ')}`);

      if (data.name && data.name !== skill.dir) {
        violations.push(`.dsh/skills/${skill.dir}: name「${data.name}」≠ 目录名`);
      }
      if (data.name && !/^[a-z][a-z0-9-]*$/.test(data.name)) {
        violations.push(`.dsh/skills/${skill.dir}: name「${data.name}」不是 kebab-case`);
      }
      if ((data.description ?? '').length > MAX_DESCRIPTION_CHARS) {
        violations.push(`.dsh/skills/${skill.dir}: description 超过 ${MAX_DESCRIPTION_CHARS} 字符`);
      }
      if ((data.whenToUse ?? '').length < 10) {
        violations.push(`.dsh/skills/${skill.dir}: whenToUse 过短或缺失`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('正文有固定章节：行级锚定、每节恰好一次、顺序正确', () => {
    const violations: string[] = [];
    for (const skill of loadSkills()) {
      for (const issue of sectionViolations(skill.body)) violations.push(`.dsh/skills/${skill.dir}: ${issue}`);
    }
    expect(violations).toEqual([]);
  });

  it('正文预算：单技能 ≤ 160 行（细节进 references）', () => {
    const violations: string[] = [];
    for (const skill of loadSkills()) {
      const lines = readFileSync(skill.file, 'utf-8').replace(/\n$/, '').split('\n').length;
      if (lines > MAX_SKILL_LINES) {
        violations.push(`.dsh/skills/${skill.dir}/SKILL.md: ${lines} 行 > ${MAX_SKILL_LINES}`);
      }
    }
    expect(violations).toEqual([]);
  });

  it('正文引用的 references/ scripts/ 资源真实存在', () => {
    const violations: string[] = [];
    for (const skill of loadSkills()) {
      for (const token of new Set(referenceTokens(skill.body))) {
        if (!existsSync(join(SKILLS_ROOT, skill.dir, token))) {
          violations.push(`.dsh/skills/${skill.dir}: 引用的资源不存在 → ${token}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it('编排脚本可被解析（只编译不执行）', () => {
    const source = readFileSync(WORKFLOW_SCRIPT, 'utf-8');
    expect(() => compileWorkflow(source)).not.toThrow();
  });

  it('编排脚本失败路径真实执行：子代理全失败时返回 ok:false，不产出方案', async () => {
    const run = compileWorkflow(readFileSync(WORKFLOW_SCRIPT, 'utf-8'));
    const result = await run(
      async () => null,
      async (thunks: ReadonlyArray<() => Promise<unknown>>) => Promise.all(thunks.map((thunk) => thunk())),
      undefined,
      () => undefined,
      () => undefined,
      { scope: 'demo', focus: ['甲', '乙'] },
    );
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain('所有审计线均未返回结果');
    expect(result.failedLines).toEqual(['甲', '乙']);
    expect(result.proposals).toBeUndefined();
    expect(result.requiresHumanApproval).toBe(false);
  });

  it('编排脚本成功路径真实执行：返回 ok:true、partial 与人工批准门', async () => {
    const run = compileWorkflow(readFileSync(WORKFLOW_SCRIPT, 'utf-8'));
    const result = await run(
      async (prompt: string) => `审计报告：${String(prompt).slice(0, 12)}`,
      async (thunks: ReadonlyArray<() => Promise<unknown>>) => Promise.all(thunks.map((thunk) => thunk())),
      undefined,
      () => undefined,
      () => undefined,
      { scope: 'demo', focus: ['甲'] },
    );
    expect(result.ok).toBe(true);
    expect(result.partial).toBe(false);
    expect(typeof result.issues).toBe('string');
    expect(typeof result.proposals).toBe('string');
    expect(result.requiresHumanApproval).toBe(true);
  });

  it('标准文档 §三 技能清单与目录双向同步，且计数声明等于实测', () => {
    const doc = readFileSync(STANDARD_DOC, 'utf-8');
    const names = skillDirs();
    const listed = listedSkillNames(doc);
    expect(listed.sort()).toEqual([...names].sort());
    expect(listed.length).toBe(names.length);

    const declared = readFileSync(DOCS_README, 'utf-8').match(/\.dsh\/skills\/ \((\d+)\)/);
    expect(declared, 'docs/README.md 目录速览缺少 `.dsh/skills/ (N)` 计数声明').toBeTruthy();
    expect(Number(declared![1])).toBe(names.length);

    // 标准文档里写的预算数字必须与守卫常量一致（数字手抄会漂移）
    expect(doc).toContain(`≤ ${MAX_SKILL_LINES} 行`);
    expect(doc).toContain(`≤ ${MAX_DESCRIPTION_CHARS} 字符`);
  });

  it('唯一入口：旧 AI 配置不回归，AGENTS.md 只有一句指针', () => {
    for (const rel of ['.claude/skills', '.agents/skills', '.claude', '.agents', 'CLAUDE.md', 'apps/portal/CLAUDE.md', 'skills-lock.json']) {
      expect(existsSync(join(REPO_ROOT, rel)), `${rel} 不应回归（2026-10-22 已收敛到 AGENTS.md，见 ADR-027）`).toBe(false);
    }
    const agents = readFileSync(AGENTS_MD, 'utf-8');
    expect([...agents.matchAll(/\.dsh\/skills/g)].length, '`AGENTS.md` 里的 `.dsh/skills` 指针应恰好一处').toBe(1);
    expect([...agents.matchAll(/docs\/agent-governance\.md/g)].length, '`AGENTS.md` 里的标准文档指针应恰好一处').toBe(1);
  });

  it('导航互指：标准文档、.dsh/README、docs/README、根 README、ADR-027 存在且互相指向', () => {
    for (const file of [STANDARD_DOC, DSH_README, ADR]) expect(existsSync(file), file).toBe(true);
    expect(readFileSync(DOCS_README, 'utf-8')).toContain('agent-governance.md');
    expect(readFileSync(ROOT_README, 'utf-8')).toContain('docs/agent-governance.md');
    expect(readFileSync(ADR, 'utf-8')).toContain('.dsh/skills');
    expect(readFileSync(DSH_README, 'utf-8')).toContain('docs/agent-governance.md');
  });
});

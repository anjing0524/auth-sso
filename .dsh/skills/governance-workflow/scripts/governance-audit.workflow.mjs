// 六阶段治理工作流的只读部分（阶段一至三）：系统审计 → 问题清单 → 方案比较。
// 用法：把本文件全文作为 DSH `workflow` 工具的 script；args = { scope, focus?, maxFindings? }。
// 本脚本不修改任何文件；阶段四至六（实施/验证/治理总结）由主 Agent 在人工批准后执行。

const scope =
  typeof args?.scope === 'string' && args.scope.trim() !== ''
    ? args.scope.trim()
    : '整个仓库';
const focus =
  Array.isArray(args?.focus) && args.focus.length > 0
    ? args.focus
    : ['架构与接口契约', '守卫、重复机制与历史包袱', '权限与安全边界', '测试与验证证据'];
const maxFindings =
  Number.isInteger(args?.maxFindings) && args.maxFindings > 0 ? args.maxFindings : 8;

const basePrompt = [
  `你是 AI Agent 系统架构治理的只读审计员。审计范围：${scope}。`,
  '先按名称加载治理技能 governance-architecture 与 governance-change-guard 获取判据；严禁修改任何文件。',
  '硬性要求：',
  '1) 每条结论先给证据：仓库相对路径 + 符号名；不写行号，不引用不存在的文件；',
  '2) 明确区分「已确认事实」与「待验证假设」，不得把猜测写成根因；',
  '3) 每条发现说明：保护或违反了哪个不变量、接口契约或权限边界，根因假设，现有守卫是否有效；',
  '4) 优先根因与架构级修复，不默认「加守卫」；',
  `5) 只输出 Markdown，发现最多 ${maxFindings} 条，每条标注严重度 P0–P3 与「事实/假设」。`,
].join('\n');

phase('阶段一：系统审计');
const audits = await parallel(
  focus.map(
    (item) => () =>
      agent(
        `${basePrompt}\n\n本次审计焦点：${item}。\n输出结构：审计范围 → 证据 → 发现清单 → 本轮未覆盖或证据不足清单。`,
        { label: `审计：${item}` },
      ),
  ),
);

// 子 agent 失败时 agent() 以 null 兑现。不得把「运行时失败」当成「没有发现问题」：
// 全部失败 → 显式失败返回；部分失败 → 记录失败线并继续，最终结果带 failedLines。
const failedLines = audits
  .map((text, index) => (text === null ? focus[index] : null))
  .filter((item) => item !== null);

if (failedLines.length === audits.length) {
  return {
    ok: false,
    scope,
    focus,
    failedLines,
    error: '所有审计线均未返回结果：这是子 agent 运行时失败，不代表「没有发现问题」；请修复运行环境后重跑。',
    readOnly: true,
    requiresHumanApproval: false,
  };
}

phase('阶段二：问题清单');
const auditText = audits
  .map((text, index) => `### 焦点 ${index + 1}：${focus[index]}\n\n${text ?? '（该审计线未返回结果）'}`)
  .join('\n\n');

const issues = await agent(
  [
    '你是治理工作流的汇总者。以下是各审计线报告（全程只读，未修改任何文件）。',
    `其中未返回结果的审计线：${failedLines.length === 0 ? '无' : failedLines.join('、')}。`,
    '请合并重复发现，输出「问题清单」。每条包含：问题描述、证据、根因或最可信假设、影响范围、现有守卫及其有效性、推荐修复方向、预期收益、回归风险、验证方式。',
    '要求：区分「确定的问题 / 可能的问题 / 纯优化建议」；不同审计线对同一缺陷的记录必须去重并标注来源；证据不足的条目放入「待验证」而不是删掉。',
    '',
    auditText,
  ].join('\n'),
  { label: '汇总问题清单' },
);

if (issues === null) {
  return {
    ok: false,
    scope,
    focus,
    failedLines,
    audits,
    error: '问题清单汇总未返回结果：汇总子 agent 运行失败，不产出方案比较。',
    readOnly: true,
    requiresHumanApproval: false,
  };
}

phase('阶段三：方案比较');
const proposals = await agent(
  [
    '基于下面的问题清单，为每个高价值问题比较方案：①最小根因修复 ②架构级修复 ③继续增加守卫。',
    '只有当多个方案确实有意义时才比较，不得为了满足形式要求制造无效选项。',
    '每个方案说明复杂度、风险、可维护性、验证成本与代价；给出推荐方案与理由。',
    '最后输出需要人工批准的决定点，以及建议的验证命令与验收判据。',
    '',
    issues,
  ].join('\n'),
  { label: '方案比较' },
);

if (proposals === null) {
  return {
    ok: false,
    scope,
    focus,
    failedLines,
    audits,
    issues,
    error: '方案比较未返回结果：方案子 agent 运行失败，问题清单仍可用于人工决策。',
    readOnly: true,
    requiresHumanApproval: false,
  };
}

return {
  ok: true,
  partial: failedLines.length > 0,
  scope,
  focus,
  audits,
  failedLines,
  issues,
  proposals,
  readOnly: true,
  requiresHumanApproval: true,
  next: [
    '人工批准选定方案后再进入阶段四（实施）',
    '实施前按 governance-change-guard 建立回归测试与守卫决定记录',
    '完成后用 governance-review 做独立审查',
  ],
};

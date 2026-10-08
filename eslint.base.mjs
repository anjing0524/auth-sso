/**
 * Workspace 通用 ESLint 共享规则
 *
 * 框架无关的 TypeScript 代码规范，由各 app 导入并与框架专用规则组合。
 * 注意：不在此导入 eslint-config-next，保持框架无关性。
 *
 * @module eslint.base
 */

/** @type {import("eslint").Linter.Config[]} */
export const sharedRules = [
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
      }],
      "@typescript-eslint/consistent-type-imports": ["error", {
        prefer: "type-imports",
        fixStyle: "inline-type-imports",
      }],
      "prefer-const": "error",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // ── 复杂度约束（ADR-019 修订）────────────────────────────
      // 行数不是复杂度的好代理：本项目实测 22 个 Server Action 的**最大圈复杂度
      // 仅 8**，而超 20 行的有 14 个——长度来自声明式配置与多行参数，不是逻辑。
      // 故以复杂度为主约束、行数为软兜底（对齐 Checkstyle 150 / SonarJS 200 的
      // 量级，本仓库实测最大 40 逻辑行）。
      //
      // 不引入 `max-params`：实测其违规全部是"恰好 5 参数"的既有工具函数
      // （如 withPagination、verifySignature），改造属纯负担、收益不明。
      // 也不引入认知复杂度：需新增 eslint-plugin-sonarjs，而其 recommended
      // 预设会把几乎所有规则设为 error（存量爆噪音），须逐个手动开启；
      // 且该度量的独立学术验证不完整（见 ADR-019），故记为待评估项。
      "complexity": ["warn", 15],
      "max-depth": ["warn", 4],
      "max-lines-per-function": ["warn", { max: 150, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

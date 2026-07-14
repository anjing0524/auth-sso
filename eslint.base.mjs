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
      "max-lines-per-function": ["warn", { max: 80, skipBlankLines: true, skipComments: true }],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
];

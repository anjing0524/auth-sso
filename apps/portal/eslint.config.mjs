import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { sharedRules } from "../../eslint.base.mjs";

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...nextVitals,
  ...nextTs,
  ...sharedRules,
  // Override default ignores of eslint-config-next.
  {
    ignores: [
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  // Controller 行数上限（ADR-019）：只对「控制器」目录施加，不牵连组件与页面。
  // 区分两类：委托型 ≤20 行（人工评审判断），编排型 ≤30 逻辑行（本规则强制）。
  // 阈值 30 来自本仓库实测的违规断层（无 21~26 行用例，违规集中在 27~38），
  // 而非外部数字；skipBlankLines/skipComments 与基础规则一致（只数逻辑行）。
  {
    files: [
      "src/app/**/actions.ts",
      "src/app/api/**/route.ts",
    ],
    rules: {
      "max-lines-per-function": ["warn", { max: 30, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    files: ["__tests__/**/*.{ts,tsx}", "tests/**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": "warn",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unused-vars": "warn",
      "no-var": "warn",
      // 测试区显式豁免（策略化而非静默堆积警告）：
      // - 测试桩/工厂允许 console 与 any（断言密度优先于类型完整）
      // - 集成测试单函数天然超长（arrange-act-assert 分节）
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "max-lines-per-function": "off",
    },
  },
];

export default eslintConfig;

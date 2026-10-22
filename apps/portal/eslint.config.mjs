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

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
      "@typescript-eslint/consistent-type-imports": "off",
      "@typescript-eslint/no-this-alias": "warn",
      "@typescript-eslint/no-unsafe-function-type": "off",
      "@typescript-eslint/no-unused-vars": "off",
      "no-var": "warn",
      // 测试区显式豁免（策略化而非静默堆积警告）：
      // - 测试桩/工厂允许 console 与 any（断言密度优先于类型完整）
      // - 集成测试单函数天然超长（arrange-act-assert 分节）
      "no-console": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "complexity": "off",
      "max-depth": "off",
    },
  },
  {
    // CLI/迁移/seed 脚本的输出就是产品行为，不是调试残留。
    files: ["scripts/**/*.ts", "vitest.globalSetup.ts"],
    rules: { "no-console": "off" },
  },
  {
    // 客户端日志器的职责就是转发 console。
    files: ["src/lib/logger-client.ts"],
    rules: { "no-console": "off" },
  },
  {
    // 页面/展示组件的复杂度主要来自声明式 JSX；逻辑复杂度门禁只约束
    // Server Action / API 控制器（ADR-019），避免把版式分支当业务复杂度。
    files: ["src/app/**/*.tsx", "src/components/**/*.tsx", "src/hooks/**/*.tsx"],
    rules: { "complexity": "off" },
  },
];

export default eslintConfig;

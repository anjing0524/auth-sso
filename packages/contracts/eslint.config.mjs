/**
 * 包级 ESLint flat config（框架无关）
 *
 * 与 `apps/portal` 的配置区别：本包不含 Next.js，只组合
 * `typescript-eslint` 的推荐集与 workspace 共享规则（`eslint.base.mjs`）。
 *
 * 存在理由（#83）：本包此前**没有** `lint` 脚本 ⇒ 根 `pnpm -r lint` **静默跳过**它，
 * 于是"枚举值唯一真相源"的代码风格问题（未使用导入、`any` 泄漏、
 * `consistent-type-imports`）不会被任何门禁发现。
 */
import tseslint from 'typescript-eslint';
import { sharedRules } from '../../eslint.base.mjs';

export default tseslint.config(
  ...tseslint.configs.recommended,
  ...sharedRules,
  {
    ignores: ['dist/**', 'node_modules/**', 'coverage/**'],
  },
);

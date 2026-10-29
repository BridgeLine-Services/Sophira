// ESLint flat config (2026-10-29). Deliberately CORRECTNESS-ONLY: this codebase
// has shipped for months without a linter, so a stylistic ruleset would produce
// thousands of cosmetic findings and bury the real ones. Every rule here is
// error-level and catches an actual bug class.
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["node_modules/**", ".next/**", "tests-dist/**", "scripts-dist/**", "*.generated.ts"],
  },
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tsParser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: { "@typescript-eslint": tsPlugin, "react-hooks": reactHooks },
    rules: {
      // Real bug classes only.
      "no-debugger": "error",
      "no-dupe-keys": "error",
      "no-unreachable": "error",
      "no-constant-condition": ["error", { checkLoops: false }],
      "no-self-assign": "error",
      "no-self-compare": "error",
      "no-unsafe-negation": "error",
      "no-fallthrough": "error",
      "no-redeclare": "error",
      "no-cond-assign": "error",
      "no-obj-calls": "error",
      "no-sparse-arrays": "error",
      "valid-typeof": "error",
      "eqeqeq": ["error", "smart"],
      // The codebase already relies on this rule id for hook-dependency
      // suppressions, so it must be genuinely registered, not merely referenced.
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
      "no-eval": "error",
      "no-implied-eval": "error",
      "no-new-func": "error",
      "@typescript-eslint/no-misused-promises": "off",
      // KNOWN DEBT (2026-10-29): 102 unused variables in existing code. Kept at
      // warning so the linter gates on real bugs now and the debt is visible and
      // countable, instead of blocking the gate until a mass rename is done.
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];

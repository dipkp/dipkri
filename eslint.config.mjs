// Security-only lint config: no style rules, so the signal stays readable.
import security from "eslint-plugin-security";
import tseslint from "typescript-eslint";

export default [
  {
    ignores: [
      "node_modules/**",
      "build/**",
      "dist/**",
      "desktop/**",
      "**/*.min.js",
      "server/ecosystem.config.js",
    ],
  },
  {
    files: ["server/**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2023,
      sourceType: "module",
    },
    plugins: { security },
    rules: {
      "security/detect-eval-with-expression": "error",
      "security/detect-non-literal-fs-filename": "warn",
      "security/detect-non-literal-regexp": "warn",
      "security/detect-object-injection": "off", // noisy in TS code
      "security/detect-child-process": "warn",
      "security/detect-unsafe-regex": "error",
      "security/detect-disable-mustache-escape": "error",
      "security/detect-possible-timing-attacks": "warn",
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2023,
      sourceType: "module",
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { security },
    rules: {
      "security/detect-eval-with-expression": "error",
      "security/detect-unsafe-regex": "error",
      "security/detect-object-injection": "off",
    },
  },
];

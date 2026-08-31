import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/build/**",
      "artifacts/**",
      "coverage/**",
      ".cache/**",
      "examples/research-console.html",
      "examples/research-ui.html",
    ],
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...js.configs.recommended,
    languageOptions: {
      ...js.configs.recommended.languageOptions,
      globals: { ...globals.node },
    },
    rules: {
      ...js.configs.recommended.rules,
      "no-console": "off",
    },
  },
  {
    files: ["**/*.{ts,tsx,mts,cts}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { sourceType: "module" },
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: { "@typescript-eslint": tseslint.plugin },
    rules: {
      ...js.configs.recommended.rules,
      "no-undef": "off",
      "no-unused-vars": "off",
      "no-console": "off",
      "no-constant-binary-expression": "error",
      "no-debugger": "error",
      "no-dupe-else-if": "error",
      "no-unreachable-loop": "error",
      "no-useless-assignment": "error",
      "@typescript-eslint/no-duplicate-enum-values": "error",
      "@typescript-eslint/no-extra-non-null-assertion": "error",
      "@typescript-eslint/no-non-null-asserted-optional-chain": "error",
    },
  },
);

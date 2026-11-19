import tseslint from "typescript-eslint";

const quoteRule = ["error", "double", { allowTemplateLiterals: true }];

export default tseslint.config(
  {
    ignores: ["dist/**"],
  },
  tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    rules: {
      quotes: quoteRule,
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    rules: {
      quotes: quoteRule,
    },
  },
);

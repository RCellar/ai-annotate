import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import obsidianPlugin from "eslint-plugin-obsidianmd";

export default [
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        project: "./tsconfig.json",
        sourceType: "module",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      obsidianmd: obsidianPlugin,
    },
    rules: {
      "obsidianmd/ui/sentence-case": "error",
      "obsidianmd/no-static-styles-assignment": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
    },
  },
];

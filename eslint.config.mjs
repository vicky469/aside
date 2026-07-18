import js from "@eslint/js";
import json from "@eslint/json";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";


export default defineConfig(
	globalIgnores([
		".agents",
		".aside-dev",
		".claude",
		".codex",
		".obsidian",
		".public-release",
		".test-dist",
		".vscode",
		".worktrees",
		"assets",
		"coverage",
		"dist",
		"docs",
		"logs",
		"main.js",
		"node_modules",
		"**/package-lock.json",
		"references",
		"sidenotes",
		"skills",
		"tests/fixtures",
		"workers/cache-purge-broker/src/worker-configuration.d.ts",
		"workers/cache-purge-broker/test/env.d.ts",
	]),
	{
		name: "aside/inline-configuration-policy",
		linterOptions: {
			noInlineConfig: true,
			reportUnusedDisableDirectives: "error",
			reportUnusedInlineConfigs: "error",
		},
	},
	{
		name: "aside/javascript",
		files: ["**/*.{js,cjs,mjs,jsx}"],
		extends: [js.configs.recommended],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
		},
	},
	{
		name: "aside/typescript",
		files: ["**/*.{ts,cts,mts,tsx}"],
		extends: [tseslint.configs.recommendedTypeChecked],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
	},
	{
		name: "aside/json",
		files: ["**/*.json"],
		language: "json/json",
		...json.configs.recommended,
	},
	{
		name: "aside/jsonc",
		files: ["**/*.jsonc"],
		language: "json/jsonc",
		...json.configs.recommended,
	},
	{
		name: "aside/obsidian-plugin",
		files: ["src/**/*.ts"],
		extends: [obsidianmd.configs.recommended],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				projectService: true,
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/require-await": "error",
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					acronyms: ["JSONL", "URL", "HTTP", "HTTPS", "LAN"],
					brands: ["Aside", "Codex", "Obsidian"],
				},
			],
		},
	},
	{
		name: "aside/obsidian-package",
		files: ["package.json"],
		extends: [obsidianmd.configs.recommended],
	},
	{
		name: "aside/tests",
		files: ["tests/**/*.ts", "workers/**/test/**/*.ts"],
		extends: [tseslint.configs.disableTypeChecked],
		rules: {
			"@typescript-eslint/no-explicit-any": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					args: "all",
					argsIgnorePattern: "^_",
				},
			],
		},
	},
);

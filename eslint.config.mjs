import { globalIgnores } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			globals: {
				...globals.browser,
				...globals.node,
			},
			parserOptions: {
				project: "./tsconfig.json",
				tsconfigRootDir: import.meta.dirname,
			},
		},
		rules: {
			"@typescript-eslint/require-await": "error",
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					acronyms: ["JSONL", "URL"],
					brands: ["SideNote2"],
				},
			],
		},
	},
	globalIgnores([
		".test-dist",
		".public-release",
		"assets",
		"docs",
		"main.js",
		"node_modules",
		"skills",
	]),
);

import { globalIgnores } from "eslint/config";
import globals from "globals";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
	{
		files: ["src/**/*.ts"],
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
			"obsidianmd/ui/sentence-case": [
				"error",
				{
					acronyms: ["JSONL", "URL"],
					brands: ["SideNote2"],
				},
			],
		},
	},
	...obsidianmd.configs.recommended,
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

export interface AsidePublishFrontmatter {
	markdownEnabled: boolean;
	htmlEnabled: boolean;
	html: string | null;
}

interface ParsedMarkdownFrontmatter {
	frontmatter: string | null;
	body: string;
}

interface ParsedAsidePublishFrontmatter {
	markdownEnabled: boolean | null;
	htmlEnabled: boolean | null;
	legacyEnabled: boolean | null;
	html: string | null;
}

const DEFAULT_ASIDE_PUBLISH_FRONTMATTER: AsidePublishFrontmatter = {
	markdownEnabled: false,
	htmlEnabled: false,
	html: null,
};

const DEFAULT_PARSED_ASIDE_PUBLISH_FRONTMATTER: ParsedAsidePublishFrontmatter = {
	markdownEnabled: null,
	htmlEnabled: null,
	legacyEnabled: null,
	html: null,
};

function parseMarkdownFrontmatter(markdown: string): ParsedMarkdownFrontmatter {
	const normalized = markdown.replace(/\r\n/g, "\n");
	if (!normalized.startsWith("---\n")) {
		return {
			frontmatter: null,
			body: normalized,
		};
	}

	const closeIndex = normalized.indexOf("\n---", 4);
	if (closeIndex === -1) {
		return {
			frontmatter: null,
			body: normalized,
		};
	}

	const afterCloseIndex = normalized.startsWith("\n", closeIndex + 4)
		? closeIndex + 5
		: closeIndex + 4;
	return {
		frontmatter: normalized.slice(4, closeIndex),
		body: normalized.slice(afterCloseIndex),
	};
}

function getAsidePublishBlockLines(frontmatter: string): string[] {
	const lines = frontmatter.split("\n");
	const blockLines: string[] = [];
	let inBlock = false;
	for (const line of lines) {
		if (/^asidePublish:\s*$/u.test(line)) {
			inBlock = true;
			blockLines.push(line);
			continue;
		}
		if (inBlock && /^\S/u.test(line)) {
			break;
		}
		if (inBlock) {
			blockLines.push(line);
		}
	}
	return blockLines;
}

function removeAsidePublishBlock(frontmatter: string): string {
	const lines = frontmatter.split("\n");
	const output: string[] = [];
	let skipping = false;
	for (const line of lines) {
		if (/^asidePublish:\s*$/u.test(line)) {
			skipping = true;
			continue;
		}
		if (skipping && /^\S/u.test(line)) {
			skipping = false;
		}
		if (!skipping) {
			output.push(line);
		}
	}
	return output.join("\n").replace(/\n{3,}/gu, "\n\n").trim();
}

function parseScalarBoolean(value: string): boolean | null {
	const normalized = value.trim().toLowerCase();
	if (normalized === "true") {
		return true;
	}
	if (normalized === "false") {
		return false;
	}
	return null;
}

function parseScalarString(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed) {
		return null;
	}
	if (
		(trimmed.startsWith("\"") && trimmed.endsWith("\""))
		|| (trimmed.startsWith("'") && trimmed.endsWith("'"))
	) {
		return trimmed.slice(1, -1).trim() || null;
	}
	return trimmed;
}

export function readAsidePublishFrontmatter(markdown: string): AsidePublishFrontmatter {
	const parsed = parseMarkdownFrontmatter(markdown);
	if (!parsed.frontmatter) {
		return { ...DEFAULT_ASIDE_PUBLISH_FRONTMATTER };
	}

	const result: ParsedAsidePublishFrontmatter = {
		...DEFAULT_PARSED_ASIDE_PUBLISH_FRONTMATTER,
	};
	for (const line of getAsidePublishBlockLines(parsed.frontmatter)) {
		const legacyEnabledMatch = line.match(/^\s+enabled:\s*(.+)\s*$/u);
		if (legacyEnabledMatch) {
			result.legacyEnabled = parseScalarBoolean(legacyEnabledMatch[1]);
			continue;
		}

		const markdownEnabledMatch = line.match(/^\s+markdownEnabled:\s*(.+)\s*$/u);
		if (markdownEnabledMatch) {
			result.markdownEnabled = parseScalarBoolean(markdownEnabledMatch[1]);
			continue;
		}

		const htmlEnabledMatch = line.match(/^\s+htmlEnabled:\s*(.+)\s*$/u);
		if (htmlEnabledMatch) {
			result.htmlEnabled = parseScalarBoolean(htmlEnabledMatch[1]);
			continue;
		}

		const htmlMatch = line.match(/^\s+html:\s*(.+)\s*$/u);
		if (htmlMatch) {
			result.html = parseScalarString(htmlMatch[1]);
		}
	}

	const legacyEnabled = result.legacyEnabled ?? false;
	return {
		markdownEnabled: result.markdownEnabled ?? false,
		htmlEnabled: result.htmlEnabled ?? legacyEnabled,
		html: result.html,
	};
}

function formatAsidePublishFrontmatter(value: AsidePublishFrontmatter): string {
	const lines = [
		"asidePublish:",
		`  markdownEnabled: ${value.markdownEnabled ? "true" : "false"}`,
		`  htmlEnabled: ${value.htmlEnabled ? "true" : "false"}`,
	];
	if (value.html) {
		lines.push(`  html: ${value.html}`);
	}
	return lines.join("\n");
}

export function writeAsidePublishFrontmatter(markdown: string, value: AsidePublishFrontmatter): string {
	const parsed = parseMarkdownFrontmatter(markdown);
	const existingFrontmatter = parsed.frontmatter ? removeAsidePublishBlock(parsed.frontmatter) : "";
	const nextFrontmatter = [
		existingFrontmatter,
		formatAsidePublishFrontmatter(value),
	].filter(Boolean).join("\n");

	return [
		"---",
		nextFrontmatter,
		"---",
		parsed.body,
	].join("\n");
}

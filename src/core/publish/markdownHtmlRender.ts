export interface RenderMarkdownToBasicHtmlOptions {
	sourcePath: string;
	markdown: string;
}

interface MarkdownBlock {
	type: "paragraph" | "heading" | "unordered-list" | "ordered-list" | "blockquote" | "code";
	level?: number;
	language?: string;
	lines: string[];
}

const UNSAFE_LINK_PROTOCOL_PATTERN = /^[a-z][a-z\d+.-]*:/iu;
const SAFE_LINK_PROTOCOL_PATTERN = /^(?:https?:|mailto:)/iu;
const INLINE_LINE_BREAK_MARKER = "\u0000ASIDE_LINE_BREAK\u0000\n";

export function deriveMarkdownHtmlPublishPath(sourcePath: string): string {
	return sourcePath.replace(/\.md$/iu, ".html");
}

export function renderMarkdownToBasicHtml(options: RenderMarkdownToBasicHtmlOptions): string {
	const markdown = stripFrontmatter(options.markdown.replace(/\r\n/g, "\n"));
	const blocks = parseBlocks(markdown);
	const title = findTitle(blocks) ?? fallbackTitle(options.sourcePath);
	const body = blocks.map(renderBlock).join("\n");
	return [
		"<!doctype html>",
		"<html lang=\"en\">",
		"<head>",
		"<meta charset=\"utf-8\">",
		"<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">",
		`<title>${escapeHtml(title)}</title>`,
		"<style>",
		":root{color-scheme:light dark;font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;}",
		"body{margin:0;background:Canvas;color:CanvasText;}",
		"main{max-width:760px;margin:0 auto;padding:48px 24px 72px;line-height:1.62;font-size:17px;}",
		"h1,h2,h3,h4,h5,h6{line-height:1.25;margin:1.8em 0 .55em;}",
		"h1{font-size:2rem;margin-top:0;}h2{font-size:1.55rem;}h3{font-size:1.25rem;}",
		"p,ul,ol,blockquote,pre{margin:0 0 1.1em;}",
		"ul,ol{padding-left:1.5em;}blockquote{border-left:4px solid color-mix(in srgb, CanvasText 22%, transparent);padding-left:1em;color:color-mix(in srgb, CanvasText 74%, transparent);}",
		"code{font-family:\"SFMono-Regular\",Consolas,\"Liberation Mono\",monospace;font-size:.92em;background:color-mix(in srgb, CanvasText 8%, transparent);padding:.12em .28em;border-radius:4px;}",
		"pre{overflow:auto;background:color-mix(in srgb, CanvasText 8%, transparent);padding:1em;border-radius:8px;}pre code{background:transparent;padding:0;}",
		"img{max-width:100%;height:auto;display:block;margin:1.25em auto;border-radius:8px;}",
		"a{color:#6d47ff;text-underline-offset:.18em;}",
		".aside-publish-tag{color:#2563eb;font-weight:500;}",
		"@media (prefers-color-scheme:dark){.aside-publish-tag{color:#60a5fa;}}",
		"@media (max-width:640px){main{padding:32px 18px 56px;font-size:16px;}}",
		"</style>",
		"</head>",
		"<body>",
		`<main>${body || "<p></p>"}</main>`,
		"</body>",
		"</html>",
	].join("\n");
}

function stripFrontmatter(markdown: string): string {
	if (!markdown.startsWith("---\n")) {
		return markdown;
	}
	const closeIndex = markdown.indexOf("\n---", 4);
	if (closeIndex === -1) {
		return markdown;
	}
	const afterCloseIndex = markdown.startsWith("\n", closeIndex + 4)
		? closeIndex + 5
		: closeIndex + 4;
	return markdown.slice(afterCloseIndex);
}

function parseBlocks(markdown: string): MarkdownBlock[] {
	const lines = markdown.split("\n");
	const blocks: MarkdownBlock[] = [];
	let paragraph: string[] = [];
	let listType: "unordered-list" | "ordered-list" | null = null;
	let listLines: string[] = [];
	let blockquote: string[] = [];
	let codeLines: string[] | null = null;
	let codeLanguage = "";

	const flushParagraph = () => {
		if (paragraph.length === 0) {
			return;
		}
		blocks.push({ type: "paragraph", lines: paragraph });
		paragraph = [];
	};
	const flushList = () => {
		if (!listType) {
			return;
		}
		blocks.push({ type: listType, lines: listLines });
		listType = null;
		listLines = [];
	};
	const flushBlockquote = () => {
		if (blockquote.length === 0) {
			return;
		}
		blocks.push({ type: "blockquote", lines: blockquote });
		blockquote = [];
	};
	const flushTextBlocks = () => {
		flushParagraph();
		flushList();
		flushBlockquote();
	};

	for (const rawLine of lines) {
		const line = rawLine.replace(/\s+$/u, "");
		if (codeLines) {
			if (/^```/u.test(line)) {
				blocks.push({ type: "code", language: codeLanguage, lines: codeLines });
				codeLines = null;
				codeLanguage = "";
			} else {
				codeLines.push(rawLine);
			}
			continue;
		}
		const fenceMatch = line.match(/^```\s*([\w-]+)?\s*$/u);
		if (fenceMatch) {
			flushTextBlocks();
			codeLines = [];
			codeLanguage = fenceMatch[1] ?? "";
			continue;
		}
		if (!line.trim()) {
			flushTextBlocks();
			continue;
		}
		const headingMatch = line.match(/^(#{1,6})\s+(.+)$/u);
		if (headingMatch) {
			flushTextBlocks();
			blocks.push({
				type: "heading",
				level: headingMatch[1].length,
				lines: [headingMatch[2].trim()],
			});
			continue;
		}
		const unorderedMatch = line.match(/^\s*[-*]\s+(.+)$/u);
		if (unorderedMatch) {
			flushParagraph();
			flushBlockquote();
			if (listType !== "unordered-list") {
				flushList();
				listType = "unordered-list";
			}
			listLines.push(unorderedMatch[1].trim());
			continue;
		}
		const orderedMatch = line.match(/^\s*\d+[.)]\s+(.+)$/u);
		if (orderedMatch) {
			flushParagraph();
			flushBlockquote();
			if (listType !== "ordered-list") {
				flushList();
				listType = "ordered-list";
			}
			listLines.push(orderedMatch[1].trim());
			continue;
		}
		const quoteMatch = line.match(/^\s*>\s?(.+)$/u);
		if (quoteMatch) {
			flushParagraph();
			flushList();
			blockquote.push(quoteMatch[1].trim());
			continue;
		}
		flushList();
		flushBlockquote();
		paragraph.push(line.trim());
	}

	if (codeLines) {
		blocks.push({ type: "code", language: codeLanguage, lines: codeLines });
	}
	flushTextBlocks();
	return blocks;
}

function renderBlock(block: MarkdownBlock): string {
	switch (block.type) {
		case "heading": {
			const level = block.level ?? 1;
			return `<h${level}>${renderInline(block.lines[0])}</h${level}>`;
		}
		case "unordered-list":
			return `<ul>\n${block.lines.map((line) => `<li>${renderInline(line)}</li>`).join("\n")}\n</ul>`;
		case "ordered-list":
			return `<ol>\n${block.lines.map((line) => `<li>${renderInline(line)}</li>`).join("\n")}\n</ol>`;
		case "blockquote":
			return `<blockquote>\n<p>${renderInlineLines(block.lines)}</p>\n</blockquote>`;
		case "code": {
			const languageClass = block.language ? ` class="language-${escapeAttribute(block.language)}"` : "";
			return `<pre><code${languageClass}>${escapeHtml(block.lines.join("\n"))}\n</code></pre>`;
		}
		case "paragraph":
		default:
			return `<p>${renderInlineLines(block.lines)}</p>`;
	}
}

function renderInlineLines(lines: string[]): string {
	return renderInline(lines.join(INLINE_LINE_BREAK_MARKER));
}

function replaceInlineLineBreakMarkers(value: string, replacement: string): string {
	return value.split(INLINE_LINE_BREAK_MARKER).join(replacement);
}

function renderInline(value: string): string {
	const inlineHtml: string[] = [];
	const stashInlineHtml = (html: string): string => {
		const marker = `\u0000INLINE${inlineHtml.length}\u0000`;
		inlineHtml.push(html);
		return marker;
	};
	let html = value.replace(/`([^`]+)`/gu, (_match, code: string) => {
		const normalizedCode = replaceInlineLineBreakMarkers(code, "\n");
		return stashInlineHtml(`<code>${escapeHtml(normalizedCode)}</code>`);
	});

	html = html.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/gu, (_match, label: string, src: string) => {
		if (src.includes(INLINE_LINE_BREAK_MARKER)) {
			return plainText(replaceInlineLineBreakMarkers(label, " "));
		}
		const safeSrc = sanitizeImageSrc(src);
		const alt = plainText(replaceInlineLineBreakMarkers(label, " "));
		if (!safeSrc) {
			return alt;
		}
		return stashInlineHtml(`<img src="${escapeAttribute(safeSrc)}" alt="${escapeAttribute(alt)}" loading="lazy">`);
	});
	html = html.replace(/\[([^\]]+)\]\(([^)\n]+)\)/gu, (_match, label: string, href: string) => {
		const renderedLabel = renderInline(label);
		if (href.includes(INLINE_LINE_BREAK_MARKER)) {
			return stashInlineHtml(renderedLabel);
		}
		const safeHref = sanitizeHref(href);
		return safeHref
			? stashInlineHtml(`<a href="${escapeAttribute(safeHref)}">${renderedLabel}</a>`)
			: stashInlineHtml(renderedLabel);
	});
	html = html.replace(/\\#/gu, () => stashInlineHtml("#"));
	html = escapeHtml(unescapeMarkdownPunctuation(html));
	html = html.replace(
		/(^|\s)(#[\p{L}\p{M}\p{N}_/-]+)/gu,
		(_match, prefix: string, tag: string) =>
			`${prefix}<span class="aside-publish-tag">${tag}</span>`,
	);
	html = html.replace(/(^|[^\\])\*\*([^*]+)\*\*/gu, "$1<strong>$2</strong>");
	html = html.replace(/(^|[^\\])\*([^*]+)\*/gu, "$1<em>$2</em>");

	for (let index = 0; index < inlineHtml.length; index += 1) {
		html = html.replace(`\u0000INLINE${index}\u0000`, inlineHtml[index]);
	}
	return replaceInlineLineBreakMarkers(html, "<br>\n");
}

function sanitizeImageSrc(value: string): string | null {
	const trimmed = value.trim();
	if (UNSAFE_LINK_PROTOCOL_PATTERN.test(trimmed) && !/^https?:/iu.test(trimmed)) {
		return null;
	}
	return trimmed;
}

function sanitizeHref(value: string): string | null {
	const trimmed = value.trim();
	if (UNSAFE_LINK_PROTOCOL_PATTERN.test(trimmed) && !SAFE_LINK_PROTOCOL_PATTERN.test(trimmed)) {
		return null;
	}
	return trimmed;
}

function findTitle(blocks: MarkdownBlock[]): string | null {
	const heading = blocks.find((block) => block.type === "heading");
	return heading ? plainText(heading.lines[0]) : null;
}

function fallbackTitle(sourcePath: string): string {
	const fileName = sourcePath.split("/").pop() ?? sourcePath;
	return fileName.replace(/\.md$/iu, "");
}

function plainText(value: string): string {
	return unescapeMarkdownPunctuation(value).replace(/[`*_#[\]()]/gu, "").trim();
}

function unescapeMarkdownPunctuation(value: string): string {
	return value.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/gu, "$1");
}

function escapeHtml(value: string): string {
	return value
		.replace(/&/gu, "&amp;")
		.replace(/</gu, "&lt;")
		.replace(/>/gu, "&gt;")
		.replace(/"/gu, "&quot;");
}

function escapeAttribute(value: string): string {
	return escapeHtml(value).replace(/'/gu, "&#39;");
}

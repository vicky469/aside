# Rendered Markdown Publish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish `.md` source files as generated readable `.html` pages while keeping Markdown publish state in existing Aside frontmatter.

**Architecture:** Add a dependency-free renderer in `src/core/publish/` and keep the Obsidian-facing publish controller as the integration point. The controller derives `.html` paths from `.md` sources for public URLs, deployment snapshots, and cache purges, while leaving explicit paired HTML and PDF artifact behavior intact.

**Tech Stack:** TypeScript, Node test runner, existing `PublicHtmlPublishController` test harness, existing release artifact guard.

---

### Task 1: Markdown Render Unit

**Files:**
- Create: `src/core/publish/markdownHtmlRender.ts`
- Create: `tests/markdownHtmlRender.test.ts`

- [ ] **Step 1: Write failing renderer tests**

Create `tests/markdownHtmlRender.test.ts` with these tests:

```ts
import * as assert from "node:assert/strict";
import test from "node:test";
import {
	deriveMarkdownHtmlPublishPath,
	renderMarkdownToBasicHtml,
} from "../src/core/publish/markdownHtmlRender";

test("deriveMarkdownHtmlPublishPath converts markdown paths to html paths", () => {
	assert.equal(deriveMarkdownHtmlPublishPath("public/page.md"), "public/page.html");
	assert.equal(deriveMarkdownHtmlPublishPath("public/nested/page.MD"), "public/nested/page.html");
});

test("renderMarkdownToBasicHtml renders readable markdown without frontmatter", () => {
	const html = renderMarkdownToBasicHtml({
		sourcePath: "public/page.md",
		markdown: [
			"---",
			"title: Private title",
			"asidePublish:",
			"  markdownEnabled: true",
			"---",
			"# Public Page",
			"",
			"Intro with **bold**, *emphasis*, `code`, and [Aside](https://example.com).",
			"",
			"- Alpha",
			"- Beta",
			"",
			"1. One",
			"2. Two",
			"",
			"> Quoted text",
			"",
			"```ts",
			"const value = 1 < 2;",
			"```",
		].join("\n"),
	});

	assert.match(html, /^<!doctype html>/u);
	assert.match(html, /<title>Public Page<\/title>/u);
	assert.match(html, /<h1>Public Page<\/h1>/u);
	assert.match(html, /<strong>bold<\/strong>/u);
	assert.match(html, /<em>emphasis<\/em>/u);
	assert.match(html, /<code>code<\/code>/u);
	assert.match(html, /<a href="https:\/\/example\.com">Aside<\/a>/u);
	assert.match(html, /<ul>\s*<li>Alpha<\/li>\s*<li>Beta<\/li>\s*<\/ul>/u);
	assert.match(html, /<ol>\s*<li>One<\/li>\s*<li>Two<\/li>\s*<\/ol>/u);
	assert.match(html, /<blockquote>\s*<p>Quoted text<\/p>\s*<\/blockquote>/u);
	assert.match(html, /<pre><code class="language-ts">const value = 1 &lt; 2;\n<\/code><\/pre>/u);
	assert.doesNotMatch(html, /asidePublish/u);
	assert.doesNotMatch(html, /Private title/u);
});

test("renderMarkdownToBasicHtml escapes raw html and unsafe links", () => {
	const html = renderMarkdownToBasicHtml({
		sourcePath: "public/security.md",
		markdown: [
			"# Security",
			"",
			"<script>alert(1)</script>",
			"",
			"[bad](javascript:alert(1))",
			"[good](/public/page.html)",
		].join("\n"),
	});

	assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/u);
	assert.doesNotMatch(html, /<script>/u);
	assert.match(html, /bad/u);
	assert.doesNotMatch(html, /href="javascript:alert\(1\)"/u);
	assert.match(html, /<a href="\/public\/page\.html">good<\/a>/u);
});

test("renderMarkdownToBasicHtml falls back to the source basename for title", () => {
	const html = renderMarkdownToBasicHtml({
		sourcePath: "public/no-heading.md",
		markdown: "Plain text only.",
	});

	assert.match(html, /<title>no-heading<\/title>/u);
	assert.match(html, /<p>Plain text only\.<\/p>/u);
});
```

- [ ] **Step 2: Run renderer tests to verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/markdownHtmlRender.test.js
```

Expected: TypeScript fails because `src/core/publish/markdownHtmlRender.ts` does not exist, or the Node test fails because the exported functions do not exist.

- [ ] **Step 3: Implement the renderer module**

Create `src/core/publish/markdownHtmlRender.ts`:

```ts
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
		"a{color:#6d47ff;text-underline-offset:.18em;}",
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
		blocks.push({ type: "paragraph", lines: [paragraph.join(" ")] });
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
		blocks.push({ type: "blockquote", lines: [blockquote.join(" ")] });
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
			return `<blockquote>\n<p>${renderInline(block.lines[0])}</p>\n</blockquote>`;
		case "code": {
			const languageClass = block.language ? ` class="language-${escapeAttribute(block.language)}"` : "";
			return `<pre><code${languageClass}>${escapeHtml(block.lines.join("\n"))}\n</code></pre>`;
		}
		case "paragraph":
		default:
			return `<p>${renderInline(block.lines[0])}</p>`;
	}
}

function renderInline(value: string): string {
	const codeSpans: string[] = [];
	let html = escapeHtml(value).replace(/`([^`]+)`/gu, (_match, code: string) => {
		const marker = `\u0000CODE${codeSpans.length}\u0000`;
		codeSpans.push(`<code>${code}</code>`);
		return marker;
	});

	html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/gu, (_match, label: string, href: string) => {
		const renderedLabel = renderInline(label);
		const safeHref = sanitizeHref(href);
		return safeHref ? `<a href="${escapeAttribute(safeHref)}">${renderedLabel}</a>` : renderedLabel;
	});
	html = html.replace(/\*\*([^*]+)\*\*/gu, "<strong>$1</strong>");
	html = html.replace(/\*([^*]+)\*/gu, "<em>$1</em>");

	for (let index = 0; index < codeSpans.length; index += 1) {
		html = html.replace(`\u0000CODE${index}\u0000`, codeSpans[index]);
	}
	return html;
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
	return value.replace(/[`*_#[\]()]/gu, "").trim();
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
```

- [ ] **Step 4: Run renderer tests to verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/markdownHtmlRender.test.js
```

Expected: Node test output reports all `markdownHtmlRender` subtests passing.

- [ ] **Step 5: Commit renderer unit**

Run:

```bash
git add src/core/publish/markdownHtmlRender.ts tests/markdownHtmlRender.test.ts
git commit -m "feat(publish): render markdown as html"
```

Expected: Git creates a commit containing only the renderer module and renderer tests.

### Task 2: Markdown Publish URLs And Snapshot Paths

**Files:**
- Modify: `src/publish/publicHtmlPublishController.ts`
- Modify: `tests/publicHtmlPublishController.test.ts`

- [ ] **Step 1: Update controller tests for derived Markdown URLs**

In `tests/publicHtmlPublishController.test.ts`, add or update tests so Markdown publish state uses the derived HTML path:

```ts
test("public html publish controller resolves markdown source files to generated html actions", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n",
		},
	});

	assert.deepEqual(await harness.controller.getFileActionStates("public/page.md"), [{
		kind: "unpublish",
		label: "Unpublish Markdown",
		icon: "cloud-off",
		disabled: false,
	}, {
		kind: "update-publish",
		label: "Republish Markdown",
		icon: "upload-cloud",
		disabled: false,
	}, {
		kind: "open-published",
		label: "Open published Markdown",
		icon: "external-link",
		disabled: false,
		url: "https://publish.example.com/public/page.html",
	}]);
});

test("public html publish controller publishes markdown as generated html", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: false\n  htmlEnabled: false\n---\n# Page\n\nBody text.\n",
		},
	});

	const result = await harness.controller.publishFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page.html",
	});
	assert.match(harness.files.get("public/page.md") ?? "", /asidePublish:\n  markdownEnabled: true\n  htmlEnabled: false/u);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/page.html",
	]);
	const html = decodeSnapshotContents(harness.deployCalls.at(-1)![0]);
	assert.match(html, /<h1>Page<\/h1>/u);
	assert.match(html, /<p>Body text\.<\/p>/u);
	assert.doesNotMatch(html, /asidePublish/u);
});

test("public html publish controller unpublishes markdown and purges generated html URL", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n",
		},
	});

	const result = await harness.controller.unpublishFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page.html",
	});
	assert.match(harness.files.get("public/page.md") ?? "", /asidePublish:\n  markdownEnabled: false\n  htmlEnabled: false/u);
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page.html",
		sourcePath: "public/page.md",
		event: "unpublish",
	}]);
});

test("public html publish controller republished markdown purges generated html URL", async () => {
	const harness = createHarness({
		files: {
			"public/page.md": "---\nasidePublish:\n  markdownEnabled: true\n  htmlEnabled: false\n---\n# Page\n\nUpdated.\n",
		},
	});

	const result = await harness.controller.updatePublishedFile("public/page.md");

	assert.deepEqual(result, {
		ok: true,
		url: "https://publish.example.com/public/page.html",
	});
	assert.deepEqual(harness.purgeCalls, [{
		url: "https://publish.example.com/public/page.html",
		sourcePath: "public/page.md",
		event: "republish",
	}]);
	assert.deepEqual(harness.deployCalls.at(-1)?.map((file) => file.vaultRelativePath), [
		"public/page.html",
	]);
});
```

Then update existing expectations that currently assert `/public/page.md` as a public URL or `public/page.md` as a staged snapshot artifact for `markdownEnabled: true`.

- [ ] **Step 2: Run controller tests to verify URL/path failures**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: tests fail because the controller still stages raw `.md` files and returns `/public/page.md` for Markdown publish actions.

- [ ] **Step 3: Import renderer helpers and add URL helper**

In `src/publish/publicHtmlPublishController.ts`, add this import:

```ts
import {
	deriveMarkdownHtmlPublishPath,
	renderMarkdownToBasicHtml,
} from "../core/publish/markdownHtmlRender";
```

Add this helper near `normalizePublicFilePath`:

```ts
function buildPublishedMarkdownArtifactPath(sourcePath: string): string {
	return deriveMarkdownHtmlPublishPath(sourcePath);
}
```

- [ ] **Step 4: Return derived HTML URLs for Markdown actions**

In `getMarkdownFileActionStates`, replace the published action path:

```ts
if (frontmatter.markdownEnabled) {
	return this.publishedActionStates(settings, buildPublishedMarkdownArtifactPath(sourcePath), "Markdown");
}
```

In `publishMarkdownFile`, replace the returned URL path:

```ts
return {
	ok: true,
	url: buildPublishPublicUrl({
		baseUrl: settings.publishBaseUrl,
		vaultRelativePath: buildPublishedMarkdownArtifactPath(sourcePath),
	}),
};
```

In `unpublishMarkdownFile`, replace the cache purge target:

```ts
return this.buildCachePurgeResult(
	settings,
	buildPublishedMarkdownArtifactPath(sourcePath),
	sourcePath,
	"unpublish",
);
```

In `updatePublishedMarkdownFile`, replace the cache purge target:

```ts
return this.buildCachePurgeResult(
	settings,
	buildPublishedMarkdownArtifactPath(sourcePath),
	sourcePath,
	"republish",
);
```

- [ ] **Step 5: Stage generated HTML for Markdown publish state**

In `deployEnabledSnapshot`, replace the `frontmatter.markdownEnabled` artifact inspection and snapshot push with generated HTML:

```ts
if (frontmatter.markdownEnabled) {
	if (!(await this.host.fileExists(sourcePath))) {
		return {
			ok: false,
			notice: `Publish file missing: ${sourcePath}`,
		};
	}
	const markdownArtifactPath = buildPublishedMarkdownArtifactPath(sourcePath);
	const htmlContents = renderMarkdownToBasicHtml({
		sourcePath,
		markdown: nextSourceContents,
	});
	const markdownInspection = inspectPublishArtifact({
		vaultRelativePath: markdownArtifactPath,
		allowedRoot: settings.publishAllowedRoot,
		configDir: this.host.getVaultConfigDir(),
		contents: htmlContents,
	});
	if (!markdownInspection.ok) {
		return markdownInspection;
	}
	snapshotFiles.push({
		vaultRelativePath: markdownArtifactPath,
		contents: htmlContents,
	});
}
```

- [ ] **Step 6: Run controller tests to verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publicHtmlPublishController.test.js
```

Expected: all `publicHtmlPublishController` tests pass with generated `.html` Markdown artifacts.

- [ ] **Step 7: Commit controller changes**

Run:

```bash
git add src/publish/publicHtmlPublishController.ts tests/publicHtmlPublishController.test.ts
git commit -m "fix(publish): deploy markdown as html"
```

Expected: Git creates a commit containing only controller and controller test changes.

### Task 3: Artifact Guard And Regression Sweep

**Files:**
- Modify: `src/core/publish/publishArtifactGuard.ts`
- Modify: `tests/publishArtifactGuard.test.ts`
- Modify: `docs/superpowers/specs/2026-07-23-rendered-markdown-publish-design.md`

- [ ] **Step 1: Update guard tests to prevent raw Markdown artifacts**

In `tests/publishArtifactGuard.test.ts`, replace the Markdown allow test with:

```ts
test("inspectPublishArtifact blocks raw Markdown files as publish artifacts", () => {
	assert.deepEqual(inspect("share/page.md", "# Draft"), {
		ok: false,
		notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
	});
});

test("inspectPublishArtifact allows generated Markdown HTML files under the configured publish root", () => {
	assert.deepEqual(inspect("share/page.html", "<!doctype html><html><body><h1>Draft</h1></body></html>"), { ok: true });
});
```

Also update the unsupported type expectation:

```ts
assert.deepEqual(inspect("share/page.css", "body {}"), {
	ok: false,
	notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
});
```

- [ ] **Step 2: Run guard tests to verify they fail**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publishArtifactGuard.test.js
```

Expected: tests fail because the guard still allows `.md` artifacts and reports Markdown in the allowed extension notice.

- [ ] **Step 3: Remove `.md` from publish artifact extensions**

In `src/core/publish/publishArtifactGuard.ts`, update the allowed extension check and the notice so raw Markdown is no longer accepted as a deployable artifact:

```ts
if (!/\.(?:pdf|html?)$/iu.test(input.vaultRelativePath)) {
	return {
		ok: false,
		notice: "Publish failed: only .html, .htm, and .pdf files can be published in this version.",
	};
}
```

Keep the rest of the guard unchanged so `.env*`, `.map`, source-map markers, keys, certs, logs, and paths outside the publish root remain blocked.

- [ ] **Step 4: Run guard tests to verify they pass**

Run:

```bash
./node_modules/.bin/tsc -p tsconfig.test.json && node --test .test-dist/tests/publishArtifactGuard.test.js
```

Expected: all `publishArtifactGuard` tests pass.

- [ ] **Step 5: Run full test, lint, typecheck, and build**

Run:

```bash
npm run test
npm run lint
npm run typecheck
npm run build
```

Expected:

- `npm run test` completes with all Node tests passing.
- `npm run lint` completes with zero warnings and zero errors.
- `npm run typecheck` completes with exit code 0.
- `npm run build` completes with exit code 0 and runs `release:artifacts:check`.

- [ ] **Step 6: Update spec implementation tracking**

In `docs/superpowers/specs/2026-07-23-rendered-markdown-publish-design.md`, mark each completed implementation and verification item `[x]` only after the command output above confirms it.

The implementation tracking should end with these checked items:

```md
- [x] Add a deterministic basic Markdown-to-HTML renderer for publish snapshots.
- [x] Strip YAML frontmatter from generated public HTML bodies.
- [x] Escape raw Markdown HTML so generated pages do not execute embedded scripts or arbitrary tags.
- [x] Publish Markdown source files as derived `.html` snapshot files instead of raw `.md` files.
- [x] Return and open the derived `.html` public URL for Markdown publish actions.
- [x] Purge the derived `.html` public URL when Markdown pages are unpublished or republished.
- [x] Keep `asidePublish.markdownEnabled` as the persisted state for Markdown source publishing.
- [x] Keep explicit paired `.html` publishing and direct PDF publishing unchanged.
```

And the verification checklist should reflect the tests and `npm run build` that passed.

- [ ] **Step 7: Commit guard, verification, and spec tracking**

Run:

```bash
git add src/core/publish/publishArtifactGuard.ts tests/publishArtifactGuard.test.ts docs/superpowers/specs/2026-07-23-rendered-markdown-publish-design.md
git commit -m "test(publish): block raw markdown artifacts"
```

Expected: Git creates a commit containing the guard update, guard tests, and verified spec tracking.

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

test("renderMarkdownToBasicHtml renders markdown images with safe sources", () => {
	const html = renderMarkdownToBasicHtml({
		sourcePath: "public/image.md",
		markdown: [
			"# Image",
			"",
			"![Image](https://example.com/cover.jpg?width=640&from=app#img)",
			"![Unsafe](javascript:alert(1))",
		].join("\n"),
	});

	assert.match(
		html,
		/<img src="https:\/\/example\.com\/cover\.jpg\?width=640&amp;from=app#img" alt="Image" loading="lazy">/u,
	);
	assert.doesNotMatch(html, /!<a/u);
	assert.doesNotMatch(html, /&amp;amp;/u);
	assert.doesNotMatch(html, /javascript:alert/u);
	assert.match(html, /Unsafe/u);
});

test("renderMarkdownToBasicHtml unescapes readable markdown punctuation", () => {
	const html = renderMarkdownToBasicHtml({
		sourcePath: "public/timestamps.md",
		markdown: [
			"# Timestamps",
			"",
			"\\[00:00:01\\]",
			"",
			"## \\## \\[03:17:47\\]",
			"",
			"Loss is \\(1\\%\\) to \\(2\\%\\).",
		].join("\n"),
	});

	assert.match(html, /<p>\[00:00:01\]<\/p>/u);
	assert.match(html, /<h2>## \[03:17:47\]<\/h2>/u);
	assert.match(html, /<p>Loss is \(1%\) to \(2%\)\.<\/p>/u);
	assert.doesNotMatch(html, /\\\[/u);
});

test("renderMarkdownToBasicHtml falls back to the source basename for title", () => {
	const html = renderMarkdownToBasicHtml({
		sourcePath: "public/no-heading.md",
		markdown: "Plain text only.",
	});

	assert.match(html, /<title>no-heading<\/title>/u);
	assert.match(html, /<p>Plain text only\.<\/p>/u);
});

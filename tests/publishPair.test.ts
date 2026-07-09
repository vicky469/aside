import * as assert from "node:assert/strict";
import test from "node:test";
import {
	resolvePublicHtmlPairContext,
	resolvePublicHtmlPairForHtml,
	resolvePublicHtmlPairForSource,
} from "../src/core/publish/publishPair";

test("resolvePublicHtmlPairForHtml pairs public html with same basename markdown", () => {
	assert.deepEqual(resolvePublicHtmlPairForHtml({
		htmlPath: "public/page.html",
		allowedRoot: "public/",
	}), {
		ok: true,
		sourcePath: "public/page.md",
		htmlPath: "public/page.html",
	});
});

test("resolvePublicHtmlPairForHtml treats language-suffixed html as an artifact of the base markdown file", () => {
	assert.deepEqual(resolvePublicHtmlPairForHtml({
		htmlPath: "public/page.zh.html",
		allowedRoot: "public/",
	}), {
		ok: true,
		sourcePath: "public/page.md",
		htmlPath: "public/page.zh.html",
	});
});

test("resolvePublicHtmlPairForSource infers same basename html", () => {
	assert.deepEqual(resolvePublicHtmlPairForSource({
		sourcePath: "public/page.md",
		frontmatterHtmlPath: null,
		allowedRoot: "public/",
	}), {
		ok: true,
		sourcePath: "public/page.md",
		htmlPath: "public/page.html",
	});
});

test("resolvePublicHtmlPairForSource accepts explicit public html", () => {
	assert.deepEqual(resolvePublicHtmlPairForSource({
		sourcePath: "public/page.md",
		frontmatterHtmlPath: "public/generated/page.htm",
		allowedRoot: "public/",
	}), {
		ok: true,
		sourcePath: "public/page.md",
		htmlPath: "public/generated/page.htm",
	});
});

test("resolvePublicHtmlPairContext treats markdown and html surfaces as one pair", () => {
	assert.deepEqual(resolvePublicHtmlPairContext({
		filePath: "public/page.md",
		allowedRoot: "public/",
	}), {
		sourcePath: "public/page.md",
		htmlPath: "public/page.html",
		displayPath: "public/page.html",
		paths: ["public/page.md", "public/page.html"],
	});

	assert.deepEqual(resolvePublicHtmlPairContext({
		filePath: "public/page.html",
		allowedRoot: "public/",
	}), {
		sourcePath: "public/page.md",
		htmlPath: "public/page.html",
		displayPath: "public/page.html",
		paths: ["public/page.md", "public/page.html"],
	});
});

test("resolvePublicHtmlPairContext ignores files outside the publish pair model", () => {
	assert.equal(resolvePublicHtmlPairContext({
		filePath: "docs/page.md",
		allowedRoot: "public/",
	}), null);
	assert.equal(resolvePublicHtmlPairContext({
		filePath: "public/asset.css",
		allowedRoot: "public/",
	}), null);
});

test("resolvePublicHtmlPair rejects files outside public", () => {
	assert.deepEqual(resolvePublicHtmlPairForHtml({
		htmlPath: "page.html",
		allowedRoot: "public/",
	}), {
		ok: false,
		notice: "Publish file must be inside public/.",
	});

	assert.deepEqual(resolvePublicHtmlPairForHtml({
		htmlPath: "private/page.html",
		allowedRoot: "public/",
	}), {
		ok: false,
		notice: "Publish file must be inside public/.",
	});

	assert.deepEqual(resolvePublicHtmlPairForSource({
		sourcePath: "public/page.md",
		frontmatterHtmlPath: "private/page.html",
		allowedRoot: "public/",
	}), {
		ok: false,
		notice: "Paired HTML file must be inside public/.",
	});
});

test("resolvePublicHtmlPair rejects non markdown and non html paths", () => {
	assert.deepEqual(resolvePublicHtmlPairForHtml({
		htmlPath: "public/page.md",
		allowedRoot: "public/",
	}), {
		ok: false,
		notice: "Publish artifact must be an HTML file.",
	});

	assert.deepEqual(resolvePublicHtmlPairForSource({
		sourcePath: "public/page.txt",
		frontmatterHtmlPath: null,
		allowedRoot: "public/",
	}), {
		ok: false,
		notice: "Publish control file must be a Markdown file.",
	});
});

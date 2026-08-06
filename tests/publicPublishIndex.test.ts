import * as assert from "node:assert/strict";
import test from "node:test";
import {
	ALL_COMMENTS_NOTE_IMAGE_ALT,
	ALL_COMMENTS_NOTE_IMAGE_CAPTION,
	ALL_COMMENTS_NOTE_IMAGE_CAPTION_STYLE,
	ALL_COMMENTS_NOTE_IMAGE_URL,
} from "../src/core/derived/allCommentsNote";
import {
	mergePublicPublishIndexEntries,
	readPublicPublishIndexEntries,
	renderPublicPublishIndex,
	type PublicPublishIndexEntry,
} from "../src/core/publish/publicPublishIndex";

const entries: PublicPublishIndexEntry[] = [
	{
		path: "startup/tech stack.md",
		publishedUrl: "https://publish.example.com/public/startup/tech%20stack",
		type: "file",
		status: "published",
		lastPublishedAt: "2026-08-06T08:00:00.000Z",
	},
	{
		path: "archive/report.pdf",
		publishedUrl: null,
		type: "file",
		status: "unpublished",
		lastPublishedAt: null,
	},
];

test("renderPublicPublishIndex writes the complete Aside-owned inventory", () => {
	assert.equal(renderPublicPublishIndex(entries), [
		`![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${ALL_COMMENTS_NOTE_IMAGE_URL})`,
		`<div class="aside-index-header-caption" style="${ALL_COMMENTS_NOTE_IMAGE_CAPTION_STYLE}">${ALL_COMMENTS_NOTE_IMAGE_CAPTION}</div>`,
		"",
		"| path | published_url | type | status | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| archive/report.pdf |  | file | unpublished |  |",
		"| startup/tech stack.md | https://publish.example.com/public/startup/tech%20stack | file | published | 2026-08-06T08:00:00.000Z |",
		"",
	].join("\n"));
});

test("readPublicPublishIndexEntries reads current and marked legacy tables", () => {
	assert.deepEqual(readPublicPublishIndexEntries(renderPublicPublishIndex(entries)), [entries[1], entries[0]]);
	assert.deepEqual(readPublicPublishIndexEntries([
		"Owner notes.",
		"<!-- Aside publish index -->",
		"| path | published_url | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- | --- |",
		"| old.md | https://publish.example.com/public/old | file | published | auth.md | 2026-01-01T00:00:00.000Z |",
		"| old-folder/ |  | folder | unpublished | auth.md |  |",
		"<!-- /Aside publish index -->",
	].join("\n")), [{
		path: "old.md",
		publishedUrl: "https://publish.example.com/public/old",
		type: "file",
		status: "published",
		lastPublishedAt: "2026-01-01T00:00:00.000Z",
	}]);
});

test("readPublicPublishIndexEntries ignores a malformed legacy row without losing later files", () => {
	assert.deepEqual(readPublicPublishIndexEntries([
		"<!-- Aside publish index -->",
		"| path | published_url | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- | --- |",
		"| first.md | https://publish.example.com/public/first | file | published | auth.md | 2026-01-01T00:00:00.000Z |",
		"| malformed row",
		"| second.md | https://publish.example.com/public/second | file | published | auth.md | 2026-01-02T00:00:00.000Z |",
		"<!-- /Aside publish index -->",
	].join("\n")), [{
		path: "first.md",
		publishedUrl: "https://publish.example.com/public/first",
		type: "file",
		status: "published",
		lastPublishedAt: "2026-01-01T00:00:00.000Z",
	}, {
		path: "second.md",
		publishedUrl: "https://publish.example.com/public/second",
		type: "file",
		status: "published",
		lastPublishedAt: "2026-01-02T00:00:00.000Z",
	}]);
});

test("mergePublicPublishIndexEntries replaces matching file rows and preserves other files", () => {
	const existing = renderPublicPublishIndex([entries[0]]);
	assert.deepEqual(mergePublicPublishIndexEntries(existing, [{
		path: "startup/tech stack.md",
		publishedUrl: null,
		type: "file",
		status: "unpublished",
		lastPublishedAt: null,
	}, entries[1]]), [entries[1], {
		path: "startup/tech stack.md",
		publishedUrl: null,
		type: "file",
		status: "unpublished",
		lastPublishedAt: null,
	}]);
});

test("renderPublicPublishIndex escapes table cells and emits no auth metadata", () => {
	const markdown = renderPublicPublishIndex([{
		path: "docs/a|b<!-- marker -->.md",
		publishedUrl: null,
		type: "file",
		status: "published",
		lastPublishedAt: null,
	}]);
	assert.match(markdown, /docs\/a\\\|b<\\!-- marker --\\>\.md/u);
	assert.doesNotMatch(markdown, /Aside publish index|permission_source|auth\.md/u);
});

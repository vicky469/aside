import * as assert from "node:assert/strict";
import test from "node:test";
import {
	ensurePrivatePublishIndexMarkdown,
	mergePrivatePublishIndexEntries,
	readPrivatePublishIndexEntries,
	type PrivatePublishIndexEntry,
} from "../src/core/publish/privatePublishIndex";

test("ensurePrivatePublishIndexMarkdown creates a missing index file", () => {
	const entries: PrivatePublishIndexEntry[] = [
		{
			path: "roadmap.md",
			type: "file",
			status: "published",
			permissionSource: "auth.md",
			lastPublishedAt: "2026-07-26T08:00:00.000Z",
		},
		{
			path: "investors/",
			type: "folder",
			status: "unpublished",
			permissionSource: "auth.md",
			lastPublishedAt: null,
		},
	];

	assert.equal(
		ensurePrivatePublishIndexMarkdown(null, entries),
		[
			"# Published Index",
			"",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| investors/ | folder | unpublished | auth.md |  |",
			"| roadmap.md | file | published | auth.md | 2026-07-26T08:00:00.000Z |",
			"<!-- /Aside publish index -->",
			"",
		].join("\n"),
	);
});

test("ensurePrivatePublishIndexMarkdown replaces only an existing managed section", () => {
	const existingMarkdown = [
		"# Published Index",
		"",
		"Owner introduction.",
		"",
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| old.md | file | published | old | 2026-01-01T00:00:00.000Z |",
		"<!-- /Aside publish index -->",
		"",
		"Owner footer.",
		"",
	].join("\n");

	assert.equal(
		ensurePrivatePublishIndexMarkdown(existingMarkdown, [
			{
				path: "roadmap.md",
				type: "file",
				status: "published",
				permissionSource: "auth.md",
				lastPublishedAt: "2026-07-26T08:00:00.000Z",
			},
		]),
		[
			"# Published Index",
			"",
			"Owner introduction.",
			"",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| roadmap.md | file | published | auth.md | 2026-07-26T08:00:00.000Z |",
			"<!-- /Aside publish index -->",
			"",
			"Owner footer.",
			"",
		].join("\n"),
	);
});

test("ensurePrivatePublishIndexMarkdown appends a managed section to unmanaged content", () => {
	const existingMarkdown = [
		"# Team Publishing Notes",
		"",
		"Owners can keep instructions here.",
	].join("\n");

	assert.equal(
		ensurePrivatePublishIndexMarkdown(existingMarkdown, [
			{
				path: "roadmap.md",
				type: "file",
				status: "published",
				permissionSource: "auth.md",
				lastPublishedAt: "2026-07-26T08:00:00.000Z",
			},
		]),
		[
			"# Team Publishing Notes",
			"",
			"Owners can keep instructions here.",
			"",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| roadmap.md | file | published | auth.md | 2026-07-26T08:00:00.000Z |",
			"<!-- /Aside publish index -->",
			"",
		].join("\n"),
	);
});

test("ensurePrivatePublishIndexMarkdown escapes table cells and formats null timestamps", () => {
	assert.equal(
		ensurePrivatePublishIndexMarkdown(undefined, [
			{
				path: "docs/a|b<!-- /Aside publish index -->.md",
				type: "file",
				status: "published",
				permissionSource: "manual\nrule|fallback<!-- Aside publish index -->",
				lastPublishedAt: null,
			},
		]),
		[
			"# Published Index",
			"",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| docs/a\\|b<\\!-- /Aside publish index --\\>.md | file | published | manual rule\\|fallback<\\!-- Aside publish index --\\> |  |",
			"<!-- /Aside publish index -->",
			"",
		].join("\n"),
	);
});

test("ensurePrivatePublishIndexMarkdown appends when markers are incomplete or in wrong order", () => {
	const entries: PrivatePublishIndexEntry[] = [
		{
			path: "roadmap.md",
			type: "file",
			status: "published",
			permissionSource: "auth.md",
			lastPublishedAt: null,
		},
	];
	const expectedSection = [
		"<!-- Aside publish index -->",
		"| path | type | status | permission_source | last_published_at |",
		"| --- | --- | --- | --- | --- |",
		"| roadmap.md | file | published | auth.md |  |",
		"<!-- /Aside publish index -->",
		"",
	].join("\n");

	assert.equal(
		ensurePrivatePublishIndexMarkdown("Before\n<!-- Aside publish index -->\nOld table", entries),
		[
			"Before",
			"<!-- Aside publish index -->",
			"Old table",
			"",
			expectedSection,
		].join("\n"),
	);
	assert.equal(
		ensurePrivatePublishIndexMarkdown(
			ensurePrivatePublishIndexMarkdown("Before\n<!-- Aside publish index -->\nOld table", entries),
			entries,
		),
		[
			"Before",
			"<!-- Aside publish index -->",
			"Old table",
			"",
			expectedSection,
		].join("\n"),
	);
	assert.equal(
		ensurePrivatePublishIndexMarkdown("Before\n<!-- /Aside publish index -->\nAfter\n<!-- Aside publish index -->", entries),
		[
			"Before",
			"<!-- /Aside publish index -->",
			"After",
			"<!-- Aside publish index -->",
			"",
			expectedSection,
		].join("\n"),
	);
	assert.equal(
		ensurePrivatePublishIndexMarkdown(
			ensurePrivatePublishIndexMarkdown("Before\n<!-- /Aside publish index -->\nAfter\n<!-- Aside publish index -->", entries),
			entries,
		),
		[
			"Before",
			"<!-- /Aside publish index -->",
			"After",
			"<!-- Aside publish index -->",
			"",
			expectedSection,
		].join("\n"),
	);
	assert.equal(
		ensurePrivatePublishIndexMarkdown([
			"Before",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"Owner text with no table row shape.",
			"",
			expectedSection,
		].join("\n"), entries),
		[
			"Before",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"Owner text with no table row shape.",
			"",
			expectedSection,
		].join("\n"),
	);
	assert.equal(
		ensurePrivatePublishIndexMarkdown([
			"Owner prefix <!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| roadmap.md | file | published | auth.md |  |",
			"<!-- /Aside publish index --> suffix",
		].join("\n"), entries),
		[
			"Owner prefix <!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| roadmap.md | file | published | auth.md |  |",
			"<!-- /Aside publish index --> suffix",
			"",
			expectedSection,
		].join("\n"),
	);
	assert.equal(
		ensurePrivatePublishIndexMarkdown([
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| owner | notes.md | file | published | auth.md | never |",
			"<!-- /Aside publish index -->",
		].join("\n"), entries),
		[
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| owner | notes.md | file | published | auth.md | never |",
			"<!-- /Aside publish index -->",
			"",
			expectedSection,
		].join("\n"),
	);
});

test("ensurePrivatePublishIndexMarkdown uses deterministic tie breakers for duplicate paths", () => {
	assert.equal(
		ensurePrivatePublishIndexMarkdown(undefined, [
			{
				path: "roadmap.md",
				type: "file",
				status: "published",
				permissionSource: "z.md",
				lastPublishedAt: "2026-07-26T08:02:00.000Z",
			},
			{
				path: "roadmap.md",
				type: "file",
				status: "published",
				permissionSource: "a.md",
				lastPublishedAt: "2026-07-26T08:02:00.000Z",
			},
			{
				path: "roadmap.md",
				type: "file",
				status: "published",
				permissionSource: "a.md",
				lastPublishedAt: "2026-07-26T08:01:00.000Z",
			},
		]),
		[
			"# Published Index",
			"",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| roadmap.md | file | published | a.md | 2026-07-26T08:01:00.000Z |",
			"| roadmap.md | file | published | a.md | 2026-07-26T08:02:00.000Z |",
			"| roadmap.md | file | published | z.md | 2026-07-26T08:02:00.000Z |",
			"<!-- /Aside publish index -->",
			"",
		].join("\n"),
	);
});

test("ensurePrivatePublishIndexMarkdown normalizes CRLF input and uses one trailing newline", () => {
	assert.equal(
		ensurePrivatePublishIndexMarkdown("# Notes\r\n\r\nKeep this.\r\n\r\n", [
			{
				path: "roadmap.md",
				type: "file",
				status: "published",
				permissionSource: "auth.md",
				lastPublishedAt: null,
			},
		]),
		[
			"# Notes",
			"",
			"Keep this.",
			"",
			"<!-- Aside publish index -->",
			"| path | type | status | permission_source | last_published_at |",
			"| --- | --- | --- | --- | --- |",
			"| roadmap.md | file | published | auth.md |  |",
			"<!-- /Aside publish index -->",
			"",
		].join("\n"),
	);
});

test("readPrivatePublishIndexEntries reads escaped managed rows", () => {
	const markdown = ensurePrivatePublishIndexMarkdown(undefined, [{
		path: "docs/a|b<!-- /Aside publish index -->.md",
		type: "file",
		status: "published",
		permissionSource: "manual|fallback<!-- Aside publish index -->",
		lastPublishedAt: null,
	}]);

	assert.deepEqual(readPrivatePublishIndexEntries(markdown), [{
		path: "docs/a|b<!-- /Aside publish index -->.md",
		type: "file",
		status: "published",
		permissionSource: "manual|fallback<!-- Aside publish index -->",
		lastPublishedAt: null,
	}]);
});

test("readPrivatePublishIndexEntries ignores unmanaged marker-like content", () => {
	assert.deepEqual(readPrivatePublishIndexEntries([
		"# Owner Notes",
		"",
		"<!-- Aside publish index -->",
		"owner text",
		"<!-- /Aside publish index -->",
	].join("\n")), []);
});

test("mergePrivatePublishIndexEntries preserves old rows and upserts by path and type", () => {
	const existingMarkdown = ensurePrivatePublishIndexMarkdown(undefined, [{
		path: "old.md",
		type: "file",
		status: "published",
		permissionSource: "auth.md",
		lastPublishedAt: "2026-07-26T07:00:00.000Z",
	}, {
		path: "docs/",
		type: "folder",
		status: "published",
		permissionSource: "auth.md",
		lastPublishedAt: "2026-07-26T07:00:00.000Z",
	}]);

	assert.deepEqual(mergePrivatePublishIndexEntries(existingMarkdown, [{
		path: "docs/",
		type: "folder",
		status: "published",
		permissionSource: "auth.md",
		lastPublishedAt: "2026-07-26T08:00:00.000Z",
	}, {
		path: "docs/page.md",
		type: "file",
		status: "published",
		permissionSource: "auth.md",
		lastPublishedAt: "2026-07-26T08:00:00.000Z",
	}]), [{
		path: "docs/",
		type: "folder",
		status: "published",
		permissionSource: "auth.md",
		lastPublishedAt: "2026-07-26T08:00:00.000Z",
	}, {
		path: "docs/page.md",
		type: "file",
		status: "published",
		permissionSource: "auth.md",
		lastPublishedAt: "2026-07-26T08:00:00.000Z",
	}, {
		path: "old.md",
		type: "file",
		status: "published",
		permissionSource: "auth.md",
		lastPublishedAt: "2026-07-26T07:00:00.000Z",
	}]);
});

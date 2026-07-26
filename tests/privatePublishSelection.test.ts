import * as assert from "node:assert/strict";
import test from "node:test";
import {
	selectPrivatePublishPaths,
} from "../src/core/publish/privatePublishSelection";

function select(targetPath: string, allFilePaths: readonly string[], allowedRoot = "public/") {
	return selectPrivatePublishPaths({
		targetPath,
		allFilePaths,
		allowedRoot,
	});
}

test("selectPrivatePublishPaths selects a single publishable file under public", () => {
	assert.deepEqual(select("public/roadmap.md", [
		"public/roadmap.md",
		"public/other.md",
	]), {
		ok: true,
		rootPath: "public/roadmap.md",
		rootKind: "file",
		paths: ["public/roadmap.md"],
	});
});

test("selectPrivatePublishPaths selects supported files under a folder and excludes unsupported files", () => {
	assert.deepEqual(select("public/reports", [
		"public/reports/q1.md",
		"public/reports/q2.HTML",
		"public/reports/raw.txt",
		"public/reports/archive.PDF",
		"public/reports/deep/summary.htm",
		"public/other.md",
	]), {
		ok: true,
		rootPath: "public/reports/",
		rootKind: "folder",
		paths: [
			"public/reports/archive.PDF",
			"public/reports/deep/summary.htm",
			"public/reports/q1.md",
			"public/reports/q2.HTML",
		],
	});
});

test("selectPrivatePublishPaths selects the whole public root and excludes root control files", () => {
	assert.deepEqual(select("public/", [
		"public/index.md",
		"public/auth.md",
		"public/guide.md",
		"public/index.html",
		"public/nested/index.md",
		"public/nested/auth.md",
	]), {
		ok: true,
		rootPath: "public/",
		rootKind: "folder",
		paths: [
			"public/guide.md",
			"public/index.html",
			"public/nested/auth.md",
			"public/nested/index.md",
		],
	});
});

test("selectPrivatePublishPaths rejects targets outside the publish root", () => {
	assert.deepEqual(select("private/roadmap.md", [
		"public/roadmap.md",
		"private/roadmap.md",
	]), {
		ok: false,
		notice: "Private publish target must be inside public/.",
	});
});

test("selectPrivatePublishPaths enforces allowed-root and folder boundaries", () => {
	assert.deepEqual(select("publicity/page.md", [
		"publicity/page.md",
		"public/page.md",
	]), {
		ok: false,
		notice: "Private publish target must be inside public/.",
	});

	assert.deepEqual(select("public/investors", [
		"public/investors-q1.md",
		"public/investors/q1.md",
		"public/investors/deck.pdf",
	]), {
		ok: true,
		rootPath: "public/investors/",
		rootKind: "folder",
		paths: [
			"public/investors/deck.pdf",
			"public/investors/q1.md",
		],
	});
});

test("selectPrivatePublishPaths dedupes and normalizes file paths and target dot segments", () => {
	assert.deepEqual(select("public\\investors\\./../investors/./q1.md", [
		"public/investors/q1.md",
		"public\\investors\\q1.md",
		"public/investors/./q1.md",
		"public/investors/../investors/q1.md",
	]), {
		ok: true,
		rootPath: "public/investors/q1.md",
		rootKind: "file",
		paths: ["public/investors/q1.md"],
	});
});

test("selectPrivatePublishPaths returns an empty file selection for root control or unsupported files", () => {
	assert.deepEqual(select("public/index.md", [
		"public/index.md",
	]), {
		ok: true,
		rootPath: "public/index.md",
		rootKind: "file",
		paths: [],
	});

	assert.deepEqual(select("public/raw.txt", [
		"public/raw.txt",
	]), {
		ok: true,
		rootPath: "public/raw.txt",
		rootKind: "file",
		paths: [],
	});
});

test("selectPrivatePublishPaths rejects target traversal that escapes the publish root", () => {
	assert.deepEqual(select("public/../private/roadmap.md", [
		"private/roadmap.md",
	]), {
		ok: false,
		notice: "Private publish target must be inside public/.",
	});
});

test("selectPrivatePublishPaths normalizes non-default allowed roots", () => {
	assert.deepEqual(select("share\\docs", [
		"share/docs/guide.md",
		"share/docs/auth.md",
		"share/docs/index.md",
		"share/docs/nested/index.md",
		"share-other/docs/guide.md",
	], " share\\docs "), {
		ok: true,
		rootPath: "share/docs/",
		rootKind: "folder",
		paths: [
			"share/docs/nested/index.md",
			"share/docs/guide.md",
		].sort(),
	});
});

import * as assert from "node:assert/strict";
import test from "node:test";
import {
	normalizePublishedPublicArtifactPaths,
	removePublishedPublicArtifactPath,
	removePublishedPublicArtifactPathsInFolder,
	renamePublishedPublicArtifactPath,
	renamePublishedPublicArtifactPathsInFolder,
} from "../src/core/publish/publishedPublicArtifacts";

test("renamePublishedPublicArtifactPath follows artifact renames inside the publish root", () => {
	assert.deepEqual(renamePublishedPublicArtifactPath(
		["public/page.html", "public/report.pdf"],
		"public/page.html",
		"public/renamed.html",
		"public/",
	), [
		"public/renamed.html",
		"public/report.pdf",
	]);
});

test("renamePublishedPublicArtifactPath removes artifacts renamed outside the publish root", () => {
	assert.deepEqual(renamePublishedPublicArtifactPath(
		["public/page.html", "public/report.pdf"],
		"public/page.html",
		"archive/page.html",
		"public/",
	), ["public/report.pdf"]);
});

test("removePublishedPublicArtifactPath prunes deleted published artifacts", () => {
	assert.deepEqual(removePublishedPublicArtifactPath(
		normalizePublishedPublicArtifactPaths(["public/page.html", "public/report.pdf"]),
		"public/page.html",
	), ["public/report.pdf"]);
});

test("removePublishedPublicArtifactPathsInFolder prunes deleted published artifact folders", () => {
	assert.deepEqual(removePublishedPublicArtifactPathsInFolder([
		"public/page.html",
		"public/nested/report.pdf",
		"publicness/keep.html",
	], "public"), ["publicness/keep.html"]);
});

test("renamePublishedPublicArtifactPathsInFolder retargets a published prefix in one pass", () => {
	assert.deepEqual(renamePublishedPublicArtifactPathsInFolder([
		"public/drafts/page.html",
		"public/drafts/nested/report.pdf",
		"public/drafts/image.png",
		"public/draftsness/keep.html",
	], "public/drafts", "public/published", "public/"), [
		"public/draftsness/keep.html",
		"public/published/nested/report.pdf",
		"public/published/page.html",
	]);
});

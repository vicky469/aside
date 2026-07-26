import * as assert from "node:assert/strict";
import test from "node:test";
import {
	planWranglerPagesDirectUploadStaging,
} from "../src/publish/wranglerPagesStaging";

test("wrangler pages staging planner separates static assets from project files", () => {
	const result = planWranglerPagesDirectUploadStaging({
		assetDirectoryName: "assets",
		staticAssets: [{
			assetRelativePath: "public/page.html",
			contents: "<!doctype html><html><body>Page</body></html>",
		}, {
			assetRelativePath: "_routes.json",
			contents: "{\"version\":1}",
		}],
		projectFiles: [{
			projectRelativePath: "functions/_middleware.js",
			contents: "export function onRequest(context) { return context.next(); }",
		}, {
			projectRelativePath: "src/_aside/private-publish-data.js",
			contents: "export const privatePublishManifest = {};",
		}],
	});

	assert.deepEqual(result, {
		ok: true,
		assetDirectoryRelativePath: "assets",
		writes: [{
			stagingRoot: "asset",
			relativePath: "public/page.html",
			projectRelativePath: "assets/public/page.html",
			contents: "<!doctype html><html><body>Page</body></html>",
		}, {
			stagingRoot: "asset",
			relativePath: "_routes.json",
			projectRelativePath: "assets/_routes.json",
			contents: "{\"version\":1}",
		}, {
			stagingRoot: "project",
			relativePath: "functions/_middleware.js",
			projectRelativePath: "functions/_middleware.js",
			contents: "export function onRequest(context) { return context.next(); }",
		}, {
			stagingRoot: "project",
			relativePath: "src/_aside/private-publish-data.js",
			projectRelativePath: "src/_aside/private-publish-data.js",
			contents: "export const privatePublishManifest = {};",
		}],
	});
});

test("wrangler pages staging planner rejects paths that escape staging roots", () => {
	assert.deepEqual(planWranglerPagesDirectUploadStaging({
		assetDirectoryName: "assets",
		staticAssets: [{
			assetRelativePath: "../auth.md",
			contents: "secret",
		}],
		projectFiles: [],
	}), {
		ok: false,
		notice: "Static asset path must stay inside the Pages asset directory.",
	});

	assert.deepEqual(planWranglerPagesDirectUploadStaging({
		assetDirectoryName: "assets",
		staticAssets: [],
		projectFiles: [{
			projectRelativePath: "assets/private-publish-data.js",
			contents: "secret",
		}],
	}), {
		ok: false,
		notice: "Project file path must not write inside the Pages asset directory.",
	});

	assert.deepEqual(planWranglerPagesDirectUploadStaging({
		assetDirectoryName: "assets",
		staticAssets: [],
		projectFiles: [{
			projectRelativePath: "../functions/_middleware.js",
			contents: "escape",
		}],
	}), {
		ok: false,
		notice: "Project file path must stay inside the temporary Pages project.",
	});
});

import * as assert from "node:assert/strict";
import test from "node:test";
import {
	buildPrivatePublishSnapshotSupportFiles,
} from "../src/core/publish/privatePublishSnapshot";

test("private publish snapshot support files keep permission data server-side", () => {
	const supportFiles = buildPrivatePublishSnapshotSupportFiles({
		allowedRoot: "public/",
		publishBaseUrl: "https://publish.example.com",
		publishedAt: "2026-07-26T08:00:00.000Z",
		files: [{
			vaultRelativePath: "public/docs/page.html",
			sourcePath: "public/docs/page.md",
			kind: "markdown",
			contentHash: "sha256-page",
		}, {
			vaultRelativePath: "public/report.pdf",
			sourcePath: "public/report.pdf",
			kind: "pdf",
			contentHash: "sha256-report",
		}],
		authRules: [{
			provider: "google",
			identifier: "alice@example.com",
			path: "docs/",
			access: "comment",
			line: 3,
		}, {
			provider: "wechat",
			identifier: "wx_openid_123",
			path: "/",
			access: "view",
			line: 4,
		}],
	});

	assert.deepEqual(supportFiles.staticAssets.map((file) => file.assetRelativePath), [
		"_routes.json",
	]);
	assert.deepEqual(supportFiles.functions.map((file) => file.projectRelativePath), [
		"functions/_middleware.js",
		"functions/_aside/api/auth/session.js",
		"functions/_aside/api/comments/index.js",
	]);
	assert.deepEqual(supportFiles.privateModules.map((file) => file.projectRelativePath), [
		"src/_aside/private-publish-data.js",
	]);
	assert.deepEqual(JSON.parse(supportFiles.staticAssets[0].contents), {
		version: 1,
		include: ["/*"],
		exclude: [],
	});
	assert.doesNotMatch(
		supportFiles.staticAssets.map((file) => file.assetRelativePath).join("\n"),
		/auth\.md|site-manifest\.json|private-publish-data/u,
	);
	assert.doesNotMatch(
		supportFiles.functions.map((file) => file.projectRelativePath).join("\n"),
		/internal\/private-publish-data/u,
	);

	const middleware = supportFiles.functions.find((file) => file.projectRelativePath === "functions/_middleware.js")?.contents ?? "";
	assert.match(middleware, /import \{ privatePublishManifest \} from "\.\.\/src\/_aside\/private-publish-data\.js"/u);
	assert.match(middleware, /export async function onRequest\(context\)/u);
	assert.match(middleware, /privatePublishManifest\.controlPaths\.auth/u);
	assert.doesNotMatch(middleware, /endsWith\("\/auth\.md"\)/u);
	assert.match(middleware, /return context\.next\(\)/u);

	const sessionRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/auth/session.js")?.contents ?? "";
	assert.match(
		sessionRoute,
		/import \{ privatePublishManifest \} from "\.\.\/\.\.\/\.\.\/\.\.\/src\/_aside\/private-publish-data\.js"/u,
	);

	const serverData = supportFiles.privateModules[0].contents;
	assert.match(serverData, /export const privatePublishManifest =/u);
	assert.match(serverData, /"allowedRoot": "public\/"/u);
	assert.match(serverData, /"controlPaths": \{\n\t\t"auth": "\/public\/auth\.md"\n\t\}/u);
	assert.match(serverData, /"baseUrl": "https:\/\/publish\.example\.com"/u);
	assert.match(serverData, /"publicPath": "docs\/page\.html"/u);
	assert.match(serverData, /"sourcePath": "docs\/page\.md"/u);
	assert.match(serverData, /"contentHash": "sha256-page"/u);
	assert.match(serverData, /"provider": "google"/u);
	assert.match(serverData, /"unsupportedProviders": \[\n\t\t"wechat"\n\t\]/u);
});

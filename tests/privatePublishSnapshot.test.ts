import * as assert from "node:assert/strict";
import test from "node:test";
import {
	buildPrivatePublishManifest,
	buildPrivatePublishSnapshotSupportFiles,
} from "../src/core/publish/privatePublishSnapshot";

test("private publish manifest includes tree, permission, route, and version metadata", () => {
	const manifest = buildPrivatePublishManifest({
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
		}],
	});

	assert.deepEqual(manifest.files, [{
		publicPath: "docs/page.html",
		routePath: "/public/docs/page",
		sourcePath: "docs/page.md",
		kind: "markdown",
		contentHash: "sha256-page",
		publishedAt: "2026-07-26T08:00:00.000Z",
		currentVersion: {
			id: "sha256-page",
			contentHash: "sha256-page",
			publishedAt: "2026-07-26T08:00:00.000Z",
		},
		versions: [{
			id: "sha256-page",
			contentHash: "sha256-page",
			publishedAt: "2026-07-26T08:00:00.000Z",
		}],
	}, {
		publicPath: "report.pdf",
		routePath: "/public/report.pdf",
		sourcePath: "report.pdf",
		kind: "pdf",
		contentHash: "sha256-report",
		publishedAt: "2026-07-26T08:00:00.000Z",
		currentVersion: {
			id: "sha256-report",
			contentHash: "sha256-report",
			publishedAt: "2026-07-26T08:00:00.000Z",
		},
		versions: [{
			id: "sha256-report",
			contentHash: "sha256-report",
			publishedAt: "2026-07-26T08:00:00.000Z",
		}],
	}]);
	assert.deepEqual(manifest.tree.children, [{
		name: "docs",
		path: "docs/",
		type: "folder",
		children: [{
			name: "page.html",
			path: "docs/page.html",
			type: "file",
			kind: "markdown",
		}],
	}, {
		name: "report.pdf",
		path: "report.pdf",
		type: "file",
		kind: "pdf",
	}]);
	assert.deepEqual(manifest.permissionRules, [{
		provider: "google",
		identifier: "alice@example.com",
		path: "docs/",
		access: "comment",
		line: 3,
	}]);
});

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
		"functions/_aside/api/auth/google/start.js",
		"functions/_aside/api/auth/google/callback.js",
		"functions/_aside/api/auth/logout.js",
		"functions/_aside/api/site-manifest.js",
		"functions/_aside/api/comments/index.js",
	]);
	assert.deepEqual(supportFiles.privateModules.map((file) => file.projectRelativePath), [
		"src/_aside/private-publish-data.js",
		"src/_aside/private-publish-runtime.js",
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

test("generated private publish runtime filters manifests by identity without exposing permission rules", () => {
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
			vaultRelativePath: "public/secret.html",
			sourcePath: "public/secret.md",
			kind: "markdown",
			contentHash: "sha256-secret",
		}],
		authRules: [{
			provider: "google",
			identifier: "alice@example.com",
			path: "docs/",
			access: "comment",
			line: 3,
		}, {
			provider: "google",
			identifier: "bob@example.com",
			path: "secret.html",
			access: "view",
			line: 4,
		}],
	});
	const runtime = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-runtime.js");
	assert.ok(runtime);
	const runtimeModule = new Function(`
${runtime.contents.replace(/\bexport\s+/gu, "")}
return { filterPrivatePublishManifestForIdentity, getAsideSessionIdentity, resolvePrivatePublishPermission };
`)() as {
		filterPrivatePublishManifestForIdentity: (manifest: unknown, identity: unknown) => {
			files: Array<{ publicPath: string; permission: { canView: boolean; canComment: boolean; canManage: boolean } }>;
			tree: { children: unknown[] };
			permissionRules?: unknown;
		};
	};
	const privateData = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-data.js");
	assert.ok(privateData);
	const privateDataMatch = /^export const privatePublishManifest = ([\s\S]*);$/u.exec(privateData.contents);
	assert.ok(privateDataMatch);
	const manifest = JSON.parse(privateDataMatch[1]) as unknown;

	const anonymousManifest = runtimeModule.filterPrivatePublishManifestForIdentity(manifest, null);
	assert.deepEqual(anonymousManifest.files, []);
	assert.equal(anonymousManifest.permissionRules, undefined);

	const aliceManifest = runtimeModule.filterPrivatePublishManifestForIdentity(manifest, {
		provider: "google",
		identifier: "Alice@Example.com",
	});
	assert.deepEqual(aliceManifest.files.map((file: { publicPath: string }) => file.publicPath), [
		"docs/page.html",
	]);
	assert.deepEqual(aliceManifest.files[0].permission, {
		canView: true,
		canComment: true,
		canManage: false,
	});
	assert.deepEqual(aliceManifest.tree.children, [{
		name: "docs",
		path: "docs/",
		type: "folder",
		children: [{
			name: "page.html",
			path: "docs/page.html",
			type: "file",
			kind: "markdown",
		}],
	}]);
	assert.equal(aliceManifest.permissionRules, undefined);

	const siteManifestRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/site-manifest.js")?.contents ?? "";
	assert.match(siteManifestRoute, /filterPrivatePublishManifestForIdentity/u);
	assert.match(siteManifestRoute, /from "\.\.\/\.\.\/\.\.\/src\/_aside\/private-publish-runtime\.js"/u);
	assert.doesNotMatch(siteManifestRoute, /permissionRules/u);
});

test("generated private publish runtime signs and verifies Google session cookies", async () => {
	const supportFiles = buildPrivatePublishSnapshotSupportFiles({
		allowedRoot: "public/",
		publishBaseUrl: "https://publish.example.com",
		publishedAt: "2026-07-26T08:00:00.000Z",
		files: [],
		authRules: [],
	});
	const runtime = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-runtime.js");
	assert.ok(runtime);
	const runtimeModule = new Function(`
${runtime.contents.replace(/\bexport\s+/gu, "")}
return { createAsideSessionCookie, getAsideSessionIdentity, clearAsideSessionCookie, createGoogleAuthorizationUrl };
`)() as {
		createAsideSessionCookie: (env: Record<string, string>, identity: unknown, nowSeconds: number) => Promise<string>;
		getAsideSessionIdentity: (request: Request, env: Record<string, string>, nowSeconds: number) => Promise<unknown>;
		clearAsideSessionCookie: () => string;
		createGoogleAuthorizationUrl: (input: { clientId: string; redirectUri: string; state: string }) => string;
	};

	const cookie = await runtimeModule.createAsideSessionCookie({
		ASIDE_SESSION_SECRET: "test-secret",
	}, {
		provider: "google",
		identifier: "Alice@Example.com",
		name: "Alice",
		picture: "https://example.com/alice.png",
	}, 100);
	assert.match(cookie, /^aside_session=/u);
	assert.match(cookie, /HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=604800/u);
	const cookieHeader = cookie.split(";")[0];
	assert.deepEqual(await runtimeModule.getAsideSessionIdentity(new Request("https://publish.example.com", {
		headers: {
			Cookie: cookieHeader,
		},
	}), {
		ASIDE_SESSION_SECRET: "test-secret",
	}, 200), {
		provider: "google",
		identifier: "alice@example.com",
		name: "Alice",
		picture: "https://example.com/alice.png",
	});
	assert.equal(await runtimeModule.getAsideSessionIdentity(new Request("https://publish.example.com", {
		headers: {
			Cookie: cookieHeader.replace(/.$/u, "x"),
		},
	}), {
		ASIDE_SESSION_SECRET: "test-secret",
	}, 200), null);
	assert.equal(await runtimeModule.getAsideSessionIdentity(new Request("https://publish.example.com", {
		headers: {
			Cookie: "aside_session=%",
		},
	}), {
		ASIDE_SESSION_SECRET: "test-secret",
	}, 200), null);
	assert.equal(await runtimeModule.getAsideSessionIdentity(new Request("https://publish.example.com", {
		headers: {
			Cookie: cookieHeader,
		},
	}), {
		ASIDE_SESSION_SECRET: "test-secret",
	}, 604901), null);
	assert.match(runtimeModule.clearAsideSessionCookie(), /^aside_session=; HttpOnly; Secure; SameSite=Lax; Path=\/; Max-Age=0/u);

	const authUrl = new URL(runtimeModule.createGoogleAuthorizationUrl({
		clientId: "client-id",
		redirectUri: "https://publish.example.com/_aside/api/auth/google/callback",
		state: "state-token",
	}));
	assert.equal(authUrl.origin + authUrl.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
	assert.equal(authUrl.searchParams.get("response_type"), "code");
	assert.equal(authUrl.searchParams.get("client_id"), "client-id");
	assert.equal(authUrl.searchParams.get("redirect_uri"), "https://publish.example.com/_aside/api/auth/google/callback");
	assert.equal(authUrl.searchParams.get("scope"), "openid email profile");
	assert.equal(authUrl.searchParams.get("state"), "state-token");

	const startRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/auth/google/start.js")?.contents ?? "";
	assert.match(runtime.contents, /ASIDE_GOOGLE_CLIENT_ID/u);
	assert.match(startRoute, /createGoogleAuthorizationUrl/u);
	const callbackRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/auth/google/callback.js")?.contents ?? "";
	assert.match(callbackRoute, /exchangeGoogleAuthorizationCode/u);
	assert.match(runtime.contents, /https:\/\/oauth2\.googleapis\.com\/token/u);
	assert.match(runtime.contents, /https:\/\/openidconnect\.googleapis\.com\/v1\/userinfo/u);
});

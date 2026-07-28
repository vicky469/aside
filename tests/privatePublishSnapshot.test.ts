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
		assetPath: "_aside/private-assets/sha256-page/docs/page.html",
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
		assetPath: "_aside/private-assets/sha256-report/report.pdf",
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
		"index.html",
		"_aside/app.js",
		"_aside/styles.css",
	]);
	assert.deepEqual(supportFiles.functions.map((file) => file.projectRelativePath), [
		"functions/_middleware.js",
		"functions/_aside/private-assets/[[path]].js",
		"functions/public/[[path]].js",
		"functions/_aside/api/auth/session.js",
		"functions/_aside/api/auth/google/start.js",
		"functions/_aside/api/auth/google/callback.js",
		"functions/_aside/api/auth/logout.js",
		"functions/_aside/api/site-manifest.js",
		"functions/_aside/api/comments/index.js",
		"functions/_aside/api/comment-events/index.js",
	]);
	assert.deepEqual(supportFiles.privateModules.map((file) => file.projectRelativePath), [
		"src/_aside/private-publish-data.js",
		"src/_aside/private-publish-runtime.js",
	]);
	assert.deepEqual(supportFiles.privateAssetPathByVaultRelativePath, {
		"public/docs/page.html": "_aside/private-assets/sha256-page/docs/page.html",
		"public/report.pdf": "_aside/private-assets/sha256-report/report.pdf",
	});
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

	const privateAssetRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/private-assets/[[path]].js")?.contents ?? "";
	assert.match(privateAssetRoute, /export function onRequest\(\)/u);
	assert.match(privateAssetRoute, /return new Response\("Not Found", \{ status: 404 \}\)/u);

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
	assert.match(serverData, /"assetPath": "_aside\/private-assets\/sha256-page\/docs\/page\.html"/u);
	assert.match(serverData, /"publicPath": "docs\/page\.html"/u);
	assert.match(serverData, /"sourcePath": "docs\/page\.md"/u);
	assert.match(serverData, /"contentHash": "sha256-page"/u);
	assert.match(serverData, /"provider": "google"/u);
	assert.match(serverData, /"unsupportedProviders": \[\n\t\t"wechat"\n\t\]/u);
});

test("private publish snapshot support files include a three-pane shell without permission data", () => {
	const supportFiles = buildPrivatePublishSnapshotSupportFiles({
		allowedRoot: "public/",
		publishBaseUrl: "https://publish.example.com",
		publishedAt: "2026-07-26T08:00:00.000Z",
		files: [{
			vaultRelativePath: "public/docs/page.html",
			sourcePath: "public/docs/page.md",
			kind: "markdown",
			contentHash: "sha256-page",
		}],
		authRules: [{
			provider: "google",
			identifier: "alice@example.com",
			path: "docs/",
			access: "comment",
			line: 3,
		}],
	});

	const shellHtml = supportFiles.staticAssets.find((file) => file.assetRelativePath === "index.html")?.contents ?? "";
	const shellApp = supportFiles.staticAssets.find((file) => file.assetRelativePath === "_aside/app.js")?.contents ?? "";
	const shellStyles = supportFiles.staticAssets.find((file) => file.assetRelativePath === "_aside/styles.css")?.contents ?? "";

	assert.match(shellHtml, /<div id="aside-private-publish-app">/u);
	assert.match(shellHtml, /<script type="module" src="\/_aside\/app\.js"><\/script>/u);
	assert.match(shellHtml, /<link rel="stylesheet" href="\/_aside\/styles\.css">/u);
	assert.match(shellApp, /\/_aside\/api\/site-manifest/u);
	assert.match(shellApp, /aside-publish-tree/u);
	assert.match(shellApp, /aside-publish-viewer/u);
	assert.match(shellApp, /aside-publish-sidebar/u);
	assert.match(shellApp, /currentVersion/u);
	assert.match(shellApp, /\/_aside\/api\/comments/u);
	assert.match(shellApp, /appendReply/u);
	assert.match(shellApp, /aside-publish-comment-replies/u);
	assert.match(shellApp, /Reply/u);
	assert.match(shellApp, /!comment\.readOnly/u);
	assert.match(shellStyles, /\.aside-publish-shell/u);
	assert.match(shellStyles, /\.aside-publish-comment-replies/u);
	assert.match(shellStyles, /grid-template-columns/u);
	assert.match(shellStyles, /@media \(max-width: 860px\)/u);
	assert.doesNotMatch(`${shellHtml}\n${shellApp}\n${shellStyles}`, /permissionRules|alice@example\.com/u);
});

test("private publish snapshot stores comment seeds server-side only", () => {
	const supportFiles = buildPrivatePublishSnapshotSupportFiles({
		allowedRoot: "public/",
		publishBaseUrl: "https://publish.example.com",
		publishedAt: "2026-07-26T08:00:00.000Z",
		files: [{
			vaultRelativePath: "public/docs/page.html",
			sourcePath: "public/docs/page.md",
			kind: "markdown",
			contentHash: "sha256-page",
		}],
		authRules: [],
		commentSeeds: [{
			publicPath: "docs/page.html",
			id: "local-page-note",
			body: "Existing local note",
			createdAt: "2026-07-26T07:30:00.000Z",
			author: {
				provider: "google",
				identity: "owner@example.com",
				displayName: "Owner",
			},
		}],
	});
	const privateData = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-data.js")?.contents ?? "";
	const privateDataMatch = /^export const privatePublishManifest = ([\s\S]*);$/u.exec(privateData);
	assert.ok(privateDataMatch);
	const manifest = JSON.parse(privateDataMatch[1]) as {
		commentSeeds?: unknown[];
	};

	assert.deepEqual(manifest.commentSeeds, [{
		id: "local-page-note",
		path: "docs/page.html",
		body: "Existing local note",
		createdAt: "2026-07-26T07:30:00.000Z",
		author: {
			provider: "google",
			identity: "owner@example.com",
			displayName: "Owner",
		},
		readOnly: true,
		replies: [],
	}]);
	assert.doesNotMatch(
		supportFiles.staticAssets.map((file) => file.contents).join("\n"),
		/Existing local note|owner@example/u,
	);
});

test("generated private publish route gates public assets before serving static files", async () => {
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
			path: "/",
			access: "view",
			line: 3,
		}],
	});
	const route = supportFiles.functions.find((file) => file.projectRelativePath === "functions/public/[[path]].js");
	assert.ok(route);
	const runtime = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-runtime.js");
	assert.ok(runtime);
	const runtimeModule = new Function(`
${runtime.contents.replace(/\bexport\s+/gu, "")}
return { resolvePrivatePublishPermission };
`)() as {
		resolvePrivatePublishPermission: (rules: unknown[], identity: unknown, requestedPath: string) => { canView: boolean };
	};
	const privateData = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-data.js");
	assert.ok(privateData);
	const privateDataMatch = /^export const privatePublishManifest = ([\s\S]*);$/u.exec(privateData.contents);
	assert.ok(privateDataMatch);
	const privatePublishManifest = JSON.parse(privateDataMatch[1]) as unknown;
	const loadRoute = (identity: unknown) => new Function(
		"privatePublishManifest",
		"getAsideSessionIdentity",
		"resolvePrivatePublishPermission",
		`
${route.contents
	.replace(/^import .+;\n/gmu, "")
	.replace(/\bexport\s+/gu, "")}
return { onRequest };
`,
	)(
		privatePublishManifest,
		async () => identity,
		runtimeModule.resolvePrivatePublishPermission,
	) as {
		onRequest(context: {
			request: Request;
			env: { ASSETS: { fetch(request: Request): Promise<Response> } };
			next(): Promise<Response>;
		}): Promise<Response>;
	};
	const fetchedAssetPaths: string[] = [];
	const env = {
		ASSETS: {
			async fetch(request: Request) {
				fetchedAssetPaths.push(new URL(request.url).pathname);
				return new Response("asset", { status: 200 });
			},
		},
	};

	const denied = await loadRoute(null).onRequest({
		request: new Request("https://publish.example.com/public/report.pdf"),
		env,
		next: async () => new Response("next", { status: 599 }),
	});
	assert.equal(denied.status, 403);
	assert.deepEqual(fetchedAssetPaths, []);

	const allowedHtml = await loadRoute({ provider: "google", identifier: "alice@example.com" }).onRequest({
		request: new Request("https://publish.example.com/public/docs/page"),
		env,
		next: async () => new Response("next", { status: 599 }),
	});
	assert.equal(allowedHtml.status, 200);
	assert.deepEqual(fetchedAssetPaths, ["/_aside/private-assets/sha256-page/docs/page.html"]);

	const missing = await loadRoute({ provider: "google", identifier: "alice@example.com" }).onRequest({
		request: new Request("https://publish.example.com/public/missing"),
		env,
		next: async () => new Response("next", { status: 599 }),
	});
	assert.equal(missing.status, 404);
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
	assert.equal("assetPath" in aliceManifest.files[0], false);
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

test("generated private publish runtime reads and writes D1 comment events", async () => {
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
return { createPublishedCommentEvent, getPublishedComments, getPublishedCommentsSchemaSql };
`)() as {
		createPublishedCommentEvent: (
			env: Record<string, unknown>,
			input: {
				path: string;
				body: string;
				identity: { provider: "google"; identifier: string; name?: string };
				eventId: string;
				createdAt: string;
			},
		) => Promise<{ ok: true; comment: unknown } | { ok: false; error: string }>;
		getPublishedComments: (
			env: Record<string, unknown>,
			path: string,
		) => Promise<{ ok: true; comments: unknown[] } | { ok: false; error: string }>;
		getPublishedCommentsSchemaSql: () => string;
	};
	const d1 = createFakeCommentsD1();

	assert.match(runtimeModule.getPublishedCommentsSchemaSql(), /CREATE TABLE IF NOT EXISTS aside_comment_events/u);
	assert.deepEqual(await runtimeModule.getPublishedComments({}, "docs/page.html"), {
		ok: false,
		error: "Aside comments D1 binding ASIDE_COMMENTS_DB is not configured.",
	});

	assert.deepEqual(await runtimeModule.createPublishedCommentEvent({
		ASIDE_COMMENTS_DB: d1,
	}, {
		path: "docs/page.html",
		body: " First comment ",
		identity: {
			provider: "google",
			identifier: "Alice@Example.com",
			name: "Alice",
		},
		eventId: "event-1",
		createdAt: "2026-07-26T09:00:00.000Z",
	}), {
		ok: true,
		comment: {
			id: "event-1",
			path: "docs/page.html",
			body: "First comment",
			createdAt: "2026-07-26T09:00:00.000Z",
			author: {
				provider: "google",
				identity: "alice@example.com",
				displayName: "Alice",
			},
			replies: [],
		},
	});
	assert.deepEqual(d1.capturedSql.map((entry) => entry.sql), [
		"INSERT OR IGNORE INTO aside_comment_events (event_id, path, op, payload_json, author_provider, author_identity, author_display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
	]);

	assert.deepEqual(await runtimeModule.getPublishedComments({
		ASIDE_COMMENTS_DB: d1,
	}, "docs/page.html"), {
		ok: true,
		comments: [{
			id: "event-1",
			path: "docs/page.html",
			body: "First comment",
			createdAt: "2026-07-26T09:00:00.000Z",
			author: {
				provider: "google",
				identity: "alice@example.com",
				displayName: "Alice",
			},
			replies: [],
		}],
	});

	const commentsRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/comments/index.js")?.contents ?? "";
	assert.match(commentsRoute, /getPublishedComments/u);
	assert.match(commentsRoute, /createPublishedCommentEvent/u);
	assert.match(commentsRoute, /resolvePrivatePublishPermission/u);
});

test("generated private publish runtime returns read-only seed comments with D1 comments", async () => {
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
return { createPublishedCommentEvent, getPublishedComments };
`)() as {
		createPublishedCommentEvent: (
			env: Record<string, unknown>,
			input: {
				path: string;
				body: string;
				identity: { provider: "google"; identifier: string; name?: string };
				eventId: string;
				createdAt: string;
			},
		) => Promise<{ ok: true; comment: unknown } | { ok: false; error: string }>;
		getPublishedComments: (
			env: Record<string, unknown>,
			path: string,
			seeds?: unknown[],
		) => Promise<{ ok: true; comments: unknown[] } | { ok: false; error: string }>;
	};
	const seedComments = [{
		id: "local-page-note",
		path: "docs/page.html",
		body: "Existing local note",
		createdAt: "2026-07-26T07:30:00.000Z",
		author: {
			provider: "google",
			identity: "owner@example.com",
			displayName: "Owner",
		},
		readOnly: true,
		replies: [],
	}];

	assert.deepEqual(await runtimeModule.getPublishedComments({}, "docs/page.html", seedComments), {
		ok: true,
		comments: seedComments,
	});

	const d1 = createFakeCommentsD1();
	await runtimeModule.createPublishedCommentEvent({
		ASIDE_COMMENTS_DB: d1,
	}, {
		path: "docs/page.html",
		body: "Remote note",
		identity: {
			provider: "google",
			identifier: "alice@example.com",
			name: "Alice",
		},
		eventId: "event-1",
		createdAt: "2026-07-26T09:00:00.000Z",
	});

	assert.deepEqual(await runtimeModule.getPublishedComments({
		ASIDE_COMMENTS_DB: d1,
	}, "docs/page.html", seedComments), {
		ok: true,
		comments: [
			...seedComments,
			{
				id: "event-1",
				path: "docs/page.html",
				body: "Remote note",
				createdAt: "2026-07-26T09:00:00.000Z",
				author: {
					provider: "google",
					identity: "alice@example.com",
					displayName: "Alice",
				},
				replies: [],
			},
		],
	});
});

test("generated private publish runtime folds reply, update, and delete events with author ownership", async () => {
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
return {
	createPublishedCommentEvent,
	appendPublishedCommentReplyEvent,
	updatePublishedCommentEvent,
	deletePublishedCommentEvent,
	getPublishedComments,
};
`)() as {
		createPublishedCommentEvent: (
			env: Record<string, unknown>,
			input: {
				path: string;
				body: string;
				identity: { provider: "google"; identifier: string; name?: string };
				eventId: string;
				createdAt: string;
			},
		) => Promise<{ ok: true; comment: unknown } | { ok: false; error: string }>;
		appendPublishedCommentReplyEvent: (
			env: Record<string, unknown>,
			input: {
				path: string;
				parentId: string;
				body: string;
				identity: { provider: "google"; identifier: string; name?: string };
				eventId: string;
				createdAt: string;
			},
		) => Promise<{ ok: true; comment: unknown } | { ok: false; error: string }>;
		updatePublishedCommentEvent: (
			env: Record<string, unknown>,
			input: {
				path: string;
				targetId: string;
				body: string;
				identity: { provider: "google"; identifier: string; name?: string };
				eventId: string;
				createdAt: string;
			},
		) => Promise<{ ok: true; comment: unknown } | { ok: false; error: string }>;
		deletePublishedCommentEvent: (
			env: Record<string, unknown>,
			input: {
				path: string;
				targetId: string;
				identity: { provider: "google"; identifier: string; name?: string };
				eventId: string;
				createdAt: string;
			},
		) => Promise<{ ok: true; deletedCommentId: string } | { ok: false; error: string }>;
		getPublishedComments: (
			env: Record<string, unknown>,
			path: string,
		) => Promise<{ ok: true; comments: unknown[] } | { ok: false; error: string }>;
	};
	const d1 = createFakeCommentsD1();
	const env = { ASIDE_COMMENTS_DB: d1 };
	const alice = { provider: "google" as const, identifier: "Alice@Example.com", name: "Alice" };
	const bob = { provider: "google" as const, identifier: "bob@example.com", name: "Bob" };

	await runtimeModule.createPublishedCommentEvent(env, {
		path: "docs/page.html",
		body: "Root note",
		identity: alice,
		eventId: "thread-1",
		createdAt: "2026-07-26T09:00:00.000Z",
	});
	assert.deepEqual(await runtimeModule.appendPublishedCommentReplyEvent(env, {
		path: "docs/page.html",
		parentId: "thread-1",
		body: "Reply note",
		identity: bob,
		eventId: "reply-1",
		createdAt: "2026-07-26T09:01:00.000Z",
	}), {
		ok: true,
		comment: {
			id: "reply-1",
			parentId: "thread-1",
			path: "docs/page.html",
			body: "Reply note",
			createdAt: "2026-07-26T09:01:00.000Z",
			author: {
				provider: "google",
				identity: "bob@example.com",
				displayName: "Bob",
			},
			replies: [],
		},
	});
	assert.deepEqual(await runtimeModule.updatePublishedCommentEvent(env, {
		path: "docs/page.html",
		targetId: "reply-1",
		body: "Edited by Alice",
		identity: alice,
		eventId: "update-denied",
		createdAt: "2026-07-26T09:02:00.000Z",
	}), {
		ok: false,
		error: "Only the original author can modify this comment.",
	});
	assert.deepEqual(await runtimeModule.updatePublishedCommentEvent(env, {
		path: "docs/page.html",
		targetId: "reply-1",
		body: "Edited reply",
		identity: bob,
		eventId: "update-1",
		createdAt: "2026-07-26T09:03:00.000Z",
	}), {
		ok: true,
		comment: {
			id: "reply-1",
			parentId: "thread-1",
			path: "docs/page.html",
			body: "Edited reply",
			createdAt: "2026-07-26T09:01:00.000Z",
			updatedAt: "2026-07-26T09:03:00.000Z",
			author: {
				provider: "google",
				identity: "bob@example.com",
				displayName: "Bob",
			},
			replies: [],
		},
	});
	assert.deepEqual(await runtimeModule.deletePublishedCommentEvent(env, {
		path: "docs/page.html",
		targetId: "thread-1",
		identity: bob,
		eventId: "delete-denied",
		createdAt: "2026-07-26T09:04:00.000Z",
	}), {
		ok: false,
		error: "Only the original author can modify this comment.",
	});
	assert.deepEqual(await runtimeModule.deletePublishedCommentEvent(env, {
		path: "docs/page.html",
		targetId: "reply-1",
		identity: bob,
		eventId: "delete-1",
		createdAt: "2026-07-26T09:05:00.000Z",
	}), {
		ok: true,
		deletedCommentId: "reply-1",
	});

	assert.deepEqual(await runtimeModule.getPublishedComments(env, "docs/page.html"), {
		ok: true,
		comments: [{
			id: "thread-1",
			path: "docs/page.html",
			body: "Root note",
			createdAt: "2026-07-26T09:00:00.000Z",
			author: {
				provider: "google",
				identity: "alice@example.com",
				displayName: "Alice",
			},
			replies: [],
		}],
	});
});

test("generated private publish runtime writes D1 comment events idempotently", async () => {
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
return { createPublishedCommentEvent, getPublishedComments };
`)() as {
		createPublishedCommentEvent: (
			env: Record<string, unknown>,
			input: {
				path: string;
				body: string;
				identity: { provider: "google"; identifier: string; name?: string };
				eventId: string;
				createdAt: string;
			},
		) => Promise<{ ok: true; comment: unknown } | { ok: false; error: string }>;
		getPublishedComments: (
			env: Record<string, unknown>,
			path: string,
		) => Promise<{ ok: true; comments: unknown[] } | { ok: false; error: string }>;
	};
	const d1 = createFakeCommentsD1();
	const env = { ASIDE_COMMENTS_DB: d1 };
	const identity = { provider: "google" as const, identifier: "alice@example.com", name: "Alice" };

	assert.equal((await runtimeModule.createPublishedCommentEvent(env, {
		path: "docs/page.html",
		body: "First body",
		identity,
		eventId: "event-1",
		createdAt: "2026-07-26T09:00:00.000Z",
	})).ok, true);
	assert.deepEqual(await runtimeModule.createPublishedCommentEvent(env, {
		path: "docs/page.html",
		body: "Duplicate body",
		identity,
		eventId: "event-1",
		createdAt: "2026-07-26T09:10:00.000Z",
	}), {
		ok: true,
		comment: {
			id: "event-1",
			path: "docs/page.html",
			body: "First body",
			createdAt: "2026-07-26T09:00:00.000Z",
			author: {
				provider: "google",
				identity: "alice@example.com",
				displayName: "Alice",
			},
			replies: [],
		},
	});
	assert.deepEqual(await runtimeModule.getPublishedComments(env, "docs/page.html"), {
		ok: true,
		comments: [{
			id: "event-1",
			path: "docs/page.html",
			body: "First body",
			createdAt: "2026-07-26T09:00:00.000Z",
			author: {
				provider: "google",
				identity: "alice@example.com",
				displayName: "Alice",
			},
			replies: [],
		}],
	});
	assert.equal(d1.rows.length, 1);
});

test("generated private publish runtime exports D1 comment event rows for local import", async () => {
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
return { getPublishedCommentEvents };
`)() as {
		getPublishedCommentEvents: (
			env: Record<string, unknown>,
			cursor?: { afterCreatedAt?: string; afterEventId?: string },
		) => Promise<{ ok: true; events: unknown[] } | { ok: false; error: string }>;
	};
	const d1 = createFakeCommentsD1();
	d1.rows.push({
		event_id: "event-1",
		path: "docs/page.html",
		op: "createThread",
		payload_json: JSON.stringify({ body: "Root note" }),
		author_provider: "google",
		author_identity: "alice@example.com",
		author_display_name: "Alice",
		created_at: "2026-07-26T09:00:00.000Z",
	}, {
		event_id: "event-2",
		path: "docs/page.html",
		op: "appendReply",
		payload_json: JSON.stringify({ parentId: "event-1", body: "Reply" }),
		author_provider: "google",
		author_identity: "bob@example.com",
		author_display_name: null,
		created_at: "2026-07-26T09:05:00.000Z",
	});

	assert.deepEqual(await runtimeModule.getPublishedCommentEvents({ ASIDE_COMMENTS_DB: d1 }), {
		ok: true,
		events: [{
			eventId: "event-1",
			path: "docs/page.html",
			op: "createThread",
			payload: {
				body: "Root note",
			},
			author: {
				provider: "google",
				identity: "alice@example.com",
				displayName: "Alice",
			},
			createdAt: "2026-07-26T09:00:00.000Z",
		}, {
			eventId: "event-2",
			path: "docs/page.html",
			op: "appendReply",
			payload: {
				parentId: "event-1",
				body: "Reply",
			},
			author: {
				provider: "google",
				identity: "bob@example.com",
			},
			createdAt: "2026-07-26T09:05:00.000Z",
		}],
	});
	assert.deepEqual(await runtimeModule.getPublishedCommentEvents({ ASIDE_COMMENTS_DB: d1 }, {
		afterCreatedAt: "2026-07-26T09:00:00.000Z",
		afterEventId: "event-1",
	}), {
		ok: true,
		events: [{
			eventId: "event-2",
			path: "docs/page.html",
			op: "appendReply",
			payload: {
				parentId: "event-1",
				body: "Reply",
			},
			author: {
				provider: "google",
				identity: "bob@example.com",
			},
			createdAt: "2026-07-26T09:05:00.000Z",
		}],
	});
});

test("generated comment event export route requires manage permission", async () => {
	const supportFiles = buildPrivatePublishSnapshotSupportFiles({
		allowedRoot: "public/",
		publishBaseUrl: "https://publish.example.com",
		publishedAt: "2026-07-26T08:00:00.000Z",
		files: [],
		authRules: [],
	});
	const eventRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/comment-events/index.js")?.contents ?? "";
	let sessionIdentity: { provider: "google"; identifier: string } | null = null;
	let canManage = false;
	const calls: unknown[] = [];
	const routeModule = new Function(
		"privatePublishManifest",
		"getAsideSessionIdentity",
		"getPublishedCommentEvents",
		"resolvePrivatePublishPermission",
		`
${eventRoute.replace(/^import .*;\n/gmu, "")}
return { onRequestGet };
`.replace(/\bexport\s+/gu, ""),
	)({
		permissionRules: [],
	}, async () => sessionIdentity, async (_env: unknown, cursor: unknown) => {
		calls.push(cursor);
		return {
			ok: true,
			events: [{
				eventId: "event-2",
				path: "docs/page.html",
			}],
		};
	}, (_rules: unknown, identity: unknown, path: string) => ({
		canView: Boolean(identity),
		canComment: Boolean(identity),
		canManage: path === "/" && canManage,
	})) as {
		onRequestGet: (context: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
	};

	assert.equal((await routeModule.onRequestGet({
		request: new Request("https://publish.example.com/_aside/api/comment-events"),
		env: {},
	})).status, 401);

	sessionIdentity = {
		provider: "google",
		identifier: "owner@example.com",
	};
	assert.equal((await routeModule.onRequestGet({
		request: new Request("https://publish.example.com/_aside/api/comment-events"),
		env: {},
	})).status, 403);

	canManage = true;
	const response = await routeModule.onRequestGet({
		request: new Request("https://publish.example.com/_aside/api/comment-events?afterCreatedAt=2026-07-26T09%3A00%3A00.000Z&afterEventId=event-1"),
		env: {},
	});
	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), {
		events: [{
			eventId: "event-2",
			path: "docs/page.html",
		}],
	});
	assert.deepEqual(calls, [{
		afterCreatedAt: "2026-07-26T09:00:00.000Z",
		afterEventId: "event-1",
	}]);
});

test("generated comments route enforces view and comment permissions", async () => {
	const supportFiles = buildPrivatePublishSnapshotSupportFiles({
		allowedRoot: "public/",
		publishBaseUrl: "https://publish.example.com",
		publishedAt: "2026-07-26T08:00:00.000Z",
		files: [],
		authRules: [],
	});
	const commentsRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/comments/index.js")?.contents ?? "";
	let sessionIdentity: { provider: "google"; identifier: string } | null = null;
	const createdInputs: unknown[] = [];
	const routeModule = new Function(
		"privatePublishManifest",
		"createPublishedCommentEvent",
		"getAsideSessionIdentity",
		"getPublishedComments",
		"resolvePrivatePublishPermission",
		`
${commentsRoute.replace(/^import .*;\n/gmu, "")}
return { onRequestGet, onRequestPost };
`.replace(/\bexport\s+/gu, ""),
	)({
		permissionRules: [],
	}, async (_env: unknown, input: unknown) => {
		createdInputs.push(input);
		return {
			ok: true,
			comment: {
				id: "event-1",
				body: "A note",
			},
		};
	}, async () => sessionIdentity, async (_env: unknown, path: string) => ({
		ok: true,
		comments: [{
			id: "event-1",
			path,
			body: "A note",
		}],
	}), (_rules: unknown, identity: unknown, path: string) => ({
		canView: Boolean(identity) && path === "docs/page.html",
		canComment: Boolean(identity) && path === "docs/page.html",
		canManage: false,
	})) as {
		onRequestGet: (context: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
		onRequestPost: (context: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
	};

	const forbiddenRead = await routeModule.onRequestGet({
		request: new Request("https://publish.example.com/_aside/api/comments?path=docs/page.html"),
		env: {},
	});
	assert.equal(forbiddenRead.status, 403);

	sessionIdentity = {
		provider: "google",
		identifier: "alice@example.com",
	};
	const read = await routeModule.onRequestGet({
		request: new Request("https://publish.example.com/_aside/api/comments?path=docs/page.html"),
		env: {},
	});
	assert.equal(read.status, 200);
	assert.deepEqual(await read.json(), {
		comments: [{
			id: "event-1",
			path: "docs/page.html",
			body: "A note",
		}],
	});

	const created = await routeModule.onRequestPost({
		request: new Request("https://publish.example.com/_aside/api/comments", {
			method: "POST",
			body: JSON.stringify({
				path: "docs/page.html",
				body: "A note",
			}),
		}),
		env: {},
	});
	assert.equal(created.status, 201);
	assert.deepEqual(createdInputs, [{
		path: "docs/page.html",
		body: "A note",
		identity: sessionIdentity,
	}]);

	const forbiddenCreate = await routeModule.onRequestPost({
		request: new Request("https://publish.example.com/_aside/api/comments", {
			method: "POST",
			body: JSON.stringify({
				path: "secret/page.html",
				body: "A note",
			}),
		}),
		env: {},
	});
	assert.equal(forbiddenCreate.status, 403);
});

test("generated comments route dispatches reply, update, and delete requests and rejects malformed payloads", async () => {
	const supportFiles = buildPrivatePublishSnapshotSupportFiles({
		allowedRoot: "public/",
		publishBaseUrl: "https://publish.example.com",
		publishedAt: "2026-07-26T08:00:00.000Z",
		files: [],
		authRules: [],
	});
	const commentsRoute = supportFiles.functions.find((file) =>
		file.projectRelativePath === "functions/_aside/api/comments/index.js")?.contents ?? "";
	let sessionIdentity: { provider: "google"; identifier: string } | null = {
		provider: "google",
		identifier: "alice@example.com",
	};
	const calls: Array<{ op: string; input: unknown }> = [];
	const routeModule = new Function(
		"privatePublishManifest",
		"createPublishedCommentEvent",
		"appendPublishedCommentReplyEvent",
		"updatePublishedCommentEvent",
		"deletePublishedCommentEvent",
		"getAsideSessionIdentity",
		"getPublishedComments",
		"resolvePrivatePublishPermission",
		`
${commentsRoute.replace(/^import .*;\n/gmu, "")}
return { onRequestPost };
`.replace(/\bexport\s+/gu, ""),
	)({
		permissionRules: [],
	}, async (_env: unknown, input: unknown) => {
		calls.push({ op: "createThread", input });
		return { ok: true, comment: { id: "thread-1" } };
	}, async (_env: unknown, input: unknown) => {
		calls.push({ op: "appendReply", input });
		return { ok: true, comment: { id: "reply-1" } };
	}, async (_env: unknown, input: unknown) => {
		calls.push({ op: "update", input });
		return { ok: true, comment: { id: "reply-1", body: "Updated" } };
	}, async (_env: unknown, input: unknown) => {
		calls.push({ op: "delete", input });
		return { ok: true, deletedCommentId: "reply-1" };
	}, async () => sessionIdentity, async () => ({ ok: true, comments: [] }), () => ({
		canView: true,
		canComment: true,
		canManage: false,
	})) as {
		onRequestPost: (context: { request: Request; env: Record<string, unknown> }) => Promise<Response>;
	};

	const reply = await routeModule.onRequestPost({
		request: new Request("https://publish.example.com/_aside/api/comments", {
			method: "POST",
			body: JSON.stringify({
				op: "appendReply",
				path: "docs/page.html",
				parentId: "thread-1",
				body: "Reply body",
				eventId: "reply-event",
			}),
		}),
		env: {},
	});
	assert.equal(reply.status, 201);
	assert.deepEqual(calls.at(-1), {
		op: "appendReply",
		input: {
			path: "docs/page.html",
			parentId: "thread-1",
			body: "Reply body",
			eventId: "reply-event",
			identity: sessionIdentity,
		},
	});

	const update = await routeModule.onRequestPost({
		request: new Request("https://publish.example.com/_aside/api/comments", {
			method: "POST",
			body: JSON.stringify({
				op: "update",
				path: "docs/page.html",
				targetId: "reply-1",
				body: "Updated body",
			}),
		}),
		env: {},
	});
	assert.equal(update.status, 200);
	assert.deepEqual(calls.at(-1), {
		op: "update",
		input: {
			path: "docs/page.html",
			targetId: "reply-1",
			body: "Updated body",
			identity: sessionIdentity,
		},
	});

	const deleted = await routeModule.onRequestPost({
		request: new Request("https://publish.example.com/_aside/api/comments", {
			method: "POST",
			body: JSON.stringify({
				op: "delete",
				path: "docs/page.html",
				targetId: "reply-1",
				eventId: "delete-event",
			}),
		}),
		env: {},
	});
	assert.equal(deleted.status, 200);
	assert.deepEqual(calls.at(-1), {
		op: "delete",
		input: {
			path: "docs/page.html",
			targetId: "reply-1",
			eventId: "delete-event",
			identity: sessionIdentity,
		},
	});

	const unsupported = await routeModule.onRequestPost({
		request: new Request("https://publish.example.com/_aside/api/comments", {
			method: "POST",
			body: JSON.stringify({
				op: "unknown",
				path: "docs/page.html",
				body: "Nope",
			}),
		}),
		env: {},
	});
	assert.equal(unsupported.status, 400);
	assert.deepEqual(await unsupported.json(), { error: "Unsupported comment operation." });

	sessionIdentity = null;
	const anonymous = await routeModule.onRequestPost({
		request: new Request("https://publish.example.com/_aside/api/comments", {
			method: "POST",
			body: JSON.stringify({
				op: "appendReply",
				path: "docs/page.html",
				parentId: "thread-1",
				body: "Reply body",
			}),
		}),
		env: {},
	});
	assert.equal(anonymous.status, 401);
});

test("generated middleware enforces view permissions for published content", async () => {
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
			access: "view",
			line: 3,
		}],
	});
	const middleware = supportFiles.functions.find((file) => file.projectRelativePath === "functions/_middleware.js")?.contents ?? "";
	const runtime = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-runtime.js");
	assert.ok(runtime);
	const runtimeModule = new Function(`
${runtime.contents.replace(/\bexport\s+/gu, "")}
return { resolvePrivatePublishPermission };
`)() as {
		resolvePrivatePublishPermission: (
			rules: unknown,
			identity: unknown,
			path: string,
		) => { canView: boolean; canComment: boolean; canManage: boolean };
	};
	const privateData = supportFiles.privateModules.find((file) =>
		file.projectRelativePath === "src/_aside/private-publish-data.js");
	assert.ok(privateData);
	const privateDataMatch = /^export const privatePublishManifest = ([\s\S]*);$/u.exec(privateData.contents);
	assert.ok(privateDataMatch);
	const manifest = JSON.parse(privateDataMatch[1]) as unknown;
	let identity: { provider: "google"; identifier: string } | null = null;
	let nextCalls = 0;
	const middlewareModule = new Function(
		"privatePublishManifest",
		"getAsideSessionIdentity",
		"resolvePrivatePublishPermission",
		`
${middleware.replace(/^import .*;\n/gmu, "")}
return { onRequest };
`.replace(/\bexport\s+/gu, ""),
	)(manifest, async () => identity, runtimeModule.resolvePrivatePublishPermission) as {
		onRequest: (context: {
			request: Request;
			env: Record<string, unknown>;
			next: () => Promise<Response>;
		}) => Promise<Response>;
	};
	const makeContext = (path: string) => ({
		request: new Request(`https://publish.example.com${path}`),
		env: {},
		next: async () => {
			nextCalls += 1;
			return new Response("next");
		},
	});

	assert.equal((await middlewareModule.onRequest(makeContext("/public/docs/page.html"))).status, 403);
	assert.equal(nextCalls, 0);

	identity = {
		provider: "google",
		identifier: "alice@example.com",
	};
	assert.equal(await (await middlewareModule.onRequest(makeContext("/public/docs/page.html"))).text(), "next");
	assert.equal(nextCalls, 1);
	assert.equal(await (await middlewareModule.onRequest(makeContext("/public/docs/page"))).text(), "next");
	assert.equal(nextCalls, 2);
	assert.equal((await middlewareModule.onRequest(makeContext("/public/secret.html"))).status, 403);
	assert.equal(nextCalls, 2);
	assert.equal((await middlewareModule.onRequest(makeContext("/public/auth.md"))).status, 404);
	assert.equal(await (await middlewareModule.onRequest(makeContext("/"))).text(), "next");
	assert.equal(nextCalls, 3);
});

function createFakeCommentsD1() {
	const rows: Array<Record<string, unknown>> = [];
	const capturedSql: Array<{ sql: string; params: unknown[] }> = [];
	return {
		rows,
		capturedSql,
		prepare(sql: string) {
			return {
				bind(...params: unknown[]) {
					return {
						async all() {
							capturedSql.push({ sql, params });
							const sortedRows = rows
								.slice()
								.sort((left, right) =>
									String(left.created_at).localeCompare(String(right.created_at))
									|| String(left.event_id).localeCompare(String(right.event_id)));
							const results = /WHERE path = \?/u.test(sql)
								? sortedRows.filter((row) => row.path === params[0])
								: sortedRows.filter((row) =>
									!params[0]
									|| String(row.created_at) > String(params[1])
									|| (String(row.created_at) === String(params[2]) && String(row.event_id) > String(params[3])));
							return {
								success: true,
								results,
							};
						},
						async first() {
							capturedSql.push({ sql, params });
							if (/WHERE event_id = \?/u.test(sql)) {
								return rows.find((row) => row.event_id === params[0]) ?? null;
							}
							return rows.find((row) => row.path === params[0]) ?? null;
						},
						async run() {
							capturedSql.push({ sql, params });
							if (rows.some((row) => row.event_id === params[0])) {
								if (/INSERT OR IGNORE/u.test(sql)) {
									return { success: true, meta: { changes: 0 } };
								}
								throw new Error("UNIQUE constraint failed: aside_comment_events.event_id");
							}
							rows.push({
								event_id: params[0],
								path: params[1],
								op: params[2],
								payload_json: params[3],
								author_provider: params[4],
								author_identity: params[5],
								author_display_name: params[6],
								created_at: params[7],
							});
							return { success: true };
						},
					};
				},
			};
		},
	};
}

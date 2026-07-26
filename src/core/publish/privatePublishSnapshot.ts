import type {
	PrivatePublishAuthRule,
	PrivatePublishProvider,
} from "./privatePublishAuth";
import {
	normalizeVaultRelativePublishPath,
} from "./publishPath";
import {
	normalizePublishAllowedRoot,
} from "./publishSettings";
import {
	renderPrivatePublishShellHtml,
	renderPrivatePublishShellScript,
	renderPrivatePublishShellStyles,
} from "./privatePublishShell";

export type PrivatePublishSnapshotFileKind = "markdown" | "html" | "pdf";

export interface PrivatePublishSnapshotContentFile {
	vaultRelativePath: string;
	sourcePath: string;
	kind: PrivatePublishSnapshotFileKind;
	contentHash: string;
}

export interface PrivatePublishSnapshotStaticAssetFile {
	assetRelativePath: string;
	contents: string;
}

export interface PrivatePublishSnapshotProjectFile {
	projectRelativePath: string;
	contents: string;
}

export interface PrivatePublishSnapshotSupportFiles {
	staticAssets: PrivatePublishSnapshotStaticAssetFile[];
	functions: PrivatePublishSnapshotProjectFile[];
	privateModules: PrivatePublishSnapshotProjectFile[];
}

export interface BuildPrivatePublishSnapshotSupportFilesInput {
	allowedRoot: string;
	publishBaseUrl: string;
	publishedAt: string;
	files: readonly PrivatePublishSnapshotContentFile[];
	authRules: readonly PrivatePublishAuthRule[];
	commentSeeds?: readonly PrivatePublishSnapshotCommentSeedInput[];
}

export interface PrivatePublishManifestFileVersion {
	id: string;
	contentHash: string;
	publishedAt: string;
}

export interface PrivatePublishManifestFile {
	publicPath: string;
	routePath: string;
	sourcePath: string;
	kind: PrivatePublishSnapshotFileKind;
	contentHash: string;
	publishedAt: string;
	currentVersion: PrivatePublishManifestFileVersion;
	versions: PrivatePublishManifestFileVersion[];
}

export interface PrivatePublishManifestFolder {
	name: string;
	path: string;
	type: "folder";
	children: Array<PrivatePublishManifestFolder | PrivatePublishManifestTreeFile>;
}

export interface PrivatePublishManifestTreeFile {
	name: string;
	path: string;
	type: "file";
	kind: PrivatePublishSnapshotFileKind;
}

export interface PrivatePublishManifestPermissionRule {
	provider: PrivatePublishProvider;
	identifier: string;
	path: string;
	access: PrivatePublishAuthRule["access"];
	line: number;
}

export interface PrivatePublishSnapshotCommentSeedAuthor {
	provider: string;
	identity: string;
	displayName?: string;
}

export interface PrivatePublishSnapshotCommentSeedInput {
	publicPath: string;
	id: string;
	body: string;
	createdAt: string;
	author?: PrivatePublishSnapshotCommentSeedAuthor;
}

export interface PrivatePublishManifestCommentSeed {
	id: string;
	path: string;
	body: string;
	createdAt: string;
	author?: PrivatePublishSnapshotCommentSeedAuthor;
	readOnly: true;
	replies: [];
}

export interface PrivatePublishManifest {
	version: 1;
	generatedAt: string;
	allowedRoot: string;
	baseUrl: string;
	controlPaths: {
		auth: string;
	};
	files: PrivatePublishManifestFile[];
	tree: PrivatePublishManifestFolder;
	providers: PrivatePublishProvider[];
	unsupportedProviders: PrivatePublishProvider[];
	permissionRules: PrivatePublishManifestPermissionRule[];
	commentSeeds: PrivatePublishManifestCommentSeed[];
}

const GOOGLE_PROVIDER: PrivatePublishProvider = "google";

export function buildPrivatePublishSnapshotSupportFiles(
	input: BuildPrivatePublishSnapshotSupportFilesInput,
): PrivatePublishSnapshotSupportFiles {
	const manifest = buildPrivatePublishManifest(input);
	return {
		staticAssets: [{
			assetRelativePath: "_routes.json",
			contents: renderRoutesJson(),
		}, {
			assetRelativePath: "index.html",
			contents: renderPrivatePublishShellHtml(),
		}, {
			assetRelativePath: "_aside/app.js",
			contents: renderPrivatePublishShellScript(),
		}, {
			assetRelativePath: "_aside/styles.css",
			contents: renderPrivatePublishShellStyles(),
		}],
		functions: [{
			projectRelativePath: "functions/_middleware.js",
			contents: renderMiddleware(),
		}, {
			projectRelativePath: "functions/_aside/api/auth/session.js",
			contents: renderAuthSessionRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/auth/google/start.js",
			contents: renderGoogleAuthStartRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/auth/google/callback.js",
			contents: renderGoogleAuthCallbackRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/auth/logout.js",
			contents: renderAuthLogoutRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/site-manifest.js",
			contents: renderSiteManifestRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/comments/index.js",
			contents: renderCommentsRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/comment-events/index.js",
			contents: renderCommentEventsRoute(),
		}],
		privateModules: [{
			projectRelativePath: "src/_aside/private-publish-data.js",
			contents: renderPrivatePublishDataModule(manifest),
		}, {
			projectRelativePath: "src/_aside/private-publish-runtime.js",
			contents: renderPrivatePublishRuntimeModule(),
		}],
	};
}

export function buildPrivatePublishManifest(input: BuildPrivatePublishSnapshotSupportFilesInput): PrivatePublishManifest {
	const files = input.files
		.map((file) => normalizeManifestFile(input, file))
		.filter((file): file is PrivatePublishManifestFile => file !== null)
		.sort((left, right) => left.publicPath.localeCompare(right.publicPath));
	const permissionRules = input.authRules
		.map(normalizePermissionRule)
		.filter((rule): rule is PrivatePublishManifestPermissionRule => rule !== null);
	const publicPaths = new Set(files.map((file) => file.publicPath));
	const commentSeeds = (input.commentSeeds ?? [])
		.map((seed) => normalizeCommentSeed(seed, publicPaths))
		.filter((seed): seed is PrivatePublishManifestCommentSeed => seed !== null);
	const providers = [...new Set(permissionRules.map((rule) => rule.provider))].sort();
	const unsupportedProviders = providers.filter((provider) => provider !== GOOGLE_PROVIDER);

	return {
		version: 1,
		generatedAt: input.publishedAt,
		allowedRoot: normalizePublishAllowedRoot(input.allowedRoot),
		baseUrl: input.publishBaseUrl,
		controlPaths: {
			auth: `/${normalizePublishAllowedRoot(input.allowedRoot)}auth.md`,
		},
		files,
		tree: buildManifestTree(files),
		providers: providers.filter((provider) => provider === GOOGLE_PROVIDER),
		unsupportedProviders,
		permissionRules,
		commentSeeds,
	};
}

function normalizeManifestFile(
	input: BuildPrivatePublishSnapshotSupportFilesInput,
	file: PrivatePublishSnapshotContentFile,
): PrivatePublishManifestFile | null {
	const publicPath = toPublicRootRelativePath(input.allowedRoot, file.vaultRelativePath);
	const sourcePath = toPublicRootRelativePath(input.allowedRoot, file.sourcePath);
	if (!publicPath || !sourcePath) {
		return null;
	}
	const currentVersion: PrivatePublishManifestFileVersion = {
		id: file.contentHash,
		contentHash: file.contentHash,
		publishedAt: input.publishedAt,
	};
	return {
		publicPath,
		routePath: buildRoutePath(file.vaultRelativePath),
		sourcePath,
		kind: file.kind,
		contentHash: file.contentHash,
		publishedAt: input.publishedAt,
		currentVersion,
		versions: [currentVersion],
	};
}

function normalizePermissionRule(rule: PrivatePublishAuthRule): PrivatePublishManifestPermissionRule {
	return {
		provider: rule.provider,
		identifier: rule.identifier,
		path: rule.path,
		access: rule.access,
		line: rule.line,
	};
}

function normalizeCommentSeedAuthor(author: unknown): PrivatePublishSnapshotCommentSeedAuthor | undefined {
	if (!author || typeof author !== "object" || Array.isArray(author)) {
		return undefined;
	}
	const record = author as Record<string, unknown>;
	const provider = typeof record.provider === "string" ? record.provider.trim() : "";
	const identity = typeof record.identity === "string" ? record.identity.trim() : "";
	if (!provider || !identity) {
		return undefined;
	}
	const displayName = typeof record.displayName === "string" ? record.displayName.trim() : "";
	return {
		provider,
		identity,
		...(displayName ? { displayName } : {}),
	};
}

function normalizeCommentSeed(
	seed: PrivatePublishSnapshotCommentSeedInput,
	publicPaths: ReadonlySet<string>,
): PrivatePublishManifestCommentSeed | null {
	const normalizedPath = normalizeVaultRelativePublishPath(seed.publicPath.replace(/^\/+/u, ""));
	const id = typeof seed.id === "string" ? seed.id.trim() : "";
	const body = typeof seed.body === "string" ? seed.body.trim() : "";
	const createdAt = typeof seed.createdAt === "string" ? seed.createdAt.trim() : "";
	if (!normalizedPath.ok || !publicPaths.has(normalizedPath.path) || !id || !body || !createdAt) {
		return null;
	}

	const author = normalizeCommentSeedAuthor(seed.author);
	return {
		id,
		path: normalizedPath.path,
		body,
		createdAt,
		...(author ? { author } : {}),
		readOnly: true,
		replies: [],
	};
}

function toPublicRootRelativePath(allowedRoot: string, path: string): string | null {
	const normalizedPath = normalizeVaultRelativePublishPath(path);
	if (!normalizedPath.ok) {
		return null;
	}
	const normalizedRoot = normalizePublishAllowedRoot(allowedRoot);
	if (!normalizedPath.path.startsWith(normalizedRoot)) {
		return null;
	}
	return normalizedPath.path.slice(normalizedRoot.length);
}

function buildRoutePath(vaultRelativePath: string): string {
	const normalizedPath = normalizeVaultRelativePublishPath(vaultRelativePath);
	const path = normalizedPath.ok ? normalizedPath.path : vaultRelativePath;
	const withoutHtmlExtension = path.replace(/\.html?$/iu, "");
	return `/${withoutHtmlExtension}`;
}

function buildManifestTree(files: readonly PrivatePublishManifestFile[]): PrivatePublishManifestFolder {
	const root: PrivatePublishManifestFolder = {
		name: "",
		path: "/",
		type: "folder",
		children: [],
	};
	const foldersByPath = new Map<string, PrivatePublishManifestFolder>([["/", root]]);

	for (const file of files) {
		const segments = file.publicPath.split("/").filter(Boolean);
		let current = root;
		let currentPath = "";
		for (const segment of segments.slice(0, -1)) {
			currentPath = `${currentPath}${segment}/`;
			let folder = foldersByPath.get(currentPath);
			if (!folder) {
				folder = {
					name: segment,
					path: currentPath,
					type: "folder",
					children: [],
				};
				foldersByPath.set(currentPath, folder);
				current.children.push(folder);
			}
			current = folder;
		}

		const fileName = segments.at(-1);
		if (fileName) {
			current.children.push({
				name: fileName,
				path: file.publicPath,
				type: "file",
				kind: file.kind,
			});
		}
	}

	sortManifestTree(root);
	return root;
}

function sortManifestTree(folder: PrivatePublishManifestFolder): void {
	folder.children.sort((left, right) =>
		manifestTreeTypeRank(left.type) - manifestTreeTypeRank(right.type) || left.name.localeCompare(right.name));
	for (const child of folder.children) {
		if (child.type === "folder") {
			sortManifestTree(child);
		}
	}
}

function manifestTreeTypeRank(type: "file" | "folder"): number {
	return type === "folder" ? 0 : 1;
}

function renderRoutesJson(): string {
	return `${JSON.stringify({
		version: 1,
		include: ["/*"],
		exclude: [],
	}, null, "\t")}\n`;
}

function renderMiddleware(): string {
	return [
		"import { privatePublishManifest } from \"../src/_aside/private-publish-data.js\";",
		"import { getAsideSessionIdentity, resolvePrivatePublishPermission } from \"../src/_aside/private-publish-runtime.js\";",
		"",
		"export async function onRequest(context) {",
		"\tconst url = new URL(context.request.url);",
		"\tif (url.pathname === privatePublishManifest.controlPaths.auth) {",
		"\t\treturn new Response(\"Not Found\", { status: 404 });",
		"\t}",
		"\tconst file = findPrivatePublishFileForPath(privatePublishManifest, url.pathname);",
		"\tif (!file) {",
		"\t\treturn context.next();",
		"\t}",
		"\tconst identity = await getAsideSessionIdentity(context.request, context.env);",
		"\tconst permission = resolvePrivatePublishPermission(privatePublishManifest.permissionRules, identity, file.publicPath);",
		"\tif (!permission.canView) {",
		"\t\treturn Response.json({ error: \"Not authorized to read this published file.\" }, { status: 403 });",
		"\t}",
		"\treturn context.next();",
		"}",
		"",
		"function findPrivatePublishFileForPath(manifest, pathname) {",
		"\tconst normalizedPathname = normalizeRequestPath(pathname);",
		"\tconst files = Array.isArray(manifest.files) ? manifest.files : [];",
		"\treturn files.find((file) => {",
		"\t\tconst staticPath = `/${manifest.allowedRoot}${file.publicPath}`;",
		"\t\treturn normalizeRequestPath(file.routePath) === normalizedPathname || normalizeRequestPath(staticPath) === normalizedPathname;",
		"\t}) ?? null;",
		"}",
		"",
		"function normalizeRequestPath(pathname) {",
		"\tconst value = typeof pathname === \"string\" && pathname ? pathname : \"/\";",
		"\treturn value.endsWith(\"/\") && value.length > 1 ? value.slice(0, -1) : value;",
		"}",
		"",
	].join("\n");
}

function renderAuthSessionRoute(): string {
	return [
		"import { privatePublishManifest } from \"../../../../src/_aside/private-publish-data.js\";",
		"import { getAsideSessionIdentity } from \"../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export async function onRequestGet(context) {",
		"\tconst identity = await getAsideSessionIdentity(context.request, context.env);",
		"\treturn Response.json({",
		"\t\tauthenticated: Boolean(identity),",
		"\t\tidentity,",
		"\t\tproviders: privatePublishManifest.providers,",
		"\t\tunsupportedProviders: privatePublishManifest.unsupportedProviders,",
		"\t});",
		"}",
		"",
	].join("\n");
}

function renderGoogleAuthStartRoute(): string {
	return [
		"import { createGoogleAuthorizationUrl, createOAuthStateCookie, createRandomState, getGoogleOAuthConfig } from \"../../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export function onRequestGet(context) {",
		"\tconst config = getGoogleOAuthConfig(context.request, context.env);",
		"\tif (!config.ok) {",
		"\t\treturn Response.json({ error: \"Google OAuth is not configured.\", missing: config.missing }, { status: 500 });",
		"\t}",
		"\tconst state = createRandomState();",
		"\treturn new Response(null, {",
		"\t\tstatus: 302,",
		"\t\theaders: {",
		"\t\t\tLocation: createGoogleAuthorizationUrl({",
		"\t\t\t\tclientId: config.clientId,",
		"\t\t\t\tredirectUri: config.redirectUri,",
		"\t\t\t\tstate,",
		"\t\t\t}),",
		"\t\t\t\"Set-Cookie\": createOAuthStateCookie(state),",
		"\t\t},",
		"\t});",
		"}",
		"",
	].join("\n");
}

function renderGoogleAuthCallbackRoute(): string {
	return [
		"import { clearOAuthStateCookie, createAsideSessionCookie, exchangeGoogleAuthorizationCode, getGoogleOAuthConfig, googleIdentityFromUserInfo, verifyOAuthState } from \"../../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export async function onRequestGet(context) {",
		"\tconst url = new URL(context.request.url);",
		"\tconst oauthError = url.searchParams.get(\"error\");",
		"\tif (oauthError) {",
		"\t\treturn Response.json({ error: oauthError }, { status: 400 });",
		"\t}",
		"\tconst code = url.searchParams.get(\"code\");",
		"\tconst state = url.searchParams.get(\"state\");",
		"\tif (!code || !state || !verifyOAuthState(context.request, state)) {",
		"\t\treturn Response.json({ error: \"Invalid Google OAuth callback state.\" }, { status: 400 });",
		"\t}",
		"\tconst config = getGoogleOAuthConfig(context.request, context.env);",
		"\tif (!config.ok) {",
		"\t\treturn Response.json({ error: \"Google OAuth is not configured.\", missing: config.missing }, { status: 500 });",
		"\t}",
		"\tconst userInfo = await exchangeGoogleAuthorizationCode(config, code);",
		"\tconst identity = googleIdentityFromUserInfo(userInfo);",
		"\tif (!identity) {",
		"\t\treturn Response.json({ error: \"Google account email is not verified.\" }, { status: 403 });",
		"\t}",
		"\treturn new Response(null, {",
		"\t\tstatus: 302,",
		"\t\theaders: [",
		"\t\t\t[\"Location\", new URL(\"/\", context.request.url).toString()],",
		"\t\t\t[\"Set-Cookie\", await createAsideSessionCookie(context.env, identity)],",
		"\t\t\t[\"Set-Cookie\", clearOAuthStateCookie()],",
		"\t\t],",
		"\t});",
		"}",
		"",
	].join("\n");
}

function renderAuthLogoutRoute(): string {
	return [
		"import { clearAsideSessionCookie } from \"../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export function onRequestPost(context) {",
		"\treturn new Response(null, {",
		"\t\tstatus: 302,",
		"\t\theaders: {",
		"\t\t\tLocation: new URL(\"/\", context.request.url).toString(),",
		"\t\t\t\"Set-Cookie\": clearAsideSessionCookie(),",
		"\t\t},",
		"\t});",
		"}",
		"",
	].join("\n");
}

function renderSiteManifestRoute(): string {
	return [
		"import { privatePublishManifest } from \"../../../src/_aside/private-publish-data.js\";",
		"import { filterPrivatePublishManifestForIdentity, getAsideSessionIdentity } from \"../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export async function onRequestGet(context) {",
		"\tconst identity = await getAsideSessionIdentity(context.request, context.env);",
		"\treturn Response.json(filterPrivatePublishManifestForIdentity(privatePublishManifest, identity));",
		"}",
		"",
	].join("\n");
}

function renderCommentsRoute(): string {
	return [
		"import { privatePublishManifest } from \"../../../../src/_aside/private-publish-data.js\";",
		"import { appendPublishedCommentReplyEvent, createPublishedCommentEvent, deletePublishedCommentEvent, getAsideSessionIdentity, getPublishedComments, resolvePrivatePublishPermission, updatePublishedCommentEvent } from \"../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export async function onRequestGet(context) {",
		"\tconst path = new URL(context.request.url).searchParams.get(\"path\") ?? \"\";",
		"\tconst identity = await getAsideSessionIdentity(context.request, context.env);",
		"\tconst permission = resolvePrivatePublishPermission(privatePublishManifest.permissionRules, identity, path);",
		"\tif (!permission.canView) {",
		"\t\treturn Response.json({ error: \"Not authorized to read comments for this path.\" }, { status: 403 });",
		"\t}",
		"\tconst result = await getPublishedComments(context.env, path, privatePublishManifest.commentSeeds);",
		"\treturn result.ok",
		"\t\t? Response.json({ comments: result.comments })",
		"\t\t: Response.json({ error: result.error }, { status: 500 });",
		"}",
		"",
		"export async function onRequestPost(context) {",
		"\tconst identity = await getAsideSessionIdentity(context.request, context.env);",
		"\tif (!identity) {",
		"\t\treturn Response.json({ error: \"Sign in before commenting.\" }, { status: 401 });",
		"\t}",
		"\tlet input;",
		"\ttry {",
		"\t\tinput = await context.request.json();",
		"\t} catch {",
		"\t\treturn Response.json({ error: \"Comment request must be JSON.\" }, { status: 400 });",
		"\t}",
		"\tconst path = typeof input?.path === \"string\" ? input.path : \"\";",
		"\tconst body = typeof input?.body === \"string\" ? input.body : \"\";",
		"\tconst op = typeof input?.op === \"string\" && input.op ? input.op : \"createThread\";",
		"\tconst permission = resolvePrivatePublishPermission(privatePublishManifest.permissionRules, identity, path);",
		"\tif (!permission.canComment) {",
		"\t\treturn Response.json({ error: \"Not authorized to comment on this path.\" }, { status: 403 });",
		"\t}",
		"\tconst baseInput = { path, identity };",
		"\tconst eventId = typeof input?.eventId === \"string\" && input.eventId.trim() ? input.eventId.trim() : \"\";",
		"\tif (eventId) {",
		"\t\tbaseInput.eventId = eventId;",
		"\t}",
		"\tif (op === \"createThread\") {",
		"\t\tconst result = await createPublishedCommentEvent(context.env, { ...baseInput, body });",
		"\t\treturn result.ok",
		"\t\t\t? Response.json({ comment: result.comment }, { status: 201 })",
		"\t\t\t: Response.json({ error: result.error }, { status: 400 });",
		"\t}",
		"\tif (op === \"appendReply\") {",
		"\t\tconst parentId = typeof input?.parentId === \"string\" ? input.parentId : \"\";",
		"\t\tconst result = await appendPublishedCommentReplyEvent(context.env, { ...baseInput, parentId, body });",
		"\t\treturn result.ok",
		"\t\t\t? Response.json({ comment: result.comment }, { status: 201 })",
		"\t\t\t: Response.json({ error: result.error }, { status: 400 });",
		"\t}",
		"\tif (op === \"update\") {",
		"\t\tconst targetId = typeof input?.targetId === \"string\" ? input.targetId : \"\";",
		"\t\tconst result = await updatePublishedCommentEvent(context.env, { ...baseInput, targetId, body });",
		"\t\treturn result.ok",
		"\t\t\t? Response.json({ comment: result.comment })",
		"\t\t\t: Response.json({ error: result.error }, { status: 400 });",
		"\t}",
		"\tif (op === \"delete\") {",
		"\t\tconst targetId = typeof input?.targetId === \"string\" ? input.targetId : \"\";",
		"\t\tconst result = await deletePublishedCommentEvent(context.env, { ...baseInput, targetId });",
		"\t\treturn result.ok",
		"\t\t\t? Response.json({ deletedCommentId: result.deletedCommentId })",
		"\t\t\t: Response.json({ error: result.error }, { status: 400 });",
		"\t}",
		"\treturn Response.json({ error: \"Unsupported comment operation.\" }, { status: 400 });",
		"}",
		"",
	].join("\n");
}

function renderCommentEventsRoute(): string {
	return [
		"import { privatePublishManifest } from \"../../../../src/_aside/private-publish-data.js\";",
		"import { getAsideSessionIdentity, getPublishedCommentEvents, resolvePrivatePublishPermission } from \"../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export async function onRequestGet(context) {",
		"\tconst identity = await getAsideSessionIdentity(context.request, context.env);",
		"\tif (!identity) {",
		"\t\treturn Response.json({ error: \"Sign in before exporting comment events.\" }, { status: 401 });",
		"\t}",
		"\tconst permission = resolvePrivatePublishPermission(privatePublishManifest.permissionRules, identity, \"/\");",
		"\tif (!permission.canManage) {",
		"\t\treturn Response.json({ error: \"Not authorized to export comment events.\" }, { status: 403 });",
		"\t}",
		"\tconst searchParams = new URL(context.request.url).searchParams;",
		"\tconst cursor = {};",
		"\tconst afterCreatedAt = searchParams.get(\"afterCreatedAt\") ?? \"\";",
		"\tconst afterEventId = searchParams.get(\"afterEventId\") ?? \"\";",
		"\tif (afterCreatedAt) {",
		"\t\tcursor.afterCreatedAt = afterCreatedAt;",
		"\t}",
		"\tif (afterEventId) {",
		"\t\tcursor.afterEventId = afterEventId;",
		"\t}",
		"\tconst result = await getPublishedCommentEvents(context.env, cursor);",
		"\treturn result.ok",
		"\t\t? Response.json({ events: result.events })",
		"\t\t: Response.json({ error: result.error }, { status: 500 });",
		"}",
		"",
	].join("\n");
}

function renderPrivatePublishDataModule(manifest: PrivatePublishManifest): string {
	return [
		"export const privatePublishManifest = ",
		JSON.stringify(manifest, null, "\t"),
		";",
		"",
	].join("");
}

function renderPrivatePublishRuntimeModule(): string {
	return [
		"const accessRanks = {",
		"\tview: 1,",
		"\tcomment: 2,",
		"\tfull: 3,",
		"};",
		"const SESSION_COOKIE_NAME = \"aside_session\";",
		"const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;",
		"const OAUTH_STATE_COOKIE_NAME = \"aside_oauth_state\";",
		"const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;",
		"const GOOGLE_AUTHORIZATION_ENDPOINT = \"https://accounts.google.com/o/oauth2/v2/auth\";",
		"const GOOGLE_TOKEN_ENDPOINT = \"https://oauth2.googleapis.com/token\";",
		"const GOOGLE_USERINFO_ENDPOINT = \"https://openidconnect.googleapis.com/v1/userinfo\";",
		"",
		"export async function getAsideSessionIdentity(request, env = {}, nowSeconds = Math.floor(Date.now() / 1000)) {",
		"\tconst cookieValue = parseCookies(request.headers.get(\"Cookie\") ?? request.headers.get(\"cookie\") ?? \"\")[SESSION_COOKIE_NAME];",
		"\tif (!cookieValue) {",
		"\t\treturn null;",
		"\t}",
		"\treturn verifyAsideSessionCookie(env, cookieValue, nowSeconds);",
		"}",
		"",
		"export async function createAsideSessionCookie(env, identity, nowSeconds = Math.floor(Date.now() / 1000)) {",
		"\tconst normalizedIdentity = normalizeIdentity(identity);",
		"\tif (!normalizedIdentity) {",
		"\t\tthrow new Error(\"Cannot create an Aside session without a supported identity.\");",
		"\t}",
		"\tconst payload = {",
		"\t\t...normalizedIdentity,",
		"\t\texp: nowSeconds + SESSION_MAX_AGE_SECONDS,",
		"\t};",
		"\tconst encodedPayload = base64urlEncodeJson(payload);",
		"\tconst signature = await signSessionValue(env, encodedPayload);",
		"\tif (!signature) {",
		"\t\tthrow new Error(\"ASIDE_SESSION_SECRET is required to create an Aside session.\");",
		"\t}",
		"\treturn `${SESSION_COOKIE_NAME}=${encodedPayload}.${signature}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_MAX_AGE_SECONDS}`;",
		"}",
		"",
		"export function clearAsideSessionCookie() {",
		"\treturn `${SESSION_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`;",
		"}",
		"",
		"export function createRandomState() {",
		"\tconst bytes = new Uint8Array(16);",
		"\tcrypto.getRandomValues(bytes);",
		"\treturn base64urlEncodeBytes(bytes);",
		"}",
		"",
		"export function createOAuthStateCookie(state) {",
		"\treturn `${OAUTH_STATE_COOKIE_NAME}=${encodeURIComponent(state)}; HttpOnly; Secure; SameSite=Lax; Path=/_aside/api/auth/google; Max-Age=${OAUTH_STATE_MAX_AGE_SECONDS}`;",
		"}",
		"",
		"export function clearOAuthStateCookie() {",
		"\treturn `${OAUTH_STATE_COOKIE_NAME}=; HttpOnly; Secure; SameSite=Lax; Path=/_aside/api/auth/google; Max-Age=0`;",
		"}",
		"",
		"export function verifyOAuthState(request, state) {",
		"\tconst cookieState = parseCookies(request.headers.get(\"Cookie\") ?? request.headers.get(\"cookie\") ?? \"\")[OAUTH_STATE_COOKIE_NAME];",
		"\treturn typeof state === \"string\" && state.length > 0 && constantTimeEqual(cookieState ?? \"\", state);",
		"}",
		"",
		"export function getGoogleOAuthConfig(request, env = {}) {",
		"\tconst missing = [];",
		"\tconst clientId = typeof env.ASIDE_GOOGLE_CLIENT_ID === \"string\" ? env.ASIDE_GOOGLE_CLIENT_ID.trim() : \"\";",
		"\tconst clientSecret = typeof env.ASIDE_GOOGLE_CLIENT_SECRET === \"string\" ? env.ASIDE_GOOGLE_CLIENT_SECRET.trim() : \"\";",
		"\tconst sessionSecret = getSessionSecret(env);",
		"\tif (!clientId) {",
		"\t\tmissing.push(\"ASIDE_GOOGLE_CLIENT_ID\");",
		"\t}",
		"\tif (!clientSecret) {",
		"\t\tmissing.push(\"ASIDE_GOOGLE_CLIENT_SECRET\");",
		"\t}",
		"\tif (!sessionSecret) {",
		"\t\tmissing.push(\"ASIDE_SESSION_SECRET\");",
		"\t}",
		"\tif (missing.length > 0) {",
		"\t\treturn { ok: false, missing };",
		"\t}",
		"\treturn {",
		"\t\tok: true,",
		"\t\tclientId,",
		"\t\tclientSecret,",
		"\t\tredirectUri: new URL(\"/_aside/api/auth/google/callback\", request.url).toString(),",
		"\t};",
		"}",
		"",
		"export function createGoogleAuthorizationUrl(input) {",
		"\tconst url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);",
		"\turl.searchParams.set(\"client_id\", input.clientId);",
		"\turl.searchParams.set(\"redirect_uri\", input.redirectUri);",
		"\turl.searchParams.set(\"response_type\", \"code\");",
		"\turl.searchParams.set(\"scope\", \"openid email profile\");",
		"\turl.searchParams.set(\"state\", input.state);",
		"\treturn url.toString();",
		"}",
		"",
		"export async function exchangeGoogleAuthorizationCode(config, code) {",
		"\tconst tokenResponse = await globalThis[\"fetch\"](GOOGLE_TOKEN_ENDPOINT, {",
		"\t\tmethod: \"POST\",",
		"\t\theaders: {",
		"\t\t\t\"Content-Type\": \"application/x-www-form-urlencoded\",",
		"\t\t},",
		"\t\tbody: new URLSearchParams({",
		"\t\t\tcode,",
		"\t\t\tclient_id: config.clientId,",
		"\t\t\tclient_secret: config.clientSecret,",
		"\t\t\tredirect_uri: config.redirectUri,",
		"\t\t\tgrant_type: \"authorization_code\",",
		"\t\t}),",
		"\t});",
		"\tif (!tokenResponse.ok) {",
		"\t\tthrow new Error(\"Google OAuth token exchange failed.\");",
		"\t}",
		"\tconst tokenData = await tokenResponse.json();",
		"\tconst accessToken = typeof tokenData.access_token === \"string\" ? tokenData.access_token : \"\";",
		"\tif (!accessToken) {",
		"\t\tthrow new Error(\"Google OAuth token response did not include an access token.\");",
		"\t}",
		"\tconst userInfoResponse = await globalThis[\"fetch\"](GOOGLE_USERINFO_ENDPOINT, {",
		"\t\theaders: {",
		"\t\t\tAuthorization: `Bearer ${accessToken}`,",
		"\t\t},",
		"\t});",
		"\tif (!userInfoResponse.ok) {",
		"\t\tthrow new Error(\"Google userinfo request failed.\");",
		"\t}",
		"\treturn userInfoResponse.json();",
		"}",
		"",
		"export function googleIdentityFromUserInfo(userInfo) {",
		"\tif (!userInfo || typeof userInfo !== \"object\" || userInfo.email_verified !== true || typeof userInfo.email !== \"string\") {",
		"\t\treturn null;",
		"\t}",
		"\treturn normalizeIdentity({",
		"\t\tprovider: \"google\",",
		"\t\tidentifier: userInfo.email,",
		"\t\tname: typeof userInfo.name === \"string\" ? userInfo.name : undefined,",
		"\t\tpicture: typeof userInfo.picture === \"string\" ? userInfo.picture : undefined,",
		"\t});",
		"}",
		"",
		"export function getPublishedCommentsSchemaSql() {",
		"\treturn [",
		"\t\t\"CREATE TABLE IF NOT EXISTS aside_comment_events (\",",
		"\t\t\"event_id TEXT PRIMARY KEY,\",",
		"\t\t\"path TEXT NOT NULL,\",",
		"\t\t\"op TEXT NOT NULL,\",",
		"\t\t\"payload_json TEXT NOT NULL,\",",
		"\t\t\"author_provider TEXT NOT NULL,\",",
		"\t\t\"author_identity TEXT NOT NULL,\",",
		"\t\t\"author_display_name TEXT,\",",
		"\t\t\"created_at TEXT NOT NULL\",",
		"\t\t\");\",",
		"\t\t\"CREATE INDEX IF NOT EXISTS idx_aside_comment_events_path_created ON aside_comment_events (path, created_at, event_id);\",",
		"\t].join(\"\\n\");",
		"}",
		"",
		"export async function getPublishedComments(env, path, seeds = []) {",
		"\tconst normalizedPath = normalizePublishedCommentPath(path);",
		"\tif (!normalizedPath) {",
		"\t\treturn { ok: false, error: \"Comment path is required.\" };",
		"\t}",
		"\tconst seedComments = normalizePublishedCommentSeedsForPath(seeds, normalizedPath);",
		"\tconst db = getPublishedCommentsDatabase(env);",
		"\tif (!db) {",
		"\t\treturn seedComments.length > 0",
		"\t\t\t? { ok: true, comments: seedComments }",
		"\t\t\t: { ok: false, error: \"Aside comments D1 binding ASIDE_COMMENTS_DB is not configured.\" };",
		"\t}",
		"\ttry {",
		"\t\treturn {",
		"\t\t\tok: true,",
		"\t\t\tcomments: seedComments.concat(await getPublishedCommentThreadsForPath(db, normalizedPath)),",
		"\t\t};",
		"\t} catch {",
		"\t\treturn { ok: false, error: \"Aside comments D1 query failed.\" };",
		"\t}",
		"}",
		"",
		"export async function getPublishedCommentEvents(env, cursor = {}) {",
		"\tconst db = getPublishedCommentsDatabase(env);",
		"\tif (!db) {",
		"\t\treturn { ok: false, error: \"Aside comments D1 binding ASIDE_COMMENTS_DB is not configured.\" };",
		"\t}",
		"\tconst afterCreatedAt = typeof cursor?.afterCreatedAt === \"string\" ? cursor.afterCreatedAt.trim() : \"\";",
		"\tconst afterEventId = typeof cursor?.afterEventId === \"string\" ? cursor.afterEventId.trim() : \"\";",
		"\ttry {",
		"\t\tconst result = await db.prepare(\"SELECT event_id, path, op, payload_json, author_provider, author_identity, author_display_name, created_at FROM aside_comment_events WHERE (? = '' OR created_at > ? OR (created_at = ? AND event_id > ?)) ORDER BY created_at ASC, event_id ASC\").bind(",
		"\t\t\tafterCreatedAt,",
		"\t\t\tafterCreatedAt,",
		"\t\t\tafterCreatedAt,",
		"\t\t\tafterEventId,",
		"\t\t).all();",
		"\t\tconst rows = Array.isArray(result?.results) ? result.results : [];",
		"\t\treturn {",
		"\t\t\tok: true,",
		"\t\t\tevents: rows.map(commentRowToPublishedEvent).filter(Boolean),",
		"\t\t};",
		"\t} catch {",
		"\t\treturn { ok: false, error: \"Aside comments D1 query failed.\" };",
		"\t}",
		"}",
		"",
		"export async function createPublishedCommentEvent(env, input) {",
		"\tconst db = getPublishedCommentsDatabase(env);",
		"\tif (!db) {",
		"\t\treturn { ok: false, error: \"Aside comments D1 binding ASIDE_COMMENTS_DB is not configured.\" };",
		"\t}",
		"\tconst normalizedPath = normalizePublishedCommentPath(input?.path);",
		"\tif (!normalizedPath) {",
		"\t\treturn { ok: false, error: \"Comment path is required.\" };",
		"\t}",
		"\tconst body = normalizePublishedCommentBody(input?.body);",
		"\tif (!body) {",
		"\t\treturn { ok: false, error: \"Comment body is required.\" };",
		"\t}",
		"\tconst identity = normalizeIdentity(input?.identity);",
		"\tif (!identity) {",
		"\t\treturn { ok: false, error: \"Comment author identity is required.\" };",
		"\t}",
		"\tconst eventId = typeof input?.eventId === \"string\" && input.eventId.trim() ? input.eventId.trim() : crypto.randomUUID();",
		"\tconst createdAt = typeof input?.createdAt === \"string\" && input.createdAt.trim() ? input.createdAt.trim() : new Date().toISOString();",
		"\tconst row = createPublishedCommentEventRow({",
		"\t\teventId,",
		"\t\tpath: normalizedPath,",
		"\t\top: \"createThread\",",
		"\t\tpayload: { body },",
		"\t\tidentity,",
		"\t\tcreatedAt,",
		"\t});",
		"\tconst insertResult = await insertPublishedCommentEvent(db, row);",
		"\tif (!insertResult.ok) {",
		"\t\treturn insertResult;",
		"\t}",
		"\tconst persistedRow = insertResult.inserted ? row : ((await getPublishedCommentEventRowById(db, eventId)) ?? row);",
		"\tconst comment = commentRowToPublishedComment(persistedRow);",
		"\tif (!comment) {",
		"\t\treturn { ok: false, error: \"Comment event id already exists for a different operation.\" };",
		"\t}",
		"\treturn { ok: true, comment };",
		"}",
		"",
		"export async function appendPublishedCommentReplyEvent(env, input) {",
		"\tconst db = getPublishedCommentsDatabase(env);",
		"\tif (!db) {",
		"\t\treturn { ok: false, error: \"Aside comments D1 binding ASIDE_COMMENTS_DB is not configured.\" };",
		"\t}",
		"\tconst normalizedPath = normalizePublishedCommentPath(input?.path);",
		"\tif (!normalizedPath) {",
		"\t\treturn { ok: false, error: \"Comment path is required.\" };",
		"\t}",
		"\tconst parentId = normalizePublishedCommentId(input?.parentId);",
		"\tif (!parentId) {",
		"\t\treturn { ok: false, error: \"Parent comment id is required.\" };",
		"\t}",
		"\tconst body = normalizePublishedCommentBody(input?.body);",
		"\tif (!body) {",
		"\t\treturn { ok: false, error: \"Comment body is required.\" };",
		"\t}",
		"\tconst identity = normalizeIdentity(input?.identity);",
		"\tif (!identity) {",
		"\t\treturn { ok: false, error: \"Comment author identity is required.\" };",
		"\t}",
		"\tlet comments;",
		"\ttry {",
		"\t\tcomments = await getPublishedCommentThreadsForPath(db, normalizedPath);",
		"\t} catch {",
		"\t\treturn { ok: false, error: \"Aside comments D1 query failed.\" };",
		"\t}",
		"\tconst parent = findPublishedCommentById(comments, parentId);",
		"\tif (!parent || parent.parentId) {",
		"\t\treturn { ok: false, error: \"Parent comment was not found.\" };",
		"\t}",
		"\tconst eventId = typeof input?.eventId === \"string\" && input.eventId.trim() ? input.eventId.trim() : crypto.randomUUID();",
		"\tconst createdAt = typeof input?.createdAt === \"string\" && input.createdAt.trim() ? input.createdAt.trim() : new Date().toISOString();",
		"\tconst row = createPublishedCommentEventRow({",
		"\t\teventId,",
		"\t\tpath: normalizedPath,",
		"\t\top: \"appendReply\",",
		"\t\tpayload: { parentId, body },",
		"\t\tidentity,",
		"\t\tcreatedAt,",
		"\t});",
		"\tconst insertResult = await insertPublishedCommentEvent(db, row);",
		"\tif (!insertResult.ok) {",
		"\t\treturn insertResult;",
		"\t}",
		"\tconst comment = insertResult.inserted",
		"\t\t? commentRowToPublishedComment(row)",
		"\t\t: findPublishedCommentById(await getPublishedCommentThreadsForPath(db, normalizedPath), eventId);",
		"\treturn comment",
		"\t\t? { ok: true, comment }",
		"\t\t: { ok: false, error: \"Comment event id already exists for a different operation.\" };",
		"}",
		"",
		"export async function updatePublishedCommentEvent(env, input) {",
		"\tconst db = getPublishedCommentsDatabase(env);",
		"\tif (!db) {",
		"\t\treturn { ok: false, error: \"Aside comments D1 binding ASIDE_COMMENTS_DB is not configured.\" };",
		"\t}",
		"\tconst normalizedPath = normalizePublishedCommentPath(input?.path);",
		"\tif (!normalizedPath) {",
		"\t\treturn { ok: false, error: \"Comment path is required.\" };",
		"\t}",
		"\tconst targetId = normalizePublishedCommentId(input?.targetId);",
		"\tif (!targetId) {",
		"\t\treturn { ok: false, error: \"Target comment id is required.\" };",
		"\t}",
		"\tconst body = normalizePublishedCommentBody(input?.body);",
		"\tif (!body) {",
		"\t\treturn { ok: false, error: \"Comment body is required.\" };",
		"\t}",
		"\tconst identity = normalizeIdentity(input?.identity);",
		"\tif (!identity) {",
		"\t\treturn { ok: false, error: \"Comment author identity is required.\" };",
		"\t}",
		"\tlet comments;",
		"\ttry {",
		"\t\tcomments = await getPublishedCommentThreadsForPath(db, normalizedPath);",
		"\t} catch {",
		"\t\treturn { ok: false, error: \"Aside comments D1 query failed.\" };",
		"\t}",
		"\tconst target = findPublishedCommentById(comments, targetId);",
		"\tif (!target) {",
		"\t\treturn { ok: false, error: \"Target comment was not found.\" };",
		"\t}",
		"\tif (!isSamePublishedAuthor(identity, target.author)) {",
		"\t\treturn { ok: false, error: \"Only the original author can modify this comment.\" };",
		"\t}",
		"\tconst eventId = typeof input?.eventId === \"string\" && input.eventId.trim() ? input.eventId.trim() : crypto.randomUUID();",
		"\tconst createdAt = typeof input?.createdAt === \"string\" && input.createdAt.trim() ? input.createdAt.trim() : new Date().toISOString();",
		"\tconst row = createPublishedCommentEventRow({",
		"\t\teventId,",
		"\t\tpath: normalizedPath,",
		"\t\top: \"update\",",
		"\t\tpayload: { targetId, body },",
		"\t\tidentity,",
		"\t\tcreatedAt,",
		"\t});",
		"\tconst insertResult = await insertPublishedCommentEvent(db, row);",
		"\tif (!insertResult.ok) {",
		"\t\treturn insertResult;",
		"\t}",
		"\tconst comment = insertResult.inserted",
		"\t\t? { ...target, body, updatedAt: createdAt }",
		"\t\t: findPublishedCommentById(await getPublishedCommentThreadsForPath(db, normalizedPath), targetId);",
		"\treturn comment",
		"\t\t? { ok: true, comment }",
		"\t\t: { ok: false, error: \"Target comment was not found.\" };",
		"}",
		"",
		"export async function deletePublishedCommentEvent(env, input) {",
		"\tconst db = getPublishedCommentsDatabase(env);",
		"\tif (!db) {",
		"\t\treturn { ok: false, error: \"Aside comments D1 binding ASIDE_COMMENTS_DB is not configured.\" };",
		"\t}",
		"\tconst normalizedPath = normalizePublishedCommentPath(input?.path);",
		"\tif (!normalizedPath) {",
		"\t\treturn { ok: false, error: \"Comment path is required.\" };",
		"\t}",
		"\tconst targetId = normalizePublishedCommentId(input?.targetId);",
		"\tif (!targetId) {",
		"\t\treturn { ok: false, error: \"Target comment id is required.\" };",
		"\t}",
		"\tconst identity = normalizeIdentity(input?.identity);",
		"\tif (!identity) {",
		"\t\treturn { ok: false, error: \"Comment author identity is required.\" };",
		"\t}",
		"\tlet comments;",
		"\ttry {",
		"\t\tcomments = await getPublishedCommentThreadsForPath(db, normalizedPath);",
		"\t} catch {",
		"\t\treturn { ok: false, error: \"Aside comments D1 query failed.\" };",
		"\t}",
		"\tconst target = findPublishedCommentById(comments, targetId);",
		"\tif (!target) {",
		"\t\treturn { ok: false, error: \"Target comment was not found.\" };",
		"\t}",
		"\tif (!isSamePublishedAuthor(identity, target.author)) {",
		"\t\treturn { ok: false, error: \"Only the original author can modify this comment.\" };",
		"\t}",
		"\tconst eventId = typeof input?.eventId === \"string\" && input.eventId.trim() ? input.eventId.trim() : crypto.randomUUID();",
		"\tconst createdAt = typeof input?.createdAt === \"string\" && input.createdAt.trim() ? input.createdAt.trim() : new Date().toISOString();",
		"\tconst row = createPublishedCommentEventRow({",
		"\t\teventId,",
		"\t\tpath: normalizedPath,",
		"\t\top: \"delete\",",
		"\t\tpayload: { targetId },",
		"\t\tidentity,",
		"\t\tcreatedAt,",
		"\t});",
		"\tconst insertResult = await insertPublishedCommentEvent(db, row);",
		"\tif (!insertResult.ok) {",
		"\t\treturn insertResult;",
		"\t}",
		"\treturn { ok: true, deletedCommentId: targetId };",
		"}",
		"",
		"function createPublishedCommentEventRow(input) {",
		"\treturn {",
		"\t\tevent_id: input.eventId,",
		"\t\tpath: input.path,",
		"\t\top: input.op,",
		"\t\tpayload_json: JSON.stringify(input.payload),",
		"\t\tauthor_provider: input.identity.provider,",
		"\t\tauthor_identity: input.identity.identifier,",
		"\t\tauthor_display_name: input.identity.name ?? null,",
		"\t\tcreated_at: input.createdAt,",
		"\t};",
		"}",
		"",
		"async function insertPublishedCommentEvent(db, row) {",
		"\ttry {",
		"\t\tconst result = await db.prepare(\"INSERT OR IGNORE INTO aside_comment_events (event_id, path, op, payload_json, author_provider, author_identity, author_display_name, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)\").bind(",
		"\t\t\trow.event_id,",
		"\t\t\trow.path,",
		"\t\t\trow.op,",
		"\t\t\trow.payload_json,",
		"\t\t\trow.author_provider,",
		"\t\t\trow.author_identity,",
		"\t\t\trow.author_display_name,",
		"\t\t\trow.created_at,",
		"\t\t).run();",
		"\t\treturn { ok: true, inserted: result?.meta?.changes !== 0 };",
		"\t} catch {",
		"\t\treturn { ok: false, error: \"Aside comments D1 insert failed.\" };",
		"\t}",
		"}",
		"",
		"async function getPublishedCommentEventRowById(db, eventId) {",
		"\ttry {",
		"\t\treturn await db.prepare(\"SELECT event_id, path, op, payload_json, author_provider, author_identity, author_display_name, created_at FROM aside_comment_events WHERE event_id = ?\").bind(eventId).first();",
		"\t} catch {",
		"\t\treturn null;",
		"\t}",
		"}",
		"",
		"async function getPublishedCommentThreadsForPath(db, path) {",
		"\tconst result = await db.prepare(\"SELECT event_id, path, op, payload_json, author_provider, author_identity, author_display_name, created_at FROM aside_comment_events WHERE path = ? ORDER BY created_at ASC, event_id ASC\").bind(path).all();",
		"\treturn buildPublishedCommentThreads(Array.isArray(result?.results) ? result.results : []);",
		"}",
		"",
		"function commentRowToPublishedEvent(row) {",
		"\tif (!row || typeof row !== \"object\") {",
		"\t\treturn null;",
		"\t}",
		"\tif (typeof row.event_id !== \"string\" || typeof row.path !== \"string\" || typeof row.op !== \"string\" || typeof row.created_at !== \"string\") {",
		"\t\treturn null;",
		"\t}",
		"\tconst payload = parseJsonObject(row.payload_json);",
		"\tif (!payload) {",
		"\t\treturn null;",
		"\t}",
		"\tconst provider = typeof row.author_provider === \"string\" ? row.author_provider : \"\";",
		"\tconst identity = typeof row.author_identity === \"string\" ? row.author_identity : \"\";",
		"\tif (!provider || !identity) {",
		"\t\treturn null;",
		"\t}",
		"\treturn {",
		"\t\teventId: row.event_id,",
		"\t\tpath: row.path,",
		"\t\top: row.op,",
		"\t\tpayload,",
		"\t\tauthor: {",
		"\t\t\tprovider,",
		"\t\t\tidentity,",
		"\t\t\t...(typeof row.author_display_name === \"string\" && row.author_display_name.trim() ? { displayName: row.author_display_name.trim() } : {}),",
		"\t\t},",
		"\t\tcreatedAt: row.created_at,",
		"\t};",
		"}",
		"",
		"function normalizePublishedCommentSeedsForPath(seeds, path) {",
		"\treturn (Array.isArray(seeds) ? seeds : [])",
		"\t\t.map((seed) => normalizePublishedCommentSeed(seed, path))",
		"\t\t.filter(Boolean);",
		"}",
		"",
		"function normalizePublishedCommentSeed(seed, path) {",
		"\tif (!seed || typeof seed !== \"object\" || seed.path !== path) {",
		"\t\treturn null;",
		"\t}",
		"\tif (typeof seed.id !== \"string\" || typeof seed.body !== \"string\" || typeof seed.createdAt !== \"string\") {",
		"\t\treturn null;",
		"\t}",
		"\tconst author = normalizePublishedCommentSeedAuthor(seed.author);",
		"\treturn {",
		"\t\tid: seed.id,",
		"\t\tpath,",
		"\t\tbody: seed.body,",
		"\t\tcreatedAt: seed.createdAt,",
		"\t\t...(author ? { author } : {}),",
		"\t\treadOnly: true,",
		"\t\treplies: [],",
		"\t};",
		"}",
		"",
		"function normalizePublishedCommentSeedAuthor(author) {",
		"\tif (!author || typeof author !== \"object\") {",
		"\t\treturn null;",
		"\t}",
		"\tconst provider = typeof author.provider === \"string\" ? author.provider : \"\";",
		"\tconst identity = typeof author.identity === \"string\" ? author.identity : \"\";",
		"\tif (!provider || !identity) {",
		"\t\treturn null;",
		"\t}",
		"\treturn {",
		"\t\tprovider,",
		"\t\tidentity,",
		"\t\t...(typeof author.displayName === \"string\" && author.displayName.trim() ? { displayName: author.displayName.trim() } : {}),",
		"\t};",
		"}",
		"",
		"export function filterPrivatePublishManifestForIdentity(manifest, identity) {",
		"\tconst normalizedIdentity = normalizeIdentity(identity);",
		"\tconst permissionRules = Array.isArray(manifest.permissionRules) ? manifest.permissionRules : [];",
		"\tconst files = (Array.isArray(manifest.files) ? manifest.files : [])",
		"\t\t.map((file) => {",
		"\t\t\tconst permission = resolvePrivatePublishPermission(permissionRules, normalizedIdentity, file.publicPath);",
		"\t\t\treturn permission.canView ? { ...file, permission } : null;",
		"\t\t})",
		"\t\t.filter(Boolean);",
		"\treturn {",
		"\t\tversion: manifest.version,",
		"\t\tgeneratedAt: manifest.generatedAt,",
		"\t\tbaseUrl: manifest.baseUrl,",
		"\t\tauthenticated: Boolean(normalizedIdentity),",
		"\t\tidentity: normalizedIdentity,",
		"\t\tproviders: Array.isArray(manifest.providers) ? manifest.providers : [],",
		"\t\tunsupportedProviders: Array.isArray(manifest.unsupportedProviders) ? manifest.unsupportedProviders : [],",
		"\t\tfiles,",
		"\t\ttree: buildManifestTree(files),",
		"\t};",
		"}",
		"",
		"export function resolvePrivatePublishPermission(rules, identity, requestedPath) {",
		"\tif (!identity || typeof requestedPath !== \"string\" || requestedPath.length === 0) {",
		"\t\treturn createDeniedPermission();",
		"\t}",
		"\tlet winningRule;",
		"\tlet winningSpecificity = -1;",
		"\tfor (const rule of Array.isArray(rules) ? rules : []) {",
		"\t\tif (rule.provider !== identity.provider || rule.identifier !== identity.identifier) {",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\tconst match = matchRulePath(rule.path, requestedPath);",
		"\t\tif (!match.ok) {",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\tif (",
		"\t\t\tmatch.specificity > winningSpecificity",
		"\t\t\t|| (match.specificity === winningSpecificity && accessRanks[rule.access] >= accessRanks[winningRule?.access ?? \"view\"])",
		"\t\t) {",
		"\t\t\twinningRule = rule;",
		"\t\t\twinningSpecificity = match.specificity;",
		"\t\t}",
		"\t}",
		"\treturn permissionForRule(winningRule);",
		"}",
		"",
		"function normalizeIdentity(identity) {",
		"\tif (!identity || typeof identity !== \"object\") {",
		"\t\treturn null;",
		"\t}",
		"\tconst provider = identity.provider;",
		"\tconst identifier = typeof identity.identifier === \"string\" ? identity.identifier.trim() : \"\";",
		"\tif ((provider !== \"google\" && provider !== \"wechat\") || identifier.length === 0) {",
		"\t\treturn null;",
		"\t}",
		"\treturn {",
		"\t\tprovider,",
		"\t\tidentifier: provider === \"google\" ? identifier.toLowerCase() : identifier,",
		"\t\t...(typeof identity.name === \"string\" && identity.name.trim() ? { name: identity.name.trim() } : {}),",
		"\t\t...(typeof identity.picture === \"string\" && identity.picture.trim() ? { picture: identity.picture.trim() } : {}),",
		"\t};",
		"}",
		"",
		"async function verifyAsideSessionCookie(env, value, nowSeconds) {",
		"\tconst parts = value.split(\".\");",
		"\tif (parts.length !== 2 || !parts[0] || !parts[1]) {",
		"\t\treturn null;",
		"\t}",
		"\tconst expectedSignature = await signSessionValue(env, parts[0]);",
		"\tif (!expectedSignature || !constantTimeEqual(expectedSignature, parts[1])) {",
		"\t\treturn null;",
		"\t}",
		"\tconst payload = base64urlDecodeJson(parts[0]);",
		"\tif (!payload || typeof payload.exp !== \"number\" || payload.exp < nowSeconds) {",
		"\t\treturn null;",
		"\t}",
		"\treturn normalizeIdentity(payload);",
		"}",
		"",
		"async function signSessionValue(env, value) {",
		"\tconst secret = getSessionSecret(env);",
		"\tif (!secret) {",
		"\t\treturn null;",
		"\t}",
		"\tconst key = await crypto.subtle.importKey(",
		"\t\t\"raw\",",
		"\t\tnew TextEncoder().encode(secret),",
		"\t\t{ name: \"HMAC\", hash: \"SHA-256\" },",
		"\t\tfalse,",
		"\t\t[\"sign\"],",
		"\t);",
		"\tconst signature = await crypto.subtle.sign(\"HMAC\", key, new TextEncoder().encode(value));",
		"\treturn base64urlEncodeBytes(new Uint8Array(signature));",
		"}",
		"",
		"function getSessionSecret(env) {",
		"\tconst secret = env?.ASIDE_SESSION_SECRET;",
		"\treturn typeof secret === \"string\" && secret.trim() ? secret.trim() : \"\";",
		"}",
		"",
		"function getPublishedCommentsDatabase(env) {",
		"\tconst db = env?.ASIDE_COMMENTS_DB;",
		"\treturn db && typeof db.prepare === \"function\" ? db : null;",
		"}",
		"",
		"function normalizePublishedCommentPath(path) {",
		"\tif (typeof path !== \"string\") {",
		"\t\treturn \"\";",
		"\t}",
		"\treturn path.trim().replace(/^\\/+/, \"\");",
		"}",
		"",
		"function normalizePublishedCommentBody(body) {",
		"\tif (typeof body !== \"string\") {",
		"\t\treturn \"\";",
		"\t}",
		"\treturn body.trim().slice(0, 4000);",
		"}",
		"",
		"function normalizePublishedCommentId(id) {",
		"\treturn typeof id === \"string\" && id.trim() ? id.trim() : \"\";",
		"}",
		"",
		"function commentRowToPublishedComment(row) {",
		"\tif (!row || typeof row !== \"object\" || (row.op !== \"createThread\" && row.op !== \"appendReply\")) {",
		"\t\treturn null;",
		"\t}",
		"\tconst payload = parseJsonObject(row.payload_json);",
		"\tconst body = typeof payload?.body === \"string\" ? payload.body : \"\";",
		"\tif (!body || typeof row.event_id !== \"string\" || typeof row.path !== \"string\" || typeof row.created_at !== \"string\") {",
		"\t\treturn null;",
		"\t}",
		"\tconst parentId = row.op === \"appendReply\" ? normalizePublishedCommentId(payload?.parentId) : \"\";",
		"\tif (row.op === \"appendReply\" && !parentId) {",
		"\t\treturn null;",
		"\t}",
		"\tconst provider = row.author_provider;",
		"\tconst identity = typeof row.author_identity === \"string\" ? row.author_identity : \"\";",
		"\treturn {",
		"\t\tid: row.event_id,",
		"\t\t...(parentId ? { parentId } : {}),",
		"\t\tpath: row.path,",
		"\t\tbody,",
		"\t\tcreatedAt: row.created_at,",
		"\t\tauthor: {",
		"\t\t\tprovider,",
		"\t\t\tidentity,",
		"\t\t\t...(typeof row.author_display_name === \"string\" && row.author_display_name.trim() ? { displayName: row.author_display_name.trim() } : {}),",
		"\t\t},",
		"\t\treplies: [],",
		"\t};",
		"}",
		"",
		"function buildPublishedCommentThreads(rows) {",
		"\tconst commentsById = new Map();",
		"\tconst commentOrder = [];",
		"\tconst deletedIds = new Set();",
		"\tfor (const row of rows) {",
		"\t\tif (!row || typeof row !== \"object\") {",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\tif (row.op === \"createThread\" || row.op === \"appendReply\") {",
		"\t\t\tconst comment = commentRowToPublishedComment(row);",
		"\t\t\tif (comment && !commentsById.has(comment.id)) {",
		"\t\t\t\tcommentsById.set(comment.id, comment);",
		"\t\t\t\tcommentOrder.push(comment.id);",
		"\t\t\t}",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\tconst payload = parseJsonObject(row.payload_json);",
		"\t\tconst targetId = normalizePublishedCommentId(payload?.targetId);",
		"\t\tconst target = targetId ? commentsById.get(targetId) : null;",
		"\t\tif (!target || !isSamePublishedAuthor(rowToPublishedIdentity(row), target.author)) {",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\tif (row.op === \"update\") {",
		"\t\t\tconst body = normalizePublishedCommentBody(payload?.body);",
		"\t\t\tif (body && typeof row.created_at === \"string\") {",
		"\t\t\t\ttarget.body = body;",
		"\t\t\t\ttarget.updatedAt = row.created_at;",
		"\t\t\t}",
		"\t\t} else if (row.op === \"delete\") {",
		"\t\t\tdeletedIds.add(targetId);",
		"\t\t}",
		"\t}",
		"\tfor (const id of deletedIds) {",
		"\t\tcommentsById.delete(id);",
		"\t}",
		"\tfor (const comment of commentsById.values()) {",
		"\t\tcomment.replies = [];",
		"\t}",
		"\tconst roots = [];",
		"\tfor (const id of commentOrder) {",
		"\t\tconst comment = commentsById.get(id);",
		"\t\tif (!comment) {",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\tif (comment.parentId) {",
		"\t\t\tconst parent = commentsById.get(comment.parentId);",
		"\t\t\tif (parent && !parent.parentId) {",
		"\t\t\t\tparent.replies.push(comment);",
		"\t\t\t}",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\troots.push(comment);",
		"\t}",
		"\treturn roots;",
		"}",
		"",
		"function findPublishedCommentById(comments, id) {",
		"\tconst targetId = normalizePublishedCommentId(id);",
		"\tif (!targetId) {",
		"\t\treturn null;",
		"\t}",
		"\tfor (const comment of Array.isArray(comments) ? comments : []) {",
		"\t\tif (comment.id === targetId) {",
		"\t\t\treturn comment;",
		"\t\t}",
		"\t\tconst reply = findPublishedCommentById(comment.replies, targetId);",
		"\t\tif (reply) {",
		"\t\t\treturn reply;",
		"\t\t}",
		"\t}",
		"\treturn null;",
		"}",
		"",
		"function rowToPublishedIdentity(row) {",
		"\treturn {",
		"\t\tprovider: row?.author_provider,",
		"\t\tidentity: typeof row?.author_identity === \"string\" ? row.author_identity : \"\",",
		"\t};",
		"}",
		"",
		"function isSamePublishedAuthor(identity, author) {",
		"\tif (!identity || !author) {",
		"\t\treturn false;",
		"\t}",
		"\tconst identifier = typeof identity.identifier === \"string\" ? identity.identifier : identity.identity;",
		"\treturn identity.provider === author.provider && identifier === author.identity;",
		"}",
		"",
		"function parseJsonObject(value) {",
		"\ttry {",
		"\t\tconst parsed = JSON.parse(String(value ?? \"\"));",
		"\t\treturn parsed && typeof parsed === \"object\" ? parsed : null;",
		"\t} catch {",
		"\t\treturn null;",
		"\t}",
		"}",
		"",
		"function parseCookies(header) {",
		"\tconst cookies = {};",
		"\tfor (const part of String(header ?? \"\").split(\";\")) {",
		"\t\tconst separatorIndex = part.indexOf(\"=\");",
		"\t\tif (separatorIndex < 0) {",
		"\t\t\tcontinue;",
		"\t\t}",
		"\t\tconst name = part.slice(0, separatorIndex).trim();",
		"\t\tconst value = part.slice(separatorIndex + 1).trim();",
		"\t\tif (name) {",
		"\t\t\ttry {",
		"\t\t\t\tcookies[name] = decodeURIComponent(value);",
		"\t\t\t} catch {",
		"\t\t\t\tcookies[name] = value;",
		"\t\t\t}",
		"\t\t}",
		"\t}",
		"\treturn cookies;",
		"}",
		"",
		"function base64urlEncodeJson(value) {",
		"\treturn base64urlEncodeBytes(new TextEncoder().encode(JSON.stringify(value)));",
		"}",
		"",
		"function base64urlDecodeJson(value) {",
		"\ttry {",
		"\t\tconst json = new TextDecoder().decode(base64urlDecodeBytes(value));",
		"\t\treturn JSON.parse(json);",
		"\t} catch {",
		"\t\treturn null;",
		"\t}",
		"}",
		"",
		"function base64urlEncodeBytes(bytes) {",
		"\tlet binary = \"\";",
		"\tfor (const byte of bytes) {",
		"\t\tbinary += String.fromCharCode(byte);",
		"\t}",
		"\treturn btoa(binary).replace(/\\+/gu, \"-\").replace(/\\//gu, \"_\").replace(/=+$/u, \"\");",
		"}",
		"",
		"function base64urlDecodeBytes(value) {",
		"\tconst padded = value.replace(/-/gu, \"+\").replace(/_/gu, \"/\").padEnd(Math.ceil(value.length / 4) * 4, \"=\");",
		"\tconst binary = atob(padded);",
		"\tconst bytes = new Uint8Array(binary.length);",
		"\tfor (let index = 0; index < binary.length; index += 1) {",
		"\t\tbytes[index] = binary.charCodeAt(index);",
		"\t}",
		"\treturn bytes;",
		"}",
		"",
		"function constantTimeEqual(left, right) {",
		"\tif (typeof left !== \"string\" || typeof right !== \"string\" || left.length !== right.length) {",
		"\t\treturn false;",
		"\t}",
		"\tlet diff = 0;",
		"\tfor (let index = 0; index < left.length; index += 1) {",
		"\t\tdiff |= left.charCodeAt(index) ^ right.charCodeAt(index);",
		"\t}",
		"\treturn diff === 0;",
		"}",
		"",
		"function matchRulePath(rulePath, requestedPath) {",
		"\tif (rulePath === \"/\") {",
		"\t\treturn { ok: true, specificity: 0 };",
		"\t}",
		"\tif (typeof rulePath !== \"string\" || typeof requestedPath !== \"string\") {",
		"\t\treturn { ok: false, specificity: -1 };",
		"\t}",
		"\tif (rulePath.endsWith(\"/\")) {",
		"\t\tconst folderPath = rulePath.slice(0, -1);",
		"\t\treturn {",
		"\t\t\tok: requestedPath === folderPath || requestedPath.startsWith(`${folderPath}/`),",
		"\t\t\tspecificity: folderPath.length,",
		"\t\t};",
		"\t}",
		"\treturn {",
		"\t\tok: requestedPath === rulePath,",
		"\t\tspecificity: rulePath.length,",
		"\t};",
		"}",
		"",
		"function permissionForRule(rule) {",
		"\tif (!rule) {",
		"\t\treturn createDeniedPermission();",
		"\t}",
		"\treturn {",
		"\t\tcanView: true,",
		"\t\tcanComment: rule.access === \"comment\" || rule.access === \"full\",",
		"\t\tcanManage: rule.access === \"full\",",
		"\t};",
		"}",
		"",
		"function createDeniedPermission() {",
		"\treturn {",
		"\t\tcanView: false,",
		"\t\tcanComment: false,",
		"\t\tcanManage: false,",
		"\t};",
		"}",
		"",
		"function buildManifestTree(files) {",
		"\tconst root = {",
		"\t\tname: \"\",",
		"\t\tpath: \"/\",",
		"\t\ttype: \"folder\",",
		"\t\tchildren: [],",
		"\t};",
		"\tconst foldersByPath = new Map([[\"/\", root]]);",
		"\tfor (const file of files) {",
		"\t\tconst segments = String(file.publicPath ?? \"\").split(\"/\").filter(Boolean);",
		"\t\tlet current = root;",
		"\t\tlet currentPath = \"\";",
		"\t\tfor (const segment of segments.slice(0, -1)) {",
		"\t\t\tcurrentPath = `${currentPath}${segment}/`;",
		"\t\t\tlet folder = foldersByPath.get(currentPath);",
		"\t\t\tif (!folder) {",
		"\t\t\t\tfolder = {",
		"\t\t\t\t\tname: segment,",
		"\t\t\t\t\tpath: currentPath,",
		"\t\t\t\t\ttype: \"folder\",",
		"\t\t\t\t\tchildren: [],",
		"\t\t\t\t};",
		"\t\t\t\tfoldersByPath.set(currentPath, folder);",
		"\t\t\t\tcurrent.children.push(folder);",
		"\t\t\t}",
		"\t\t\tcurrent = folder;",
		"\t\t}",
		"\t\tconst fileName = segments.at(-1);",
		"\t\tif (fileName) {",
		"\t\t\tcurrent.children.push({",
		"\t\t\t\tname: fileName,",
		"\t\t\t\tpath: file.publicPath,",
		"\t\t\t\ttype: \"file\",",
		"\t\t\t\tkind: file.kind,",
		"\t\t\t});",
		"\t\t}",
		"\t}",
		"\tsortManifestTree(root);",
		"\treturn root;",
		"}",
		"",
		"function sortManifestTree(folder) {",
		"\tfolder.children.sort((left, right) => typeRank(left.type) - typeRank(right.type) || left.name.localeCompare(right.name));",
		"\tfor (const child of folder.children) {",
		"\t\tif (child.type === \"folder\") {",
		"\t\t\tsortManifestTree(child);",
		"\t\t}",
		"\t}",
		"}",
		"",
		"function typeRank(type) {",
		"\treturn type === \"folder\" ? 0 : 1;",
		"}",
		"",
	].join("\n");
}

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
		}],
		functions: [{
			projectRelativePath: "functions/_middleware.js",
			contents: renderMiddleware(),
		}, {
			projectRelativePath: "functions/_aside/api/auth/session.js",
			contents: renderAuthSessionRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/site-manifest.js",
			contents: renderSiteManifestRoute(),
		}, {
			projectRelativePath: "functions/_aside/api/comments/index.js",
			contents: renderCommentsRoute(),
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
		"",
		"export async function onRequest(context) {",
		"\tconst url = new URL(context.request.url);",
		"\tif (url.pathname === privatePublishManifest.controlPaths.auth) {",
		"\t\treturn new Response(\"Not Found\", { status: 404 });",
		"\t}",
		"\tvoid privatePublishManifest;",
		"\treturn context.next();",
		"}",
		"",
	].join("\n");
}

function renderAuthSessionRoute(): string {
	return [
		"import { privatePublishManifest } from \"../../../../src/_aside/private-publish-data.js\";",
		"import { getAsideSessionIdentity } from \"../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export function onRequestGet(context) {",
		"\tconst identity = getAsideSessionIdentity(context.request);",
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

function renderSiteManifestRoute(): string {
	return [
		"import { privatePublishManifest } from \"../../../../src/_aside/private-publish-data.js\";",
		"import { filterPrivatePublishManifestForIdentity, getAsideSessionIdentity } from \"../../../../src/_aside/private-publish-runtime.js\";",
		"",
		"export function onRequestGet(context) {",
		"\tconst identity = getAsideSessionIdentity(context.request);",
		"\treturn Response.json(filterPrivatePublishManifestForIdentity(privatePublishManifest, identity));",
		"}",
		"",
	].join("\n");
}

function renderCommentsRoute(): string {
	return [
		"export function onRequestGet() {",
		"\treturn Response.json({ comments: [] });",
		"}",
		"",
		"export function onRequestPost() {",
		"\treturn Response.json({ error: \"Comments require the private publish comment API.\" }, { status: 501 });",
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
		"",
		"export function getAsideSessionIdentity(request) {",
		"\tvoid request;",
		"\treturn null;",
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
		"\t};",
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

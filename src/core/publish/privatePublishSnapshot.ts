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
			projectRelativePath: "functions/_aside/api/comments/index.js",
			contents: renderCommentsRoute(),
		}],
		privateModules: [{
			projectRelativePath: "src/_aside/private-publish-data.js",
			contents: renderPrivatePublishDataModule(manifest),
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
		"",
		"export function onRequestGet() {",
		"\treturn Response.json({",
		"\t\tauthenticated: false,",
		"\t\tproviders: privatePublishManifest.providers,",
		"\t\tunsupportedProviders: privatePublishManifest.unsupportedProviders,",
		"\t});",
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

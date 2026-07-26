import {
	normalizeVaultRelativePublishPath,
} from "./publishPath";
import {
	normalizePublishAllowedRoot,
} from "./publishSettings";

export type PrivatePublishSelectionResult =
	| { ok: true; rootPath: string; rootKind: "file" | "folder"; paths: string[] }
	| { ok: false; notice: string };

export interface SelectPrivatePublishPathsOptions {
	targetPath: string;
	allFilePaths: readonly string[];
	allowedRoot: string;
}

const SUPPORTED_EXTENSIONS = new Set([".md", ".html", ".htm", ".pdf"]);
const ROOT_CONTROL_FILE_NAMES = new Set(["index.md", "auth.md"]);
const FALLBACK_ALLOWED_ROOT = "public/";

function normalizeAllowedRoot(value: string): string {
	const normalizedRoot = normalizeVaultRelativePublishPath(normalizePublishAllowedRoot(value));
	return normalizedRoot.ok ? `${normalizedRoot.path}/` : FALLBACK_ALLOWED_ROOT;
}

function isInsideAllowedRoot(path: string, allowedRoot: string): boolean {
	return path === allowedRoot.slice(0, -1) || path.startsWith(allowedRoot);
}

function outsideRootNotice(allowedRoot: string): PrivatePublishSelectionResult {
	return {
		ok: false,
		notice: `Private publish target must be inside ${allowedRoot}.`,
	};
}

function normalizeKnownFilePaths(allFilePaths: readonly string[], allowedRoot: string): Set<string> {
	const paths = new Set<string>();
	for (const filePath of allFilePaths) {
		const normalized = normalizeVaultRelativePublishPath(filePath);
		if (normalized.ok && isInsideAllowedRoot(normalized.path, allowedRoot)) {
			paths.add(normalized.path);
		}
	}
	return paths;
}

function hasSupportedExtension(path: string): boolean {
	const fileName = path.split("/").pop() ?? "";
	const lastDotIndex = fileName.lastIndexOf(".");
	return lastDotIndex >= 0 && SUPPORTED_EXTENSIONS.has(fileName.slice(lastDotIndex).toLowerCase());
}

function isRootControlFile(path: string, allowedRoot: string): boolean {
	if (!path.startsWith(allowedRoot)) {
		return false;
	}
	const relativePath = path.slice(allowedRoot.length);
	return !relativePath.includes("/") && ROOT_CONTROL_FILE_NAMES.has(relativePath.toLowerCase());
}

function isPublishablePath(path: string, allowedRoot: string): boolean {
	return hasSupportedExtension(path) && !isRootControlFile(path, allowedRoot);
}

export function selectPrivatePublishPaths(options: SelectPrivatePublishPathsOptions): PrivatePublishSelectionResult {
	const allowedRoot = normalizeAllowedRoot(options.allowedRoot);
	const normalizedTarget = normalizeVaultRelativePublishPath(options.targetPath);
	if (!normalizedTarget.ok || !isInsideAllowedRoot(normalizedTarget.path, allowedRoot)) {
		return outsideRootNotice(allowedRoot);
	}

	const allowedRootPath = allowedRoot.slice(0, -1);
	const knownFilePaths = normalizeKnownFilePaths(options.allFilePaths, allowedRoot);
	if (normalizedTarget.path !== allowedRootPath && knownFilePaths.has(normalizedTarget.path)) {
		return {
			ok: true,
			rootPath: normalizedTarget.path,
			rootKind: "file",
			paths: isPublishablePath(normalizedTarget.path, allowedRoot) ? [normalizedTarget.path] : [],
		};
	}

	const rootPath = normalizedTarget.path === allowedRootPath
		? allowedRoot
		: `${normalizedTarget.path}/`;
	const paths = [...knownFilePaths]
		.filter((filePath) => filePath.startsWith(rootPath) && isPublishablePath(filePath, allowedRoot))
		.sort();
	return {
		ok: true,
		rootPath,
		rootKind: "folder",
		paths,
	};
}

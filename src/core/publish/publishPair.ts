import {
	normalizeVaultRelativePublishPath,
} from "./publishPath";
import {
	normalizePublishAllowedRoot,
} from "./publishSettings";

export type PublicHtmlPairResolution =
	| {
		ok: true;
		sourcePath: string;
		htmlPath: string;
	}
	| {
		ok: false;
		notice: string;
	};

export interface PublicHtmlPairContext {
	sourcePath: string;
	htmlPath: string;
	displayPath: string;
	paths: [string, string];
}

export interface ResolvePublicHtmlPairForHtmlOptions {
	htmlPath: string;
	allowedRoot: string;
}

export interface ResolvePublicHtmlPairForSourceOptions {
	sourcePath: string;
	frontmatterHtmlPath: string | null;
	allowedRoot: string;
}

function isMarkdownPath(path: string): boolean {
	return /\.md$/iu.test(path);
}

function isHtmlPath(path: string): boolean {
	return /\.html?$/iu.test(path);
}

function replaceExtension(path: string, extension: string): string {
	return path.replace(/\.[^/.]+$/u, extension);
}

const LANGUAGE_ARTIFACT_SUFFIXES = new Set([
	"ar",
	"de",
	"en",
	"es",
	"fr",
	"hi",
	"id",
	"it",
	"ja",
	"ko",
	"nl",
	"pt",
	"ru",
	"th",
	"vi",
	"zh",
	"zh-cn",
	"zh-tw",
]);

function inferSourcePathForHtmlPath(htmlPath: string): string {
	const stemPath = replaceExtension(htmlPath, "");
	const dotIndex = stemPath.lastIndexOf(".");
	if (dotIndex !== -1) {
		const suffix = stemPath.slice(dotIndex + 1).toLowerCase();
		if (LANGUAGE_ARTIFACT_SUFFIXES.has(suffix)) {
			return `${stemPath.slice(0, dotIndex)}.md`;
		}
	}
	return `${stemPath}.md`;
}

function normalizeRelativePath(value: string): string | null {
	const normalized = normalizeVaultRelativePublishPath(value);
	return normalized.ok ? normalized.path : null;
}

function isInsideAllowedRoot(path: string, allowedRoot: string): boolean {
	const normalizedRoot = normalizePublishAllowedRoot(allowedRoot);
	return path.startsWith(normalizedRoot);
}

export function resolvePublicHtmlPairForHtml(
	options: ResolvePublicHtmlPairForHtmlOptions,
): PublicHtmlPairResolution {
	const htmlPath = normalizeRelativePath(options.htmlPath);
	if (!htmlPath) {
		return {
			ok: false,
			notice: "Publish artifact path must stay inside the vault.",
		};
	}
	if (!isHtmlPath(htmlPath)) {
		return {
			ok: false,
			notice: "Publish artifact must be an HTML file.",
		};
	}
	if (!isInsideAllowedRoot(htmlPath, options.allowedRoot)) {
		return {
			ok: false,
			notice: `Publish file must be inside ${normalizePublishAllowedRoot(options.allowedRoot)}.`,
		};
	}
	return {
		ok: true,
		sourcePath: inferSourcePathForHtmlPath(htmlPath),
		htmlPath,
	};
}

export function resolvePublicHtmlPairForSource(
	options: ResolvePublicHtmlPairForSourceOptions,
): PublicHtmlPairResolution {
	const sourcePath = normalizeRelativePath(options.sourcePath);
	if (!sourcePath) {
		return {
			ok: false,
			notice: "Publish control path must stay inside the vault.",
		};
	}
	if (!isMarkdownPath(sourcePath)) {
		return {
			ok: false,
			notice: "Publish control file must be a Markdown file.",
		};
	}
	if (!isInsideAllowedRoot(sourcePath, options.allowedRoot)) {
		return {
			ok: false,
			notice: `Publish control file must be inside ${normalizePublishAllowedRoot(options.allowedRoot)}.`,
		};
	}

	const htmlPath = normalizeRelativePath(options.frontmatterHtmlPath ?? replaceExtension(sourcePath, ".html"));
	if (!htmlPath) {
		return {
			ok: false,
			notice: "Paired HTML path must stay inside the vault.",
		};
	}
	if (!isHtmlPath(htmlPath)) {
		return {
			ok: false,
			notice: "Paired HTML file must be an HTML file.",
		};
	}
	if (!isInsideAllowedRoot(htmlPath, options.allowedRoot)) {
		return {
			ok: false,
			notice: `Paired HTML file must be inside ${normalizePublishAllowedRoot(options.allowedRoot)}.`,
		};
	}

	return {
		ok: true,
		sourcePath,
		htmlPath,
	};
}

export function resolvePublicHtmlPairContext(options: {
	filePath: string;
	allowedRoot: string;
}): PublicHtmlPairContext | null {
	const normalizedPath = normalizeRelativePath(options.filePath);
	if (!normalizedPath || !isInsideAllowedRoot(normalizedPath, options.allowedRoot)) {
		return null;
	}

	const pair = isMarkdownPath(normalizedPath)
		? resolvePublicHtmlPairForSource({
			sourcePath: normalizedPath,
			frontmatterHtmlPath: null,
			allowedRoot: options.allowedRoot,
		})
		: isHtmlPath(normalizedPath)
			? resolvePublicHtmlPairForHtml({
				htmlPath: normalizedPath,
				allowedRoot: options.allowedRoot,
			})
			: null;
	if (!pair?.ok) {
		return null;
	}

	return {
		sourcePath: pair.sourcePath,
		htmlPath: pair.htmlPath,
		displayPath: pair.htmlPath,
		paths: [pair.sourcePath, pair.htmlPath],
	};
}

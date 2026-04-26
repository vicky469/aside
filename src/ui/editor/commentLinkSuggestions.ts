import type { App, TFile } from "obsidian";

export interface ExistingNoteSuggestion {
    type: "existing";
    file: TFile;
    linkText: string;
}

export interface CreateNoteSuggestion {
    type: "create";
    notePath: string;
    displayName: string;
}

export type SideNoteLinkSuggestion = ExistingNoteSuggestion | CreateNoteSuggestion;
const INVALID_NOTE_PATH_SEGMENT_CHARACTER_PATTERN = /[:]/g;

function joinPath(parentPath: string, childPath: string): string {
    if (!parentPath || parentPath === "/") {
        return normalizeNotePath(childPath);
    }

    return normalizeNotePath(`${parentPath}/${childPath}`);
}

function ensureMarkdownExtension(path: string): string {
    return path.toLowerCase().endsWith(".md") ? path : `${path}.md`;
}

function stripMarkdownExtension(path: string): string {
    return path.replace(/\.md$/i, "");
}

function extractLinkPath(rawQuery: string): string {
    const aliaslessQuery = rawQuery.split("|")[0]?.trim() ?? "";
    return aliaslessQuery.split("#")[0]?.trim() ?? "";
}

function getFolderPath(path: string): string {
    const slashIndex = path.lastIndexOf("/");
    return slashIndex === -1 ? "" : path.slice(0, slashIndex);
}

function getMatchScore(query: string, file: TFile, linkText: string): number {
    if (!query) {
        return 100;
    }

    const loweredQuery = query.toLowerCase();
    const basename = file.basename.toLowerCase();
    const path = file.path.toLowerCase();
    const loweredLinkText = linkText.toLowerCase();

    if (basename === loweredQuery || loweredLinkText === loweredQuery || path === `${loweredQuery}.md`) {
        return 0;
    }
    if (basename.startsWith(loweredQuery)) {
        return 1;
    }
    if (loweredLinkText.startsWith(loweredQuery)) {
        return 2;
    }
    if (path.startsWith(loweredQuery)) {
        return 3;
    }
    if (basename.includes(loweredQuery)) {
        return 4;
    }
    if (loweredLinkText.includes(loweredQuery)) {
        return 5;
    }
    if (path.includes(loweredQuery)) {
        return 6;
    }

    return Number.POSITIVE_INFINITY;
}

async function ensureFolderPathExists(app: App, folderPath: string): Promise<void> {
    const normalizedFolderPath = normalizeNotePath(folderPath);
    if (!normalizedFolderPath) {
        return;
    }

    const segments = normalizedFolderPath.split("/").filter(Boolean);
    let currentPath = "";
    for (const segment of segments) {
        currentPath = currentPath ? `${currentPath}/${segment}` : segment;
        const existing = app.vault.getAbstractFileByPath(currentPath);
        if (existing) {
            continue;
        }

        await app.vault.createFolder(currentPath);
    }
}

function resolveNewNotePath(app: App, sourcePath: string, query: string): string | null {
    const linkPath = extractLinkPath(query);
    if (!linkPath) {
        return null;
    }

    const sanitizedLinkPath = normalizeNotePath(linkPath, { sanitizeSegments: true });
    if (!sanitizedLinkPath) {
        return null;
    }

    const markdownPath = ensureMarkdownExtension(sanitizedLinkPath);
    if (markdownPath.includes("/")) {
        return normalizeNotePath(markdownPath, { sanitizeSegments: true });
    }

    const parentFolder = app.fileManager.getNewFileParent(sourcePath, markdownPath);
    return joinPath(parentFolder.path, markdownPath);
}

function getCreateSuggestion(app: App, sourcePath: string, query: string): CreateNoteSuggestion | null {
    if (!query) {
        return null;
    }

    const sanitizedDisplayName = normalizeNotePath(extractLinkPath(query), { sanitizeSegments: true });
    if (!sanitizedDisplayName) {
        return null;
    }

    const notePath = resolveNewNotePath(app, sourcePath, query);
    if (!notePath) {
        return null;
    }

    const exactMatch = app.vault.getAbstractFileByPath(notePath);
    const resolvedMatch = app.metadataCache.getFirstLinkpathDest(stripMarkdownExtension(notePath), sourcePath);
    if (exactMatch || resolvedMatch) {
        return null;
    }

    return {
        type: "create",
        notePath,
        displayName: sanitizedDisplayName,
    };
}

export function getSideNoteLinkSuggestions(
    app: App,
    query: string,
    sourcePath: string,
    limit = 40,
): SideNoteLinkSuggestion[] {
    const linkPathQuery = extractLinkPath(query);
    const files = app.vault
        .getMarkdownFiles()
        .map((file) => {
            const linkText = app.metadataCache.fileToLinktext(file, sourcePath, true);
            return {
                file,
                linkText,
                score: getMatchScore(linkPathQuery, file, linkText),
            };
        })
        .filter((candidate) => candidate.score !== Number.POSITIVE_INFINITY)
        .sort((left, right) => {
            if (left.score !== right.score) {
                return left.score - right.score;
            }
            if (left.file.basename !== right.file.basename) {
                return left.file.basename.localeCompare(right.file.basename);
            }
            return left.file.path.localeCompare(right.file.path);
        })
        .slice(0, limit)
        .map<ExistingNoteSuggestion>((candidate) => ({
            type: "existing",
            file: candidate.file,
            linkText: candidate.linkText,
        }));

    const createSuggestion = getCreateSuggestion(app, sourcePath, linkPathQuery);
    return createSuggestion ? [createSuggestion, ...files] : files;
}

export async function createSideNoteLinkNote(app: App, notePath: string): Promise<TFile> {
    const normalizedNotePath = normalizeNotePath(notePath, { sanitizeSegments: true });
    if (!normalizedNotePath) {
        throw new Error("Unable to create a note from an empty or invalid path.");
    }

    const folderPath = getFolderPath(normalizedNotePath);
    await ensureFolderPathExists(app, folderPath);
    return app.vault.create(normalizedNotePath, "");
}

function sanitizeNotePathSegment(segment: string): string {
    return segment
        .replace(INVALID_NOTE_PATH_SEGMENT_CHARACTER_PATTERN, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function normalizeNotePath(path: string, options: { sanitizeSegments?: boolean } = {}): string {
    const isAbsolute = path.startsWith("/");
    const segments = path
        .replace(/\\/g, "/")
        .split("/")
        .filter((segment) => segment.length > 0 && segment !== ".");
    const normalizedSegments: string[] = [];

    for (const segment of segments) {
        if (segment === "..") {
            normalizedSegments.pop();
            continue;
        }

        const normalizedSegment = options.sanitizeSegments ? sanitizeNotePathSegment(segment) : segment;
        if (!normalizedSegment) {
            return "";
        }

        normalizedSegments.push(normalizedSegment);
    }

    const normalized = normalizedSegments.join("/");
    return isAbsolute ? `/${normalized}` : normalized;
}

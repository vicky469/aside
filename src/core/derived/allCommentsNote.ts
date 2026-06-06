import type { Comment, CommentThread } from "../../commentManager";
import {
    buildSideNoteReferenceUrl,
    LEGACY_SIDE_NOTE_REFERENCE_PROTOCOL,
    parseSideNoteReferenceUrl,
    SIDE_NOTE_REFERENCE_PROTOCOL,
} from "../text/commentReferences";
import { extractTagsFromText } from "../text/commentTags";

export const ALL_COMMENTS_NOTE_PATH = "Aside index.md";
export const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";
export const LEGACY_ALL_COMMENTS_NOTE_PATHS = [
    "SideNote2 index.md",
    LEGACY_ALL_COMMENTS_NOTE_PATH,
    "Aside comments.md",
] as const;
export const COMMENT_LOCATION_PROTOCOL = SIDE_NOTE_REFERENCE_PROTOCOL;
export const ALL_COMMENTS_NOTE_IMAGE_URL = "https://ichef.bbci.co.uk/images/ic/1920xn/p02vhq1v.jpg.webp";
export const ALL_COMMENTS_NOTE_IMAGE_CAPTION = "Relativity (Credit: 2015 The M.C. Escher Company - Baarn, The Netherlands)";
export const ALL_COMMENTS_NOTE_IMAGE_ALT = "Aside index header image";
export const ALL_COMMENTS_NOTE_IMAGE_CAPTION_STYLE = "display: block; color: #8a8a8a; font-size: 12px; line-height: 1.2; text-align: center;";
export const INDEX_FILE_FILTER_PROTOCOL = "aside-index-file";
export const LEGACY_INDEX_FILE_FILTER_PROTOCOL = "side-note2-index-file";
export const INDEX_FILE_FILTER_LINK_CLASS = "aside-index-file-filter-link";
export const INDEX_FILE_FILTER_DATA_ATTRIBUTE = "data-aside-file-path";

export interface CommentLocationTarget {
    filePath: string;
    commentId: string;
}

export type IndexMarkdownLineTarget =
    | ({
        kind: "comment";
    } & CommentLocationTarget)
    | {
        kind: "file";
        filePath: string;
    };

export interface IndexNoteCommentNavigationTarget {
    commentId: string;
    filePath: string;
    fileLine: number | null;
    commentLine: number;
}

export interface IndexNoteNavigationMap {
    fileLineByFilePath: Map<string, number>;
    targetsByCommentId: Map<string, IndexNoteCommentNavigationTarget>;
}

export type AllCommentsNoteSource = Comment | CommentThread;

export interface AllCommentsNoteBuildOptions {
    allCommentsNotePath?: string;
    headerImageUrl?: string;
    headerImageCaption?: string | null;
    getSourceFileTags?: (filePath: string) => readonly string[] | null | undefined;
    getMentionedPageLabels?: (comment: Comment) => string[];
    hasSourceFile?: (filePath: string) => boolean;
    resolveWikiLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
}

function normalizeNotePath(filePath: string): string {
    const parts = filePath.replace(/\\/g, "/").split("/");
    const normalizedParts: string[] = [];

    for (const part of parts) {
        if (!part || part === ".") {
            continue;
        }

        if (part === "..") {
            normalizedParts.pop();
            continue;
        }

        normalizedParts.push(part);
    }

    return normalizedParts.join("/");
}

export function normalizeAllCommentsNotePath(filePath: string | null | undefined): string {
    const trimmedPath = filePath?.trim();
    if (!trimmedPath) {
        return ALL_COMMENTS_NOTE_PATH;
    }

    const normalized = normalizeNotePath(trimmedPath);
    return /\.md$/i.test(normalized) ? normalized : `${normalized}.md`;
}

export function normalizeAllCommentsNoteImageUrl(url: string | null | undefined): string {
    const trimmedUrl = url?.trim();
    return trimmedUrl || ALL_COMMENTS_NOTE_IMAGE_URL;
}

export function normalizeAllCommentsNoteImageCaption(caption: string | null | undefined): string {
    if (caption == null) {
        return ALL_COMMENTS_NOTE_IMAGE_CAPTION;
    }

    return caption.trim();
}

function escapeMarkdownText(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/([`*_[\]()~<>])/g, "\\$1");
}

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function unescapeHtmlText(value: string): string {
    return value
        .replace(/&quot;/g, "\"")
        .replace(/&#39;/g, "'")
        .replace(/&gt;/g, ">")
        .replace(/&lt;/g, "<")
        .replace(/&amp;/g, "&");
}

export function parseIndexFileOpenUrl(url: string): string | null {
    let parsedUrl: URL;
    try {
        parsedUrl = new URL(url);
    } catch {
        return null;
    }

    if (
        parsedUrl.protocol !== "obsidian:"
        || (
            parsedUrl.hostname !== "open"
            && parsedUrl.hostname !== INDEX_FILE_FILTER_PROTOCOL
            && parsedUrl.hostname !== LEGACY_INDEX_FILE_FILTER_PROTOCOL
        )
    ) {
        return null;
    }

    const filePath = parsedUrl.searchParams.get("file")?.trim() ?? "";
    return filePath || null;
}

function formatFileLink(filePath: string): string {
    const normalizedPath = normalizeNotePath(filePath);
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    const fileName = pathSegments.pop() ?? normalizedPath;
    return `<a href="#" class="${INDEX_FILE_FILTER_LINK_CLASS} aside-index-heading-label" title="${escapeHtmlText(normalizedPath)}" ${INDEX_FILE_FILTER_DATA_ATTRIBUTE}="${escapeHtmlText(normalizedPath)}">${escapeHtmlText(fileName)}</a>`;
}

function getFolderPath(filePath: string): string {
    const normalizedPath = normalizeNotePath(filePath);
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    pathSegments.pop();
    return pathSegments.join("/");
}

function isThreadLike(value: AllCommentsNoteSource): value is CommentThread {
    return Array.isArray((value as CommentThread).entries);
}

function getCommentTagBodies(comment: AllCommentsNoteSource): string[] {
    if (isThreadLike(comment)) {
        return comment.entries.map((entry) => entry.body ?? "");
    }

    return [comment.comment ?? ""];
}

function buildTagsByFileKey(comments: readonly AllCommentsNoteSource[]): Map<string, string[]> {
    const tagsByFileKey = new Map<string, Map<string, string>>();

    const addTag = (filePath: string, rawTag: string): void => {
        const tagText = rawTag.trim();
        const normalizedTagKey = tagText.replace(/^#+/, "").toLowerCase();
        if (!normalizedTagKey) {
            return;
        }

        const fileKey = normalizeNotePath(filePath);
        let tagsByKey = tagsByFileKey.get(fileKey);
        if (!tagsByKey) {
            tagsByKey = new Map<string, string>();
            tagsByFileKey.set(fileKey, tagsByKey);
        }
        if (!tagsByKey.has(normalizedTagKey)) {
            tagsByKey.set(normalizedTagKey, tagText.startsWith("#") ? tagText : `#${tagText}`);
        }
    };

    for (const comment of comments) {
        for (const body of getCommentTagBodies(comment)) {
            for (const rawTag of extractTagsFromText(body)) {
                addTag(comment.filePath, rawTag);
            }
        }
    }

    return new Map(
        Array.from(tagsByFileKey.entries()).map(([fileKey, tagsByKey]) => [
            fileKey,
            Array.from(tagsByKey.entries())
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([, tagText]) => tagText),
        ]),
    );
}

function mergeTagsByFileKey(
    left: ReadonlyMap<string, readonly string[]>,
    right: ReadonlyMap<string, readonly string[]>,
): Map<string, string[]> {
    const merged = new Map<string, Map<string, string>>();
    const addTags = (fileKey: string, tags: readonly string[]): void => {
        const normalizedFileKey = normalizeNotePath(fileKey);
        let tagsByKey = merged.get(normalizedFileKey);
        if (!tagsByKey) {
            tagsByKey = new Map<string, string>();
            merged.set(normalizedFileKey, tagsByKey);
        }

        for (const rawTag of tags) {
            const tagText = rawTag.trim();
            const tagKey = tagText.replace(/^#+/, "").toLowerCase();
            if (!tagKey || tagsByKey.has(tagKey)) {
                continue;
            }

            tagsByKey.set(tagKey, tagText.startsWith("#") ? tagText : `#${tagText}`);
        }
    };

    for (const [fileKey, tags] of left.entries()) {
        addTags(fileKey, tags);
    }
    for (const [fileKey, tags] of right.entries()) {
        addTags(fileKey, tags);
    }

    return new Map(
        Array.from(merged.entries()).map(([fileKey, tagsByKey]) => [
            fileKey,
            Array.from(tagsByKey.entries())
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([, tagText]) => tagText),
        ]),
    );
}

function buildSourceTagsByFileKey(
    filePaths: readonly string[],
    getSourceFileTags: AllCommentsNoteBuildOptions["getSourceFileTags"],
): Map<string, string[]> {
    const tagsByFileKey = new Map<string, string[]>();
    if (!getSourceFileTags) {
        return tagsByFileKey;
    }

    for (const filePath of filePaths) {
        const tags = getSourceFileTags(filePath) ?? [];
        if (tags.length) {
            tagsByFileKey.set(normalizeNotePath(filePath), Array.from(tags));
        }
    }

    return tagsByFileKey;
}

export function isAllCommentsNotePath(filePath: string, currentPath: string = ALL_COMMENTS_NOTE_PATH): boolean {
    return filePath === normalizeAllCommentsNotePath(currentPath)
        || LEGACY_ALL_COMMENTS_NOTE_PATHS.includes(filePath as typeof LEGACY_ALL_COMMENTS_NOTE_PATHS[number]);
}

export function buildCommentLocationUrl(vaultName: string, comment: Pick<Comment, "filePath" | "id">): string {
    return buildSideNoteReferenceUrl(vaultName, {
        commentId: comment.id,
        filePath: comment.filePath,
    });
}

export function buildIndexCommentBlockId(commentId: string): string {
    const normalizedId = commentId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return `aside-index-comment-${normalizedId || "unknown"}`;
}

export function parseCommentLocationUrl(url: string): CommentLocationTarget | null {
    const target = parseSideNoteReferenceUrl(url);
    if (!(target?.filePath && target.commentId)) {
        return null;
    }

    return {
        filePath: target.filePath,
        commentId: target.commentId,
    };
}

export function findCommentLocationTargetInMarkdownLine(line: string): CommentLocationTarget | null {
    const markdownLinkPattern = new RegExp(
        String.raw`\[[^\]]*]\((obsidian:\/\/(?:${SIDE_NOTE_REFERENCE_PROTOCOL}|${LEGACY_SIDE_NOTE_REFERENCE_PROTOCOL})\?[^)\s]+)\)`,
        "g",
    );
    for (const match of line.matchAll(markdownLinkPattern)) {
        const url = match[1];
        if (!url) {
            continue;
        }

        const target = parseCommentLocationUrl(url);
        if (target) {
            return target;
        }
    }

    return null;
}

export function buildCommentLocationLineNumberMap(noteContent: string): Map<string, number> {
    const lineNumbersByCommentId = new Map<string, number>();
    const lines = noteContent.split("\n");

    for (let index = 0; index < lines.length; index += 1) {
        const target = findCommentLocationTargetInMarkdownLine(lines[index] ?? "");
        if (!target || lineNumbersByCommentId.has(target.commentId)) {
            continue;
        }

        lineNumbersByCommentId.set(target.commentId, index);
    }

    return lineNumbersByCommentId;
}

export function findCommentLocationLineNumber(noteContent: string, commentId: string): number | null {
    return buildCommentLocationLineNumberMap(noteContent).get(commentId) ?? null;
}

export function findFileHeadingPathInMarkdownLine(line: string): string | null {
    const elementMatch = line.match(/<(?:span|strong|a)\b[^>]*class="[^"]*\b(?:aside|sidenote2)-index-heading-label\b[^"]*"[^>]*>/);
    const titleMatch = elementMatch?.[0]?.match(/\btitle="([^"]+)"/);
    if (titleMatch?.[1]) {
        return unescapeHtmlText(titleMatch[1]);
    }

    const htmlFileLinkMatch = line.match(/\bdata-(?:aside|sidenote2)-file-path="([^"]+)"/);
    if (htmlFileLinkMatch?.[1]) {
        return unescapeHtmlText(htmlFileLinkMatch[1]);
    }

    const markdownLinkPattern = /\[[^\]]*]\((obsidian:\/\/(?:open|aside-index-file|side-note2-index-file)\?[^)\s]+)\)/g;
    for (const match of line.matchAll(markdownLinkPattern)) {
        const url = match[1];
        if (!url) {
            continue;
        }

        const filePath = parseIndexFileOpenUrl(url);
        if (filePath) {
            return filePath;
        }
    }

    return null;
}

export function findIndexMarkdownLineTarget(line: string): IndexMarkdownLineTarget | null {
    const commentTarget = findCommentLocationTargetInMarkdownLine(line);
    if (commentTarget) {
        return {
            kind: "comment",
            ...commentTarget,
        };
    }

    const fileHeadingPath = findFileHeadingPathInMarkdownLine(line);
    if (fileHeadingPath) {
        return {
            kind: "file",
            filePath: fileHeadingPath,
        };
    }

    return null;
}

export function buildIndexNoteNavigationMap(noteContent: string): IndexNoteNavigationMap {
    const fileLineByFilePath = new Map<string, number>();
    const targetsByCommentId = new Map<string, IndexNoteCommentNavigationTarget>();
    const lines = noteContent.split("\n");
    let currentFilePath: string | null = null;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index] ?? "";
        const fileHeadingPath = findFileHeadingPathInMarkdownLine(line);
        if (fileHeadingPath) {
            currentFilePath = fileHeadingPath;
            fileLineByFilePath.set(fileHeadingPath, index);
            continue;
        }

        const target = findCommentLocationTargetInMarkdownLine(line);
        if (!target || targetsByCommentId.has(target.commentId)) {
            continue;
        }

        const targetFilePath = currentFilePath ?? target.filePath;
        targetsByCommentId.set(target.commentId, {
            commentId: target.commentId,
            filePath: targetFilePath,
            fileLine: fileLineByFilePath.get(targetFilePath) ?? null,
            commentLine: index,
        });
    }

    return {
        fileLineByFilePath,
        targetsByCommentId,
    };
}

function appendFileSections(
    lines: string[],
    filePaths: readonly string[],
    vaultName: string,
    tagsByFileKey: ReadonlyMap<string, readonly string[]> = new Map<string, readonly string[]>(),
): void {
    const filePathsByFolder = new Map<string, string[]>();
    for (const filePath of filePaths) {
        const folderPath = getFolderPath(filePath);
        const existing = filePathsByFolder.get(folderPath);
        if (existing) {
            existing.push(filePath);
        } else {
            filePathsByFolder.set(folderPath, [filePath]);
        }
    }

    const folderPaths = Array.from(filePathsByFolder.keys()).sort((left, right) => left.localeCompare(right));
    for (const folderPath of folderPaths) {
        if (folderPath) {
            lines.push(escapeMarkdownText(folderPath));
        }

        const folderFilePaths = (filePathsByFolder.get(folderPath) ?? [])
            .slice()
            .sort((left, right) => left.localeCompare(right));
        for (let index = 0; index < folderFilePaths.length; index += 1) {
            const filePath = folderFilePaths[index];
            const tags = tagsByFileKey.get(normalizeNotePath(filePath)) ?? [];
            const tagSuffix = tags.length ? `  ${tags.join(" ")}` : "";
            lines.push(`- ${formatFileLink(filePath)}${tagSuffix}`);
            if (index < folderFilePaths.length - 1) {
                lines.push("");
            }
        }

        lines.push("");
    }
}

export function buildAllCommentsNoteContent(
    vaultName: string,
    comments: AllCommentsNoteSource[],
    options: AllCommentsNoteBuildOptions = {},
): string {
    const headerImageUrl = normalizeAllCommentsNoteImageUrl(options.headerImageUrl);
    const headerImageCaption = normalizeAllCommentsNoteImageCaption(options.headerImageCaption);
    const lines: string[] = [
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${headerImageUrl})`,
    ];
    if (headerImageCaption) {
        lines.push(`<div class="aside-index-header-caption" style="${ALL_COMMENTS_NOTE_IMAGE_CAPTION_STYLE}">${escapeHtmlText(headerImageCaption)}</div>`);
    }
    lines.push("");
    const visibleComments = comments.filter((comment) => (
        !isAllCommentsNotePath(comment.filePath, options.allCommentsNotePath)
        && (options.hasSourceFile?.(comment.filePath) ?? true)
    ));

    if (!visibleComments.length) {
        return `${lines.join("\n").trimEnd()}\n`;
    }

    const filePathsByKey = new Map<string, string>();
    for (const comment of visibleComments) {
        filePathsByKey.set(normalizeNotePath(comment.filePath), comment.filePath);
    }
    const filePaths = Array.from(filePathsByKey.values()).sort((left, right) => left.localeCompare(right));
    const tagsByFileKey = mergeTagsByFileKey(
        buildSourceTagsByFileKey(filePaths, options.getSourceFileTags),
        buildTagsByFileKey(visibleComments),
    );
    appendFileSections(lines, filePaths, vaultName, tagsByFileKey);

    return `${lines.join("\n").trimEnd()}\n`;
}

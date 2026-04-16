import type { Comment } from "../../commentManager";
import { compareCommentsForSidebarOrder } from "../anchors/commentSectionOrder";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment, isPageComment } from "../anchors/commentAnchors";
import { filterCommentsByResolvedVisibility } from "../rules/resolvedCommentVisibility";
import { stripMarkdownLinksForPreview } from "../text/commentUrls";
import { extractTagsFromText } from "../text/commentTags";

export const ALL_COMMENTS_NOTE_PATH = "SideNote2 index.md";
export const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";
export const COMMENT_LOCATION_PROTOCOL = "side-note2-comment";
export const ALL_COMMENTS_NOTE_IMAGE_URL = "https://ichef.bbci.co.uk/images/ic/1920xn/p02vhq1v.jpg.webp";
export const ALL_COMMENTS_NOTE_IMAGE_CAPTION = "Relativity (Credit: 2015 The M.C. Escher Company - Baarn, The Netherlands)";
export const ALL_COMMENTS_NOTE_IMAGE_ALT = "SideNote2 index header image";
const MAX_PREVIEW_LENGTH = 80;
const PAGE_NOTE_LABEL_WORD_LIMIT = 10;
const RESOLVED_COMMENTS_MODE_LABEL = "Showing: Resolved comments only";

export interface CommentLocationTarget {
    filePath: string;
    commentId: string;
}

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

export interface AllCommentsNoteBuildOptions {
    allCommentsNotePath?: string;
    headerImageUrl?: string;
    headerImageCaption?: string | null;
    showResolved?: boolean;
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

function toInlinePreview(value: string, maxLength: number = MAX_PREVIEW_LENGTH): string {
    const normalized = stripMarkdownLinksForPreview(value).replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "(blank selection)";
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
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

function formatFileHeadingLabel(filePath: string): string {
    const normalizedPath = normalizeNotePath(filePath);
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    const fileName = pathSegments.pop() ?? normalizedPath;
    return `<strong class="sidenote2-index-heading-label" title="${escapeHtmlText(filePath)}">${escapeHtmlText(fileName)}</strong>`;
}

function getFolderPath(filePath: string): string {
    const normalizedPath = normalizeNotePath(filePath);
    const pathSegments = normalizedPath.split("/").filter(Boolean);
    pathSegments.pop();
    return pathSegments.join("/");
}

function toWordPreview(value: string, maxWords: number): string {
    const normalized = stripMarkdownLinksForPreview(value).replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "";
    }

    const words = normalized.split(/\s+/);
    if (words.length <= maxWords) {
        return normalized;
    }

    return `${words.slice(0, maxWords).join(" ")}...`;
}

function getCommentLinkLabelText(comment: Comment): string {
    const selectedPreview = toInlinePreview(getCommentSelectionLabel(comment));
    if (isPageComment(comment)) {
        return toWordPreview(comment.comment ?? "", PAGE_NOTE_LABEL_WORD_LIMIT) || selectedPreview;
    }

    return isAnchoredComment(comment)
        ? selectedPreview
        : `${getCommentStatusLabel(comment)} · ${selectedPreview}`;
}

function formatCommentLinkLabel(comment: Comment): string {
    const escapedLabel = escapeMarkdownText(getCommentLinkLabelText(comment));
    if (comment.resolved) {
        return `~~${escapedLabel}~~`;
    }

    return escapedLabel;
}

function formatCommentKindMarker(comment: Comment): string {
    return isPageComment(comment)
        ? '<span class="sidenote2-index-kind-dot sidenote2-index-kind-page"></span>'
        : '<span class="sidenote2-index-kind-dot sidenote2-index-kind-anchored"></span>';
}

function formatCommentTags(comment: Comment): string | null {
    const uniqueTags = Array.from(new Set(extractTagsFromText(comment.comment ?? "")));
    if (!uniqueTags.length) {
        return null;
    }

    return uniqueTags.join(" ");
}

function getCommentKindKey(comment: Comment): "page" | "anchored" {
    return isPageComment(comment) ? "page" : "anchored";
}

export function isAllCommentsNotePath(filePath: string, currentPath: string = ALL_COMMENTS_NOTE_PATH): boolean {
    return filePath === normalizeAllCommentsNotePath(currentPath) || filePath === LEGACY_ALL_COMMENTS_NOTE_PATH;
}

export function buildCommentLocationUrl(vaultName: string, comment: Pick<Comment, "filePath" | "id">): string {
    return `obsidian://${COMMENT_LOCATION_PROTOCOL}?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(comment.filePath)}&commentId=${encodeURIComponent(comment.id)}`;
}

export function buildIndexCommentBlockId(commentId: string): string {
    const normalizedId = commentId
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return `sidenote2-index-comment-${normalizedId || "unknown"}`;
}

export function parseCommentLocationUrl(url: string): CommentLocationTarget | null {
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== "obsidian:" || parsed.hostname !== COMMENT_LOCATION_PROTOCOL) {
            return null;
        }

        const filePath = parsed.searchParams.get("file");
        const commentId = parsed.searchParams.get("commentId");
        if (!(filePath && commentId)) {
            return null;
        }

        return {
            filePath,
            commentId,
        };
    } catch {
        return null;
    }
}

export function findCommentLocationTargetInMarkdownLine(line: string): CommentLocationTarget | null {
    const markdownLinkPattern = /\[[^\]]*]\((obsidian:\/\/side-note2-comment\?[^)\s]+)\)/g;
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

function findFileHeadingPathInMarkdownLine(line: string): string | null {
    const match = line.match(/<strong class="sidenote2-index-heading-label" title="([^"]+)">/);
    if (!match?.[1]) {
        return null;
    }

    return unescapeHtmlText(match[1]);
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

function appendFileCommentLines(
    lines: string[],
    fileComments: Comment[],
    vaultName: string,
): void {
    for (const comment of fileComments) {
        const tagLine = formatCommentTags(comment);
        const commentUrl = `${buildCommentLocationUrl(vaultName, comment)}&kind=${getCommentKindKey(comment)}`;
        const blockId = buildIndexCommentBlockId(comment.id);
        const marker = formatCommentKindMarker(comment);

        lines.push(
            tagLine
                ? `${marker} [${formatCommentLinkLabel(comment)}](${commentUrl})  ${tagLine} ^${blockId}`
                : `${marker} [${formatCommentLinkLabel(comment)}](${commentUrl}) ^${blockId}`
        );
        lines.push("");
    }
}

function appendFileSections(
    lines: string[],
    filePaths: readonly string[],
    commentsByFile: ReadonlyMap<string, Comment[]>,
    vaultName: string,
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
            lines.push(`### ${escapeMarkdownText(folderPath)}`);
            lines.push("");
        }

        const folderFilePaths = (filePathsByFolder.get(folderPath) ?? [])
            .slice()
            .sort((left, right) => left.localeCompare(right));
        for (const filePath of folderFilePaths) {
            lines.push(`  ${formatFileHeadingLabel(filePath)}`);
            lines.push("");

            const fileComments = (commentsByFile.get(filePath) ?? [])
                .slice()
                .sort(compareCommentsForSidebarOrder);
            appendFileCommentLines(lines, fileComments, vaultName);
            lines.push("");
        }

        if (folderPath) {
            lines.push("");
        }
    }
}

export function buildAllCommentsNoteContent(
    vaultName: string,
    comments: Comment[],
    options: AllCommentsNoteBuildOptions = {},
): string {
    const headerImageUrl = normalizeAllCommentsNoteImageUrl(options.headerImageUrl);
    const headerImageCaption = normalizeAllCommentsNoteImageCaption(options.headerImageCaption);
    const showResolved = options.showResolved ?? false;
    const lines: string[] = [
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${headerImageUrl})`,
    ];
    if (headerImageCaption) {
        lines.push(`<div class="sidenote2-index-header-caption">${headerImageCaption}</div>`);
    }
    if (options.showResolved) {
        lines.push(
            `<div class="sidenote2-index-visibility-label">${RESOLVED_COMMENTS_MODE_LABEL}</div>`,
        );
    }
    lines.push("");
    const visibleComments = filterCommentsByResolvedVisibility(
        comments.filter((comment) => (
            !isAllCommentsNotePath(comment.filePath, options.allCommentsNotePath)
            && (options.hasSourceFile?.(comment.filePath) ?? true)
        )),
        showResolved,
    );

    if (!visibleComments.length) {
        return `${lines.join("\n").trimEnd()}\n`;
    }

    const commentsByFile = new Map<string, Comment[]>();
    for (const comment of visibleComments) {
        const existing = commentsByFile.get(comment.filePath);
        if (existing) {
            existing.push(comment);
        } else {
            commentsByFile.set(comment.filePath, [comment]);
        }
    }
    const filePaths = Array.from(commentsByFile.keys()).sort((left, right) => left.localeCompare(right));
    appendFileSections(lines, filePaths, commentsByFile, vaultName);

    return `${lines.join("\n").trimEnd()}\n`;
}

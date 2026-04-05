import type { Comment } from "../../commentManager";
import { compareCommentsForSidebarOrder } from "../anchors/commentSectionOrder";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment, isPageComment } from "../anchors/commentAnchors";
import { extractTagsFromText } from "../text/commentTags";

export const ALL_COMMENTS_NOTE_PATH = "SideNote2 index.md";
export const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";
export const COMMENT_LOCATION_PROTOCOL = "side-note2-comment";
export const ALL_COMMENTS_NOTE_IMAGE_URL = "https://ichef.bbci.co.uk/images/ic/1920xn/p02vhq1v.jpg.webp";
export const ALL_COMMENTS_NOTE_IMAGE_CAPTION = "Relativity (Credit: 2015 The M.C. Escher Company - Baarn, The Netherlands)";
export const ALL_COMMENTS_NOTE_IMAGE_ALT = "SideNote2 index header image";
const MAX_PREVIEW_LENGTH = 80;
const MAX_FILE_HEADING_LENGTH = 60;

export interface CommentLocationTarget {
    filePath: string;
    commentId: string;
}

export interface AllCommentsNoteBuildOptions {
    allCommentsNotePath?: string;
    headerImageUrl?: string;
    headerImageCaption?: string | null;
    getMentionedPageLabels?: (comment: Comment) => string[];
    resolveWikiLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
    connectedChainDepth?: number;
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
    const normalized = value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
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

function formatFileHeadingLabel(filePath: string): string {
    const headingLabel = toInlinePreview(filePath, MAX_FILE_HEADING_LENGTH);
    if (headingLabel === filePath) {
        return `<strong class="sidenote2-index-heading-label">${escapeHtmlText(filePath)}</strong>`;
    }

    return `<strong class="sidenote2-index-heading-label" title="${escapeHtmlText(filePath)}">${escapeHtmlText(headingLabel)}</strong>`;
}

function formatPageNoteLabel(pageNoteOrdinal?: number): string {
    return pageNoteOrdinal ? `pn${pageNoteOrdinal}` : "pn";
}

function getCommentLinkLabelText(comment: Comment, pageNoteOrdinal?: number): string {
    const selectedPreview = toInlinePreview(getCommentSelectionLabel(comment));
    if (isPageComment(comment)) {
        return formatPageNoteLabel(pageNoteOrdinal);
    }

    return isAnchoredComment(comment)
        ? selectedPreview
        : `${getCommentStatusLabel(comment)} · ${selectedPreview}`;
}

function formatCommentLinkLabel(comment: Comment, pageNoteOrdinal?: number): string {
    const escapedLabel = escapeMarkdownText(getCommentLinkLabelText(comment, pageNoteOrdinal));
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

export function buildAllCommentsNoteContent(
    vaultName: string,
    comments: Comment[],
    options: AllCommentsNoteBuildOptions = {},
): string {
    const headerImageUrl = normalizeAllCommentsNoteImageUrl(options.headerImageUrl);
    const headerImageCaption = normalizeAllCommentsNoteImageCaption(options.headerImageCaption);
    const lines: string[] = [
        `![${ALL_COMMENTS_NOTE_IMAGE_ALT}](${headerImageUrl})`,
    ];
    if (headerImageCaption) {
        lines.push(`<div class="sidenote2-index-header-caption">${headerImageCaption}</div>`);
    }
    lines.push("");
    const visibleComments = comments.filter((comment) => !isAllCommentsNotePath(comment.filePath, options.allCommentsNotePath));

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

    for (const filePath of filePaths) {
        lines.push(formatFileHeadingLabel(filePath));
        lines.push("");

        const fileComments = (commentsByFile.get(filePath) ?? [])
            .slice()
            .sort(compareCommentsForSidebarOrder);
        const pageNoteOrdinals = new Map<string, number>();
        let nextPageNoteOrdinal = 1;
        for (const comment of fileComments) {
            if (!isPageComment(comment)) {
                continue;
            }

            pageNoteOrdinals.set(comment.id, nextPageNoteOrdinal);
            nextPageNoteOrdinal += 1;
        }

        for (const comment of fileComments) {
            const tagLine = formatCommentTags(comment);
            const commentUrl = `${buildCommentLocationUrl(vaultName, comment)}&kind=${getCommentKindKey(comment)}`;
            const blockId = buildIndexCommentBlockId(comment.id);
            const marker = formatCommentKindMarker(comment);

            lines.push(
                tagLine
                    ? `${marker} [${formatCommentLinkLabel(comment, pageNoteOrdinals.get(comment.id))}](${commentUrl})  ${tagLine} ^${blockId}`
                    : `${marker} [${formatCommentLinkLabel(comment, pageNoteOrdinals.get(comment.id))}](${commentUrl}) ^${blockId}`
            );
            lines.push("");
        }

        lines.push("");
    }

    return `${lines.join("\n").trimEnd()}\n`;
}

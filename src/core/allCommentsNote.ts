import type { Comment } from "../commentManager";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment } from "./commentAnchors";
import { extractTagsFromText } from "./commentTags";
import { sortCommentsByPosition } from "./noteCommentStorage";

export const ALL_COMMENTS_NOTE_PATH = "SideNote2 index.md";
export const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";
export const COMMENT_LOCATION_PROTOCOL = "side-note2-comment";
export const ALL_COMMENTS_NOTE_IMAGE_URL = "https://ichef.bbci.co.uk/images/ic/1920xn/p02vhq1v.jpg.webp";
export const ALL_COMMENTS_NOTE_IMAGE_CAPTION = "Relativity (Credit: 2015 The M.C. Escher Company - Baarn, The Netherlands)";
export const ALL_COMMENTS_NOTE_IMAGE_ALT = "SideNote2 index header image";
const MAX_PREVIEW_LENGTH = 80;

export interface CommentLocationTarget {
    filePath: string;
    commentId: string;
}

export interface AllCommentsNoteBuildOptions {
    allCommentsNotePath?: string;
    headerImageUrl?: string;
    headerImageCaption?: string | null;
    getMentionedPageLabels?: (comment: Comment) => string[];
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

function toInlinePreview(value: string): string {
    const normalized = value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "(blank selection)";
    }

    if (normalized.length <= MAX_PREVIEW_LENGTH) {
        return normalized;
    }

    return `${normalized.slice(0, MAX_PREVIEW_LENGTH - 3).trimEnd()}...`;
}

function escapeMarkdownText(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/([`*_[\]()~<>])/g, "\\$1");
}

function formatFileHeadingLabel(filePath: string): string {
    return escapeMarkdownText(filePath);
}

function formatCommentLinkLabel(comment: Comment, mentionedPageLabel?: string): string {
    const selectedPreview = escapeMarkdownText(toInlinePreview(getCommentSelectionLabel(comment)));
    const normalizedMentionLabel = mentionedPageLabel
        ? escapeMarkdownText(toInlinePreview(mentionedPageLabel))
        : null;
    const prefixedPreview = isAnchoredComment(comment)
        ? (normalizedMentionLabel ? `${selectedPreview} · ${normalizedMentionLabel}` : selectedPreview)
        : `${getCommentStatusLabel(comment)} · ${normalizedMentionLabel ?? selectedPreview}`;
    if (comment.resolved) {
        return `~~${prefixedPreview}~~`;
    }

    return prefixedPreview;
}

function formatCommentTags(comment: Comment): string | null {
    const uniqueTags = Array.from(new Set(extractTagsFromText(comment.comment ?? "")));
    if (!uniqueTags.length) {
        return null;
    }

    return uniqueTags.join(" ");
}

export function isAllCommentsNotePath(filePath: string, currentPath: string = ALL_COMMENTS_NOTE_PATH): boolean {
    return filePath === normalizeAllCommentsNotePath(currentPath) || filePath === LEGACY_ALL_COMMENTS_NOTE_PATH;
}

export function buildCommentLocationUrl(vaultName: string, comment: Pick<Comment, "filePath" | "id">): string {
    return `obsidian://${COMMENT_LOCATION_PROTOCOL}?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(comment.filePath)}&commentId=${encodeURIComponent(comment.id)}`;
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

function dedupeMentionedPageLabels(labels: string[]): string[] {
    const seen = new Set<string>();
    const deduped: string[] = [];

    for (const label of labels) {
        const normalized = label.trim();
        if (!normalized || seen.has(normalized)) {
            continue;
        }

        seen.add(normalized);
        deduped.push(normalized);
    }

    return deduped;
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
        lines.push(`**${formatFileHeadingLabel(filePath)}**`);

        const fileComments = sortCommentsByPosition(commentsByFile.get(filePath) ?? []);
        for (const comment of fileComments) {
            const tagLine = formatCommentTags(comment);
            const mentionedPageLabels = dedupeMentionedPageLabels(options.getMentionedPageLabels?.(comment) ?? []);
            const labels = mentionedPageLabels.length ? mentionedPageLabels : [null];

            for (const mentionedPageLabel of labels) {
                lines.push(
                    tagLine
                        ? `- [${formatCommentLinkLabel(comment, mentionedPageLabel ?? undefined)}](${buildCommentLocationUrl(vaultName, comment)})  ${tagLine}`
                        : `- [${formatCommentLinkLabel(comment, mentionedPageLabel ?? undefined)}](${buildCommentLocationUrl(vaultName, comment)})`
                );
            }
        }

        lines.push("");
    }

    return `${lines.join("\n").trimEnd()}\n`;
}

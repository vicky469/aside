import type { Comment } from "../../commentManager";
import {
    COMMENT_SECTION_DEFINITIONS,
    getCommentSectionKey,
} from "../anchors/commentSectionOrder";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment, isPageComment } from "../anchors/commentAnchors";
import { sortCommentsByPosition } from "../storage/noteCommentStorage";
import { extractWikiLinks } from "../text/commentMentions";
import { extractTagsFromText } from "../text/commentTags";

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

function escapeHtmlText(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

function buildNoteOpenUrl(vaultName: string, filePath: string): string {
    return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(normalizeNotePath(filePath))}`;
}

function formatNoteOpenAnchor(vaultName: string, filePath: string, className: string, label?: string): string {
    const normalizedLabel = label?.trim() || normalizeNotePath(filePath);
    return `<a class="external-link ${className}" href="${escapeHtmlText(buildNoteOpenUrl(vaultName, filePath))}" target="_blank" rel="noopener nofollow">${escapeHtmlText(normalizedLabel)}</a>`;
}

function formatFileHeadingLabel(filePath: string): string {
    return `<strong class="sidenote2-index-heading-label">${escapeHtmlText(filePath)}</strong>`;
}

function formatPageNoteLabel(pageNoteOrdinal?: number): string {
    return pageNoteOrdinal ? `pn${pageNoteOrdinal}` : "pn";
}

function getCommentLinkLabelText(comment: Comment, mentionedPageLabel?: string, pageNoteOrdinal?: number): string {
    const selectedPreview = toInlinePreview(getCommentSelectionLabel(comment));
    const normalizedMentionLabel = mentionedPageLabel
        ? toInlinePreview(mentionedPageLabel)
        : null;
    if (isPageComment(comment)) {
        return formatPageNoteLabel(pageNoteOrdinal);
    }

    return isAnchoredComment(comment)
        ? (normalizedMentionLabel ? `${selectedPreview} · ${normalizedMentionLabel}` : selectedPreview)
        : `${getCommentStatusLabel(comment)} · ${selectedPreview}`;
}

function formatCommentLinkLabel(comment: Comment, mentionedPageLabel?: string, pageNoteOrdinal?: number): string {
    const escapedLabel = escapeMarkdownText(getCommentLinkLabelText(comment, mentionedPageLabel, pageNoteOrdinal));
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

type ResolvedMentionTarget = {
    filePath: string;
    label: string;
};

function buildResolvedMentionTargets(
    comment: Comment,
    options: AllCommentsNoteBuildOptions,
): ResolvedMentionTarget[] {
    const resolveWikiLinkPath = options.resolveWikiLinkPath;
    if (!resolveWikiLinkPath) {
        return [];
    }

    const targets: ResolvedMentionTarget[] = [];
    const seen = new Set<string>();
    for (const match of extractWikiLinks(comment.comment ?? "")) {
        const resolvedPath = resolveWikiLinkPath(match.linkPath, comment.filePath);
        if (!resolvedPath || resolvedPath === comment.filePath || isAllCommentsNotePath(resolvedPath, options.allCommentsNotePath)) {
            continue;
        }

        if (seen.has(resolvedPath)) {
            continue;
        }

        seen.add(resolvedPath);
        targets.push({
            filePath: resolvedPath,
            label: toInlinePreview(match.displayText?.trim() || match.linkPath.trim()),
        });
    }

    return targets;
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

        const fileComments = sortCommentsByPosition(commentsByFile.get(filePath) ?? []);
        const pageNoteOrdinals = new Map<string, number>();
        let nextPageNoteOrdinal = 1;
        for (const comment of fileComments) {
            if (!isPageComment(comment)) {
                continue;
            }

            pageNoteOrdinals.set(comment.id, nextPageNoteOrdinal);
            nextPageNoteOrdinal += 1;
        }

        let renderedSectionCount = 0;
        for (const section of COMMENT_SECTION_DEFINITIONS) {
            const sectionComments = fileComments.filter((comment) => getCommentSectionKey(comment) === section.key);
            if (!sectionComments.length) {
                continue;
            }

            for (const comment of sectionComments) {
                const tagLine = formatCommentTags(comment);
                const resolvedMentionTargets = buildResolvedMentionTargets(comment, options);
                const mentionedPageLabels = resolvedMentionTargets.length
                    ? resolvedMentionTargets.map((target) => target.label)
                    : dedupeMentionedPageLabels(options.getMentionedPageLabels?.(comment) ?? []);
                const labels = isPageComment(comment)
                    ? [null]
                    : (mentionedPageLabels.length ? mentionedPageLabels : [null]);
                const commentUrl = `${buildCommentLocationUrl(vaultName, comment)}&kind=${section.key}`;
                const marker = formatCommentKindMarker(comment);

                for (const [index, mentionedPageLabel] of labels.entries()) {
                    const mentionedTarget = isPageComment(comment) ? null : resolvedMentionTargets[index];
                    const targetSuffix = mentionedTarget
                        ? ` -> ${formatNoteOpenAnchor(vaultName, mentionedTarget.filePath, "sidenote2-index-target-link", mentionedTarget.label)}`
                        : "";
                    lines.push(
                        tagLine
                            ? `${marker} [${formatCommentLinkLabel(comment, mentionedPageLabel ?? undefined, pageNoteOrdinals.get(comment.id))}](${commentUrl})${targetSuffix}  ${tagLine}`
                            : `${marker} [${formatCommentLinkLabel(comment, mentionedPageLabel ?? undefined, pageNoteOrdinals.get(comment.id))}](${commentUrl})${targetSuffix}`
                    );
                }
            }

            renderedSectionCount += 1;
        }

        lines.push("");
    }

    return `${lines.join("\n").trimEnd()}\n`;
}

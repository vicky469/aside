import type { Comment } from "../commentManager";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment } from "./commentAnchors";
import { extractTagsFromText } from "./commentTags";
import { sortCommentsByPosition } from "./noteCommentStorage";

export const ALL_COMMENTS_NOTE_PATH = "SideNote2 index.md";
export const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";
export const COMMENT_LOCATION_PROTOCOL = "side-note2-comment";
const MAX_PREVIEW_LENGTH = 80;

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

function formatCommentLinkLabel(comment: Comment): string {
    const selectedPreview = escapeMarkdownText(toInlinePreview(getCommentSelectionLabel(comment)));
    const prefixedPreview = isAnchoredComment(comment)
        ? selectedPreview
        : `${getCommentStatusLabel(comment)} · ${selectedPreview}`;
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

export function isAllCommentsNotePath(filePath: string): boolean {
    return filePath === ALL_COMMENTS_NOTE_PATH || filePath === LEGACY_ALL_COMMENTS_NOTE_PATH;
}

export function buildCommentLocationUrl(vaultName: string, comment: Pick<Comment, "filePath" | "id">): string {
    return `obsidian://${COMMENT_LOCATION_PROTOCOL}?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(comment.filePath)}&commentId=${encodeURIComponent(comment.id)}`;
}

export function buildAllCommentsNoteContent(vaultName: string, comments: Comment[]): string {
    const lines: string[] = [];
    const visibleComments = comments.filter((comment) => !isAllCommentsNotePath(comment.filePath));

    if (!visibleComments.length) {
        return "";
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
        lines.push(`**[[${filePath}]]**`);

        const fileComments = sortCommentsByPosition(commentsByFile.get(filePath) ?? []);
        for (const comment of fileComments) {
            const tagLine = formatCommentTags(comment);
            lines.push(
                tagLine
                    ? `- [${formatCommentLinkLabel(comment)}](${buildCommentLocationUrl(vaultName, comment)})  ${tagLine}`
                    : `- [${formatCommentLinkLabel(comment)}](${buildCommentLocationUrl(vaultName, comment)})`
            );
        }

        lines.push("");
    }

    return `${lines.join("\n").trimEnd()}\n`;
}

import type { CommentAnchorKind } from "../../commentManager";
import { isOrphanedComment } from "../../core/anchors/commentAnchors";

export interface SidebarCommentPresentationLike {
    timestamp: number;
    resolved?: boolean;
    anchorKind?: CommentAnchorKind;
    isBookmark?: boolean;
    orphaned?: boolean;
    deletedAt?: number;
    selectedText?: string;
}

const compactTimeFormatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
});

const compactWeekdayTimeFormatter = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
});

const compactMonthDayFormatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
});

function resolveValidDate(value: number): Date | null {
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date : null;
}

function getLocalDayOrdinal(date: Date): number {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000);
}

export function formatSidebarCommentTimestamp(
    timestamp: number,
    referenceNow: number = Date.now(),
): string {
    const date = resolveValidDate(timestamp);
    const now = resolveValidDate(referenceNow);
    if (!date || !now) {
        return "";
    }

    const dayDiff = getLocalDayOrdinal(date) - getLocalDayOrdinal(now);
    if (dayDiff === 0) {
        return compactTimeFormatter.format(date);
    }
    if (dayDiff === -1) {
        return "Yesterday";
    }
    if (dayDiff >= -6 && dayDiff <= 6) {
        return compactWeekdayTimeFormatter.format(date);
    }
    if (date.getFullYear() === now.getFullYear()) {
        return compactMonthDayFormatter.format(date);
    }

    const year = String(date.getFullYear()).padStart(4, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

export function formatSidebarCommentSelectedTextPreview(
    comment: Pick<SidebarCommentPresentationLike, "anchorKind" | "isBookmark" | "selectedText">,
): string | null {
    if (
        typeof comment.selectedText !== "string"
        || (comment.isBookmark !== true && comment.anchorKind !== "selection")
    ) {
        return null;
    }

    const normalized = comment.selectedText.replace(/\s+/g, " ").trim();
    return normalized.length > 0 ? normalized : null;
}

export function formatSidebarCommentMeta(comment: SidebarCommentPresentationLike): string {
    const segments = [formatSidebarCommentTimestamp(comment.timestamp)];

    if (isOrphanedComment(comment)) {
        segments.push("orphaned");
    }
    if (comment.resolved) {
        segments.push("resolved");
    }
    if (comment.deletedAt) {
        segments.push("deleted");
    }

    return segments.join(" · ");
}

import type { Comment, CommentThread } from "../../commentManager";
import { getFirstThreadEntry, threadEntryToComment } from "../../commentManager";
import { compareCommentsForSidebarOrder, getCommentSectionKey } from "../../core/anchors/commentSectionOrder";
import type { DraftComment } from "../../domain/drafts";

export type SidebarRenderableItem =
    | { kind: "thread"; thread: CommentThread }
    | { kind: "draft"; draft: DraftComment };

export function getSidebarSortCommentForThread(thread: CommentThread): Comment {
    const firstEntry = getFirstThreadEntry(thread);

    return {
        ...threadEntryToComment(thread, firstEntry),
        id: thread.id,
    };
}

function getNormalizedFolderPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    parts.pop();
    return parts.join("/");
}

function compareCommentsForIndexListOrder<T extends Comment>(left: T, right: T): number {
    const leftFolder = getNormalizedFolderPath(left.filePath);
    const rightFolder = getNormalizedFolderPath(right.filePath);
    if (leftFolder !== rightFolder) {
        return leftFolder.localeCompare(rightFolder);
    }

    if (left.filePath !== right.filePath) {
        return left.filePath.localeCompare(right.filePath);
    }

    const leftSection = getCommentSectionKey(left);
    const rightSection = getCommentSectionKey(right);
    if (leftSection !== rightSection) {
        return leftSection === "page" ? -1 : 1;
    }

    if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
    }

    if (left.startChar !== right.startChar) {
        return left.startChar - right.startChar;
    }

    return left.timestamp - right.timestamp;
}

export function getReplacedThreadIdForEditDraft(
    threads: readonly CommentThread[],
    draft: DraftComment | null,
): string | null {
    if (!draft || draft.mode !== "edit") {
        return null;
    }

    if (draft.threadId) {
        return draft.threadId;
    }

    return threads.find((thread) =>
        thread.id === draft.id || thread.entries.some((entry) => entry.id === draft.id)
    )?.id ?? draft.id;
}

export function getNestedThreadIdForEditDraft(
    threads: readonly CommentThread[],
    draft: DraftComment | null,
): string | null {
    if (!draft || draft.mode !== "edit") {
        return null;
    }

    if (draft.threadId) {
        return threads.find((thread) =>
            thread.id === draft.threadId || thread.entries.some((entry) => entry.id === draft.threadId)
        )?.id ?? null;
    }

    return threads.find((thread) =>
        thread.id === draft.id || thread.entries.some((entry) => entry.id === draft.id)
    )?.id ?? null;
}

export function getNestedThreadIdForAppendDraft(
    threads: readonly CommentThread[],
    draft: DraftComment | null,
): string | null {
    if (!draft || draft.mode !== "append" || !draft.threadId) {
        return null;
    }

    return threads.find((thread) =>
        thread.id === draft.threadId || thread.entries.some((entry) => entry.id === draft.threadId)
    )?.id ?? null;
}

export function shouldRenderTopLevelDraftComment(options: {
    draft: DraftComment | null;
    nestedAppendDraftThreadId: string | null;
    nestedEditDraftThreadId: string | null;
    isAgentIndexMode: boolean;
    agentThreadIds: ReadonlySet<string>;
}): DraftComment | null {
    const {
        draft,
        nestedAppendDraftThreadId,
        nestedEditDraftThreadId,
        isAgentIndexMode,
        agentThreadIds,
    } = options;

    if (!draft) {
        return null;
    }

    if (draft.mode === "append" && nestedAppendDraftThreadId) {
        return null;
    }

    if (draft.mode === "edit" && nestedEditDraftThreadId) {
        return null;
    }

    if (isAgentIndexMode && !agentThreadIds.has(draft.threadId ?? draft.id)) {
        return null;
    }

    return draft;
}

export function matchesPinnedSidebarDraftVisibility(
    draft: Pick<DraftComment, "mode" | "threadId">,
    pinnedThreadIds: ReadonlySet<string>,
): boolean {
    if (pinnedThreadIds.size === 0) {
        return true;
    }

    if (draft.mode === "new") {
        return true;
    }

    return !!draft.threadId && pinnedThreadIds.has(draft.threadId);
}

export function buildStoredOrderSidebarItems(
    threads: readonly CommentThread[],
    draft: DraftComment | null,
    replacedThreadId: string | null,
): SidebarRenderableItem[] {
    const items: SidebarRenderableItem[] = [];
    let insertedDraft = false;

    for (const thread of threads) {
        if (thread.id === replacedThreadId && draft) {
            items.push({ kind: "draft", draft });
            insertedDraft = true;
            continue;
        }

        items.push({ kind: "thread", thread });
    }

    if (draft && !insertedDraft) {
        const insertAt = items.findIndex((item) => (
            item.kind === "thread"
            && compareCommentsForSidebarOrder(draft, getSidebarSortCommentForThread(item.thread)) < 0
        ));
        if (insertAt === -1) {
            items.push({ kind: "draft", draft });
        } else {
            items.splice(insertAt, 0, { kind: "draft", draft });
        }
    }

    return items;
}

export function sortSidebarRenderableItems(items: readonly SidebarRenderableItem[]): SidebarRenderableItem[] {
    return items.slice().sort((left, right) => {
        const leftComment = left.kind === "thread" ? getSidebarSortCommentForThread(left.thread) : left.draft;
        const rightComment = right.kind === "thread" ? getSidebarSortCommentForThread(right.thread) : right.draft;
        return compareCommentsForIndexListOrder(leftComment, rightComment);
    });
}

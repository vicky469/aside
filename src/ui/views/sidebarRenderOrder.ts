import type { Comment, CommentThread } from "../../commentManager";
import { getFirstThreadEntry, threadEntryToComment } from "../../commentManager";
import { compareCommentsForSidebarOrder } from "../../core/anchors/commentSectionOrder";
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
    isAgentIndexMode: boolean;
    agentThreadIds: ReadonlySet<string>;
}): DraftComment | null {
    const {
        draft,
        nestedAppendDraftThreadId,
        isAgentIndexMode,
        agentThreadIds,
    } = options;

    if (!draft) {
        return null;
    }

    if (draft.mode === "append" && nestedAppendDraftThreadId) {
        return null;
    }

    if (isAgentIndexMode && !agentThreadIds.has(draft.threadId ?? draft.id)) {
        return null;
    }

    return draft;
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
        items.push({ kind: "draft", draft });
    }

    return items;
}

export function sortSidebarRenderableItems(items: readonly SidebarRenderableItem[]): SidebarRenderableItem[] {
    return items.slice().sort((left, right) => {
        const leftComment = left.kind === "thread" ? getSidebarSortCommentForThread(left.thread) : left.draft;
        const rightComment = right.kind === "thread" ? getSidebarSortCommentForThread(right.thread) : right.draft;
        return compareCommentsForSidebarOrder(leftComment, rightComment);
    });
}

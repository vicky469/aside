import { resolveAnchorRange } from "./core/anchors/anchorResolver";
import { getPageCommentLabel, isPageComment } from "./core/anchors/commentAnchors";

export type CommentAnchorKind = "selection" | "page";

export interface CommentThreadEntry {
    id: string;
    body: string;
    timestamp: number;
}

export interface CommentThread {
    id: string;
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
    resolved?: boolean;
    entries: CommentThreadEntry[];
    createdAt: number;
    updatedAt: number;
}

export interface Comment {
    id: string;
    filePath: string;
    startLine: number;
    startChar: number;
    endLine: number;
    endChar: number;
    selectedText: string;
    selectedTextHash: string;
    comment: string;
    timestamp: number;
    anchorKind?: CommentAnchorKind;
    orphaned?: boolean;
    resolved?: boolean;
    entryCount?: number;
}

export type ReorderPlacement = "before" | "after";

function compareThreadsByPosition(left: CommentThread, right: CommentThread): number {
    if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
    }
    if (left.startChar !== right.startChar) {
        return left.startChar - right.startChar;
    }
    return left.createdAt - right.createdAt;
}

function cloneThreadEntry(entry: CommentThreadEntry): CommentThreadEntry {
    return {
        id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
    };
}

export function cloneCommentThread(thread: CommentThread): CommentThread {
    return {
        ...thread,
        entries: thread.entries.map((entry) => cloneThreadEntry(entry)),
    };
}

export function cloneCommentThreads(threads: CommentThread[]): CommentThread[] {
    return threads.map((thread) => cloneCommentThread(thread));
}

export function getLatestThreadEntry(thread: CommentThread): CommentThreadEntry {
    return thread.entries[thread.entries.length - 1] ?? {
        id: thread.id,
        body: "",
        timestamp: thread.updatedAt || thread.createdAt,
    };
}

export function getFirstThreadEntry(thread: CommentThread): CommentThreadEntry {
    return thread.entries[0] ?? {
        id: thread.id,
        body: "",
        timestamp: thread.createdAt || thread.updatedAt,
    };
}

function normalizeThread(thread: CommentThread): CommentThread {
    const entries = thread.entries.length > 0
        ? thread.entries.map((entry) => cloneThreadEntry(entry))
        : [{
            id: thread.id,
            body: "",
            timestamp: thread.updatedAt || thread.createdAt,
        }];
    const firstEntry = entries[0];
    const latestEntry = entries[entries.length - 1];

    return {
        ...thread,
        anchorKind: thread.anchorKind === "page" ? "page" : "selection",
        orphaned: thread.anchorKind === "page" ? false : thread.orphaned === true,
        resolved: thread.resolved === true,
        entries,
        createdAt: thread.createdAt || firstEntry.timestamp,
        updatedAt: thread.updatedAt || latestEntry.timestamp,
    };
}

export function commentToThread(comment: Comment): CommentThread {
    return normalizeThread({
        id: comment.id,
        filePath: comment.filePath,
        startLine: comment.startLine,
        startChar: comment.startChar,
        endLine: comment.endLine,
        endChar: comment.endChar,
        selectedText: comment.selectedText,
        selectedTextHash: comment.selectedTextHash,
        anchorKind: comment.anchorKind === "page" ? "page" : "selection",
        orphaned: comment.orphaned === true,
        resolved: comment.resolved === true,
        entries: [{
            id: comment.id,
            body: comment.comment,
            timestamp: comment.timestamp,
        }],
        createdAt: comment.timestamp,
        updatedAt: comment.timestamp,
    });
}

export function threadToComment(thread: CommentThread): Comment {
    const normalized = normalizeThread(thread);
    const latestEntry = getLatestThreadEntry(normalized);
    return {
        ...threadEntryToComment(normalized, latestEntry),
        id: normalized.id,
    };
}

export function threadEntryToComment(thread: CommentThread, entry: CommentThreadEntry): Comment {
    const normalized = normalizeThread(thread);

    return {
        id: entry.id,
        filePath: normalized.filePath,
        startLine: normalized.startLine,
        startChar: normalized.startChar,
        endLine: normalized.endLine,
        endChar: normalized.endChar,
        selectedText: normalized.selectedText,
        selectedTextHash: normalized.selectedTextHash,
        comment: entry.body,
        timestamp: entry.timestamp,
        anchorKind: normalized.anchorKind,
        orphaned: normalized.orphaned === true,
        resolved: normalized.resolved === true,
        entryCount: normalized.entries.length,
    };
}

function isThreadLike(value: Comment | CommentThread): value is CommentThread {
    return Array.isArray((value as CommentThread).entries);
}

function moveItemByIdRelative<T extends { id: string }>(
    items: readonly T[],
    movedId: string,
    targetId: string,
    placement: ReorderPlacement,
): T[] | null {
    if (movedId === targetId) {
        return null;
    }

    const movedItem = items.find((item) => item.id === movedId);
    if (!movedItem) {
        return null;
    }

    const remainingItems = items.filter((item) => item.id !== movedId);
    const targetIndex = remainingItems.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) {
        return null;
    }

    const insertionIndex = placement === "before"
        ? targetIndex
        : targetIndex + 1;
    const nextItems = remainingItems.slice();
    nextItems.splice(insertionIndex, 0, movedItem);
    return nextItems;
}

export class CommentManager {
    private threads: CommentThread[];

    constructor(items: Array<Comment | CommentThread>) {
        this.threads = items.map((item) => normalizeThread(isThreadLike(item) ? item : commentToThread(item)));
    }

    getThreadsForFile(filePath: string): CommentThread[] {
        return this.threads
            .filter((thread) => thread.filePath === filePath)
            .map((thread) => cloneCommentThread(thread));
    }

    getThreadById(id: string): CommentThread | undefined {
        const thread = this.threads.find((candidate) =>
            candidate.id === id || candidate.entries.some((entry) => entry.id === id));
        return thread ? cloneCommentThread(thread) : undefined;
    }

    getAllThreads(): CommentThread[] {
        return this.threads.map((thread) => cloneCommentThread(thread));
    }

    getCommentsForFile(filePath: string): Comment[] {
        return this.threads
            .filter((thread) => thread.filePath === filePath)
            .map((thread) => threadToComment(thread));
    }

    getCommentById(id: string): Comment | undefined {
        const thread = this.threads.find((candidate) =>
            candidate.id === id || candidate.entries.some((entry) => entry.id === id));
        if (!thread) {
            return undefined;
        }

        const entry = thread.entries.find((candidate) => candidate.id === id) ?? getFirstThreadEntry(thread);
        return threadEntryToComment(thread, entry);
    }

    getAllComments(): Comment[] {
        return this.threads.map((thread) => threadToComment(thread));
    }

    replaceCommentsForFile(filePath: string, nextComments: Comment[]) {
        this.replaceThreadsForFile(
            filePath,
            nextComments.map((comment) => commentToThread(comment)),
        );
    }

    replaceThreadsForFile(filePath: string, nextThreads: CommentThread[]) {
        this.threads = this.threads
            .filter((thread) => thread.filePath !== filePath)
            .concat(nextThreads.map((thread) => normalizeThread(thread)));
    }

    addComment(newComment: Comment) {
        this.addThread(commentToThread(newComment));
    }

    addThread(newThread: CommentThread) {
        const normalizedThread = normalizeThread(newThread);
        const insertionIndex = this.threads.findIndex((thread) =>
            thread.filePath === normalizedThread.filePath
            && compareThreadsByPosition(normalizedThread, thread) < 0);

        if (insertionIndex === -1) {
            this.threads.push(normalizedThread);
            return;
        }

        this.threads.splice(insertionIndex, 0, normalizedThread);
    }

    appendEntry(threadId: string, entry: CommentThreadEntry) {
        const thread = this.threads.find((candidate) =>
            candidate.id === threadId || candidate.entries.some((candidateEntry) => candidateEntry.id === threadId));
        if (!thread) {
            return;
        }

        thread.entries.push(cloneThreadEntry(entry));
        thread.updatedAt = Math.max(thread.updatedAt, entry.timestamp);
    }

    reorderThreadsForFile(
        filePath: string,
        movedThreadId: string,
        targetThreadId: string,
        placement: ReorderPlacement,
    ): boolean {
        const fileThreads = this.threads.filter((thread) => thread.filePath === filePath);
        const reorderedThreads = moveItemByIdRelative(fileThreads, movedThreadId, targetThreadId, placement);
        if (!reorderedThreads) {
            return false;
        }

        const reorderedThreadIds = new Set(reorderedThreads.map((thread) => thread.id));
        const nextThreads: CommentThread[] = [];
        let inserted = false;

        for (const thread of this.threads) {
            if (thread.filePath !== filePath) {
                nextThreads.push(thread);
                continue;
            }

            if (!inserted) {
                nextThreads.push(...reorderedThreads);
                inserted = true;
            }

            if (!reorderedThreadIds.has(thread.id)) {
                nextThreads.push(thread);
            }
        }

        this.threads = nextThreads;
        return true;
    }

    reorderThreadEntries(
        threadId: string,
        movedEntryId: string,
        targetEntryId: string,
        placement: ReorderPlacement,
    ): boolean {
        const thread = this.threads.find((candidate) =>
            candidate.id === threadId || candidate.entries.some((entry) => entry.id === threadId));
        if (!thread || thread.entries.length < 3) {
            return false;
        }

        const parentEntry = thread.entries[0];
        const childEntries = thread.entries.slice(1);
        const reorderedChildEntries = moveItemByIdRelative(childEntries, movedEntryId, targetEntryId, placement);
        if (!reorderedChildEntries) {
            return false;
        }

        thread.entries = [parentEntry, ...reorderedChildEntries];
        return true;
    }

    editComment(id: string, newCommentText: string) {
        const thread = this.threads.find((candidate) =>
            candidate.id === id || candidate.entries.some((entry) => entry.id === id));
        if (!thread) {
            return;
        }

        const matchingEntry = thread.entries.find((entry) => entry.id === id) ?? thread.entries[0];
        if (!matchingEntry) {
            return;
        }

        matchingEntry.body = newCommentText;
    }

    deleteComment(id: string) {
        const indexToDelete = this.threads.findIndex((thread) =>
            thread.id === id || thread.entries.some((entry) => entry.id === id));
        if (indexToDelete === -1) {
            return;
        }

        const thread = this.threads[indexToDelete];
        if (thread.id === id) {
            this.threads.splice(indexToDelete, 1);
            return;
        }

        thread.entries = thread.entries.filter((entry) => entry.id !== id);
        if (!thread.entries.length) {
            this.threads.splice(indexToDelete, 1);
            return;
        }

        thread.updatedAt = Math.max(
            thread.createdAt,
            ...thread.entries.map((entry) => entry.timestamp),
        );
    }

    resolveComment(id: string) {
        const thread = this.threads.find((candidate) =>
            candidate.id === id || candidate.entries.some((entry) => entry.id === id));
        if (thread) {
            thread.resolved = true;
        }
    }

    unresolveComment(id: string) {
        const thread = this.threads.find((candidate) =>
            candidate.id === id || candidate.entries.some((entry) => entry.id === id));
        if (thread) {
            thread.resolved = false;
        }
    }

    reanchorCommentThread(
        id: string,
        anchor: {
            startLine: number;
            startChar: number;
            endLine: number;
            endChar: number;
            selectedText: string;
            selectedTextHash: string;
        },
    ) {
        const thread = this.threads.find((candidate) =>
            candidate.id === id || candidate.entries.some((entry) => entry.id === id));
        if (!thread) {
            return;
        }

        thread.startLine = anchor.startLine;
        thread.startChar = anchor.startChar;
        thread.endLine = anchor.endLine;
        thread.endChar = anchor.endChar;
        thread.selectedText = anchor.selectedText;
        thread.selectedTextHash = anchor.selectedTextHash;
        thread.anchorKind = "selection";
        thread.orphaned = false;
    }

    renameFile(oldPath: string, newPath: string) {
        this.threads.forEach((thread) => {
            if (thread.filePath === oldPath) {
                thread.filePath = newPath;
                if (isPageComment(thread)) {
                    thread.selectedText = getPageCommentLabel(newPath);
                    thread.orphaned = false;
                }
            }
        });
    }

    async updateCommentCoordinatesForFile(fileContent: string, filePath: string): Promise<void> {
        for (const thread of this.threads) {
            if (thread.filePath !== filePath) {
                continue;
            }

            if (isPageComment(thread)) {
                thread.orphaned = false;
                continue;
            }

            const newPosition = resolveAnchorRange(fileContent, thread);

            if (newPosition) {
                thread.startLine = newPosition.startLine;
                thread.startChar = newPosition.startChar;
                thread.endLine = newPosition.endLine;
                thread.endChar = newPosition.endChar;
                thread.selectedText = newPosition.text;
                thread.orphaned = false;
            } else {
                thread.orphaned = true;
            }
        }
    }
}

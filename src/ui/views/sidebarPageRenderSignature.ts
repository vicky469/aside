import type { CommentThread } from "../../commentManager";
import type { AgentRunRecord } from "../../core/agents/agentRuns";
import type { DraftComment } from "../../domain/drafts";

type SerializableThreadEntry = {
    id: string;
    body: string;
    timestamp: number;
    deletedAt: number | null;
};

type SerializableDraftComment = {
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
    anchorKind: DraftComment["anchorKind"] | null;
    isBookmark: boolean;
    orphaned: boolean;
    resolved: boolean;
    deletedAt: number | null;
    mode: DraftComment["mode"];
    threadId: string | null;
    appendAfterCommentId: string | null;
};

type SerializableAgentRun = {
    id: string;
    requestedAgent: AgentRunRecord["requestedAgent"];
    runtime: AgentRunRecord["runtime"];
    status: AgentRunRecord["status"];
    startedAt: number | null;
    endedAt: number | null;
    outputEntryId: string | null;
    error: string | null;
};

function serializeDraftComment(draft: DraftComment | null): SerializableDraftComment | null {
    if (!draft) {
        return null;
    }

    return {
        id: draft.id,
        filePath: draft.filePath,
        startLine: draft.startLine,
        startChar: draft.startChar,
        endLine: draft.endLine,
        endChar: draft.endChar,
        selectedText: draft.selectedText,
        selectedTextHash: draft.selectedTextHash,
        comment: draft.comment,
        timestamp: draft.timestamp,
        anchorKind: draft.anchorKind ?? null,
        isBookmark: draft.isBookmark === true,
        orphaned: draft.orphaned === true,
        resolved: draft.resolved === true,
        deletedAt: draft.deletedAt ?? null,
        mode: draft.mode,
        threadId: draft.threadId ?? null,
        appendAfterCommentId: draft.appendAfterCommentId ?? null,
    };
}

function serializeAgentRun(run: AgentRunRecord): SerializableAgentRun {
    return {
        id: run.id,
        requestedAgent: run.requestedAgent,
        runtime: run.runtime,
        status: run.status,
        startedAt: run.startedAt ?? null,
        endedAt: run.endedAt ?? null,
        outputEntryId: run.outputEntryId ?? null,
        error: run.error ?? null,
    };
}

function serializeThreadEntries(thread: CommentThread): SerializableThreadEntry[] {
    return thread.entries.map((entry) => ({
        id: entry.id,
        body: entry.body,
        timestamp: entry.timestamp,
        deletedAt: entry.deletedAt ?? null,
    }));
}

function isActiveCommentInThread(thread: CommentThread, activeCommentId: string | null): boolean {
    if (!activeCommentId) {
        return false;
    }

    if (thread.id === activeCommentId) {
        return true;
    }

    return thread.entries.some((entry) => entry.id === activeCommentId);
}

export function buildPageSidebarThreadRenderSignature(options: {
    thread: CommentThread;
    activeCommentId: string | null;
    showNestedComments: boolean;
    enablePageThreadReorder: boolean;
    editDraftComment: DraftComment | null;
    appendDraftComment: DraftComment | null;
    threadAgentRuns: readonly AgentRunRecord[];
}): string {
    const { thread } = options;
    return JSON.stringify({
        thread: {
            id: thread.id,
            filePath: thread.filePath,
            startLine: thread.startLine,
            startChar: thread.startChar,
            endLine: thread.endLine,
            endChar: thread.endChar,
            selectedText: thread.selectedText,
            selectedTextHash: thread.selectedTextHash,
            anchorKind: thread.anchorKind ?? null,
            isBookmark: thread.isBookmark === true,
            orphaned: thread.orphaned === true,
            resolved: thread.resolved === true,
            deletedAt: thread.deletedAt ?? null,
            createdAt: thread.createdAt,
            updatedAt: thread.updatedAt,
            entries: serializeThreadEntries(thread),
        },
        isActive: isActiveCommentInThread(thread, options.activeCommentId),
        showNestedComments: options.showNestedComments,
        enablePageThreadReorder: options.enablePageThreadReorder,
        editDraftComment: serializeDraftComment(options.editDraftComment),
        appendDraftComment: serializeDraftComment(options.appendDraftComment),
        threadAgentRuns: options.threadAgentRuns.map((run) => serializeAgentRun(run)),
    });
}

export function buildPageSidebarDraftRenderSignature(
    draft: DraftComment,
    activeCommentId: string | null,
): string {
    return JSON.stringify({
        draft: serializeDraftComment(draft),
        isActive: draft.id === activeCommentId,
    });
}

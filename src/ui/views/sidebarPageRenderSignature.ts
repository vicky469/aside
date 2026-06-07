import type { CommentThread } from "../../commentManager";
import type { AgentRunRecord } from "../../core/agents/agentRuns";
import type { DraftComment } from "../../domain/drafts";

function hashString(value: string): number {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }

    return hash >>> 0;
}

function hashStrings(values: readonly string[]): string {
    let hash = 2166136261;
    for (const value of values) {
        hash ^= hashString(value);
        hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(36);
}

const STRING_HASH_CACHE_LIMIT = 2048;
const cachedStringHashes = new Map<string, string>();

function getCachedStringHash(value: string): string {
    const cached = cachedStringHashes.get(value);
    if (cached !== undefined) {
        return cached;
    }

    const nextHash = hashString(value).toString(36);
    if (cachedStringHashes.size >= STRING_HASH_CACHE_LIMIT) {
        cachedStringHashes.clear();
    }
    cachedStringHashes.set(value, nextHash);
    return nextHash;
}

function getDraftIdentity(draft: DraftComment | null): string {
    if (!draft) {
        return "draft:none";
    }

    return [
        "draft",
        draft.id,
        draft.filePath,
        draft.startLine,
        draft.startChar,
        draft.endLine,
        draft.endChar,
        draft.selectedTextHash,
        draft.timestamp,
        draft.anchorKind ?? "",
        draft.orphaned === true ? 1 : 0,
        draft.deletedAt ?? "",
        draft.mode,
        draft.threadId ?? "",
        draft.appendAfterCommentId ?? "",
        getCachedStringHash(draft.comment),
    ].join("|");
}

function getThreadEntriesIdentity(thread: CommentThread): string {
    return hashStrings(thread.entries.map((entry) => [
        entry.id,
        entry.timestamp,
        entry.deletedAt ?? "",
        getCachedStringHash(entry.body),
    ].join(":")));
}

function getAgentRunsIdentity(runs: readonly AgentRunRecord[]): string {
    return hashStrings(runs.map((run) => [
        run.id,
        run.requestedAgent,
        run.runtime,
        run.status,
        run.startedAt ?? "",
        run.endedAt ?? "",
        run.outputEntryId ?? "",
        run.error ? getCachedStringHash(run.error) : "",
        run.usedSkills?.map((skill) => [skill.name, skill.mode ?? "", skill.source ?? ""].join("/")).join(",") ?? "",
        run.usedTools?.join(",") ?? "",
        run.usedUrls?.join(",") ?? "",
        run.usedToolErrors?.map((error) => [error.name, getCachedStringHash(error.payload)].join("/")).join(",") ?? "",
    ].join(":")));
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
    isPinned: boolean;
    showNestedComments: boolean;
    showNestedCommentsByDefault: boolean;
    isSelectedForTagBatch: boolean;
    enableTagSelection: boolean;
    enablePageThreadReorder: boolean;
    editDraftComment: DraftComment | null;
    appendDraftComment: DraftComment | null;
    threadAgentRuns: readonly AgentRunRecord[];
}): string {
    const { thread } = options;
    return [
        "thread",
        thread.id,
        thread.filePath,
        thread.startLine,
        thread.startChar,
        thread.endLine,
        thread.endChar,
        thread.selectedTextHash,
        thread.anchorKind ?? "",
        thread.orphaned === true ? 1 : 0,
        thread.deletedAt ?? "",
        thread.createdAt,
        thread.updatedAt,
        thread.isPinned === true ? 1 : 0,
        thread.entries.length,
        getThreadEntriesIdentity(thread),
        isActiveCommentInThread(thread, options.activeCommentId) ? 1 : 0,
        options.isSelectedForTagBatch ? 1 : 0,
        options.isPinned ? 1 : 0,
        options.showNestedComments ? 1 : 0,
        options.showNestedCommentsByDefault ? 1 : 0,
        options.enableTagSelection ? 1 : 0,
        options.enablePageThreadReorder ? 1 : 0,
        getDraftIdentity(options.editDraftComment),
        getDraftIdentity(options.appendDraftComment),
        getAgentRunsIdentity(options.threadAgentRuns),
    ].join("|");
}

export function buildPageSidebarDraftRenderSignature(
    draft: DraftComment,
    activeCommentId: string | null,
): string {
    return [
        getDraftIdentity(draft),
        draft.id === activeCommentId ? 1 : 0,
    ].join("|");
}

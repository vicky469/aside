import type { CommentThread, CommentThreadEntry } from "../../domain/comments/commentThread";

export const SOFT_DELETE_RETENTION_MS = 1 * 24 * 60 * 60 * 1000;

export interface DeletedCommentLike {
    deletedAt?: number;
}

export function normalizeDeletedAt(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : undefined;
}

export function isSoftDeleted(comment: DeletedCommentLike): boolean {
    return typeof comment.deletedAt === "number";
}

export function isSoftDeletedExpired(
    deletedAt: number | undefined,
    now: number = Date.now(),
): boolean {
    return typeof deletedAt === "number"
        && deletedAt + SOFT_DELETE_RETENTION_MS <= now;
}

export function hasDeletedComments(thread: Pick<CommentThread, "deletedAt" | "entries">): boolean {
    return isSoftDeleted(thread) || thread.entries.some((entry) => isSoftDeleted(entry));
}

export function countDeletedComments(threads: readonly Pick<CommentThread, "deletedAt" | "entries">[]): number {
    return threads.reduce((count, thread) => (
        count
        + (isSoftDeleted(thread) ? 1 : 0)
        + (isSoftDeleted(thread) ? 0 : thread.entries.reduce((entryCount, entry) => (
            entryCount + (isSoftDeleted(entry) ? 1 : 0)
        ), 0))
    ), 0);
}

export function purgeExpiredDeletedEntries(
    entries: readonly CommentThreadEntry[],
    now: number = Date.now(),
): CommentThreadEntry[] {
    return entries
        .filter((entry) => !isSoftDeletedExpired(entry.deletedAt, now))
        .map((entry) => ({
            ...entry,
            deletedAt: normalizeDeletedAt(entry.deletedAt),
        }));
}

export function purgeExpiredDeletedThreads(
    threads: readonly CommentThread[],
    now: number = Date.now(),
): CommentThread[] {
    const nextThreads: CommentThread[] = [];
    for (const thread of threads) {
        if (isSoftDeletedExpired(thread.deletedAt, now)) {
            continue;
        }

        const entries = purgeExpiredDeletedEntries(thread.entries, now);
        if (!entries.length) {
            continue;
        }

        nextThreads.push({
            ...thread,
            deletedAt: normalizeDeletedAt(thread.deletedAt),
            entries,
        });
    }

    return nextThreads;
}

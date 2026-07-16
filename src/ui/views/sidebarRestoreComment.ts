import { countDeletedComments } from "../../core/rules/deletedCommentVisibility";
import type { CommentThread } from "../../domain/comments/commentThread";

export interface SidebarRestoreCommentHost {
    getThreadById(commentId: string): CommentThread | null | undefined;
    restoreComment(commentId: string): Promise<boolean>;
    setShowNestedCommentsForThread(threadId: string, show: boolean): Promise<boolean | void> | boolean | void;
    shouldShowDeletedComments(): boolean;
    getThreadsForFile(filePath: string, options: { includeDeleted: true }): CommentThread[];
    setShowDeletedComments(show: boolean): Promise<boolean | void> | boolean | void;
    highlightComment(commentId: string): void;
}

export async function restoreSidebarComment(
    commentId: string,
    host: SidebarRestoreCommentHost,
): Promise<boolean> {
    const thread = host.getThreadById(commentId);
    const restored = await host.restoreComment(commentId);
    if (!restored) {
        return false;
    }

    if (thread && thread.id !== commentId) {
        await host.setShowNestedCommentsForThread(thread.id, true);
    }

    const remainingDeletedCount = thread
        ? countDeletedComments(host.getThreadsForFile(thread.filePath, { includeDeleted: true }))
        : 0;
    const stayInTrash = host.shouldShowDeletedComments() && remainingDeletedCount > 0;
    if (stayInTrash) {
        return true;
    }

    if (host.shouldShowDeletedComments()) {
        await host.setShowDeletedComments(false);
    }
    host.highlightComment(commentId);
    return true;
}

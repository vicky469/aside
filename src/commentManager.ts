import { resolveAnchorRange } from "./core/anchorResolver";
import { getPageCommentLabel, isPageComment } from "./core/commentAnchors";

export type CommentAnchorKind = "selection" | "page";

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
}

export class CommentManager {
    private comments: Comment[];

    constructor(comments: Comment[]) {
        this.comments = comments;
    }

    getCommentsForFile(filePath: string): Comment[] {
        return this.comments.filter(comment => comment.filePath === filePath);
    }

    getCommentById(id: string): Comment | undefined {
        return this.comments.find(comment => comment.id === id);
    }

    replaceCommentsForFile(filePath: string, nextComments: Comment[]) {
        this.comments = this.comments
            .filter(comment => comment.filePath !== filePath)
            .concat(nextComments);
    }

    addComment(newComment: Comment) {
        this.comments.push(newComment);
    }

    editComment(id: string, newCommentText: string) {
        const commentToEdit = this.comments.find(comment => comment.id === id);
        if (commentToEdit) {
            commentToEdit.comment = newCommentText;
        }
    }

    deleteComment(id: string) {
        const indexToDelete = this.comments.findIndex(comment => comment.id === id);
        if (indexToDelete > -1) {
            this.comments.splice(indexToDelete, 1);
        }
    }

    /**
     * Mark a comment as resolved (hidden but preserved for audit trail)
     * @param id The id of the comment to resolve
     */
    resolveComment(id: string) {
        const comment = this.comments.find(c => c.id === id);
        if (comment) {
            comment.resolved = true;
        }
    }

    /**
     * Mark a comment as unresolved (reopened)
     * @param id The id of the comment to unresolve
     */
    unresolveComment(id: string) {
        const comment = this.comments.find(c => c.id === id);
        if (comment) {
            comment.resolved = false;
        }
    }

    renameFile(oldPath: string, newPath: string) {
        this.comments.forEach(comment => {
            if (comment.filePath === oldPath) {
                comment.filePath = newPath;
                if (isPageComment(comment)) {
                    comment.selectedText = getPageCommentLabel(newPath);
                    comment.orphaned = false;
                }
            }
        });
    }

    /**
     * Update comment coordinates based on file content changes
     * Resolves anchors against the full document so multiline selections and repeated
     * phrases can be re-matched by proximity to their stored coordinates.
     * @param fileContent The current file content
     * @param filePath The path of the file that was changed
     */
    async updateCommentCoordinatesForFile(fileContent: string, filePath: string): Promise<void> {
        for (const comment of this.comments) {
            if (comment.filePath !== filePath) {
                continue;
            }

            if (isPageComment(comment)) {
                comment.orphaned = false;
                continue;
            }

            const newPosition = resolveAnchorRange(fileContent, comment);

            // Preserve comments even when the anchor temporarily disappears. This avoids
            // destructive data loss during copy/paste and in-progress edits.
            if (newPosition) {
                comment.startLine = newPosition.startLine;
                comment.startChar = newPosition.startChar;
                comment.endLine = newPosition.endLine;
                comment.endChar = newPosition.endChar;
                comment.selectedText = newPosition.text;
                comment.orphaned = false;
            } else {
                comment.orphaned = true;
            }
        }
    }
}

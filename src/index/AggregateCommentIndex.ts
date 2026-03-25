import type { Comment } from "../commentManager";

function cloneComments(comments: Comment[]): Comment[] {
    return comments.map((comment) => ({ ...comment }));
}

export class AggregateCommentIndex {
    private commentsByFile = new Map<string, Comment[]>();

    updateFile(filePath: string, comments: Comment[]): void {
        if (!comments.length) {
            this.commentsByFile.delete(filePath);
            return;
        }

        this.commentsByFile.set(filePath, cloneComments(comments));
    }

    renameFile(oldPath: string, newPath: string): void {
        const comments = this.commentsByFile.get(oldPath);
        this.commentsByFile.delete(oldPath);
        if (!comments?.length) {
            return;
        }

        this.commentsByFile.set(
            newPath,
            comments.map((comment) => ({ ...comment, filePath: newPath }))
        );
    }

    deleteFile(filePath: string): void {
        this.commentsByFile.delete(filePath);
    }

    getAllComments(): Comment[] {
        return Array.from(this.commentsByFile.values()).flatMap((comments) => cloneComments(comments));
    }
}

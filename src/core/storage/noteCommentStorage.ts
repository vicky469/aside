import type { Comment, CommentThread } from "../../commentManager";

export interface ParsedNoteComments {
    mainContent: string;
    comments: Comment[];
    threads: CommentThread[];
}

function normalizeSourceContent(noteContent: string): string {
    return noteContent.replace(/\r\n/g, "\n").trimEnd();
}

export function sortCommentsByPosition(comments: Comment[]): Comment[] {
    return comments
        .map((comment) => ({ ...comment }))
        .sort((left, right) => {
            if (left.startLine !== right.startLine) {
                return left.startLine - right.startLine;
            }
            if (left.startChar !== right.startChar) {
                return left.startChar - right.startChar;
            }
            return left.timestamp - right.timestamp;
        });
}

export function parseNoteComments(noteContent: string, _filePath: string): ParsedNoteComments {
    return {
        mainContent: normalizeSourceContent(noteContent),
        comments: [],
        threads: [],
    };
}

export function getVisibleNoteContent(noteContent: string): string {
    return noteContent.replace(/\r\n/g, "\n");
}

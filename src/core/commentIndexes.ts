import type { Comment } from "../commentManager";
import type { ParsedNoteComments } from "./noteCommentStorage";

function cloneComments(comments: Comment[]): Comment[] {
    return comments.map((comment) => ({ ...comment }));
}

export class ParsedNoteCache {
    private cache = new Map<string, { noteContent: string; parsed: ParsedNoteComments }>();

    constructor(private readonly maxEntries: number) {}

    getOrParse(
        filePath: string,
        noteContent: string,
        parse: (noteContent: string, filePath: string) => ParsedNoteComments,
    ): ParsedNoteComments {
        const cached = this.cache.get(filePath);
        if (cached && cached.noteContent === noteContent) {
            this.cache.delete(filePath);
            this.cache.set(filePath, cached);
            return {
                mainContent: cached.parsed.mainContent,
                comments: cloneComments(cached.parsed.comments),
            };
        }

        const parsed = parse(noteContent, filePath);
        this.cache.set(filePath, {
            noteContent,
            parsed: {
                mainContent: parsed.mainContent,
                comments: cloneComments(parsed.comments),
            },
        });

        while (this.cache.size > this.maxEntries) {
            const oldestKey = this.cache.keys().next().value;
            if (!oldestKey) {
                break;
            }
            this.cache.delete(oldestKey);
        }

        return {
            mainContent: parsed.mainContent,
            comments: cloneComments(parsed.comments),
        };
    }

    clear(filePath: string): void {
        this.cache.delete(filePath);
    }
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

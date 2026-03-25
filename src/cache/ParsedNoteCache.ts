import type { Comment } from "../commentManager";
import type { ParsedNoteComments } from "../core/noteCommentStorage";

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

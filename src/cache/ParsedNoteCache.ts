import type { Comment } from "../commentManager";
import { cloneCommentThreads } from "../commentManager";
import type { ParsedNoteComments } from "../core/storage/noteCommentStorage";

function cloneComments(comments: Comment[]): Comment[] {
    return comments.map((comment) => ({ ...comment }));
}

function cloneParsed(parsed: ParsedNoteComments): ParsedNoteComments {
    return {
        mainContent: parsed.mainContent,
        comments: cloneComments(parsed.comments),
        threads: cloneCommentThreads(parsed.threads),
    };
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
            return cloneParsed(cached.parsed);
        }

        const parsed = parse(noteContent, filePath);
        this.cache.set(filePath, {
            noteContent,
            parsed: cloneParsed(parsed),
        });

        while (this.cache.size > this.maxEntries) {
            const oldestEntry = this.cache.keys().next();
            if (oldestEntry.done) {
                break;
            }
            this.cache.delete(oldestEntry.value);
        }

        return cloneParsed(parsed);
    }

    clear(filePath: string): void {
        this.cache.delete(filePath);
    }
}

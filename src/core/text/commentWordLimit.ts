export const MAX_SIDENOTE_WORDS = 200;

export function countCommentWords(text: string): number {
    const normalized = text.trim();
    if (!normalized) {
        return 0;
    }

    return normalized.split(/\s+/).length;
}

export function exceedsCommentWordLimit(text: string): boolean {
    return countCommentWords(text) > MAX_SIDENOTE_WORDS;
}

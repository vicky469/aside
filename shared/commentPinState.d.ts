export interface CommentPinState {
    isPinned?: boolean;
    pinUpdatedAt?: number;
}
export function normalizeCommentPinState(value: unknown): CommentPinState;
export function mergeCommentPinState(current: unknown, incoming: unknown): CommentPinState;

import type { CommentThread, ReorderPlacement } from "./commentThread";

export function compareThreadsByPosition(left: CommentThread, right: CommentThread): number {
    if (left.startLine !== right.startLine) {
        return left.startLine - right.startLine;
    }
    if (left.startChar !== right.startChar) {
        return left.startChar - right.startChar;
    }
    return left.createdAt - right.createdAt;
}

export function moveItemByIdRelative<T extends { id: string }>(
    items: readonly T[],
    movedId: string,
    targetId: string,
    placement: ReorderPlacement,
): T[] | null {
    if (movedId === targetId) {
        return null;
    }

    const movedItem = items.find((item) => item.id === movedId);
    if (!movedItem) {
        return null;
    }

    const remainingItems = items.filter((item) => item.id !== movedId);
    const targetIndex = remainingItems.findIndex((item) => item.id === targetId);
    if (targetIndex === -1) {
        return null;
    }

    const insertionIndex = placement === "before"
        ? targetIndex
        : targetIndex + 1;
    const nextItems = remainingItems.slice();
    nextItems.splice(insertionIndex, 0, movedItem);
    return nextItems;
}

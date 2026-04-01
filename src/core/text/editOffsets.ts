import type { ManagedSectionEdit } from "../storage/noteCommentStorage";

export function remapSelectionOffsetAfterManagedSectionEdit(offset: number, edit: ManagedSectionEdit): number {
    if (offset <= edit.fromOffset) {
        return offset;
    }

    if (offset >= edit.toOffset) {
        return offset + edit.replacement.length - (edit.toOffset - edit.fromOffset);
    }

    return edit.fromOffset;
}

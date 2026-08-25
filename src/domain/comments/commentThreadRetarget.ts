import { getPageCommentLabel } from "../../core/anchors/commentAnchors";
import type { CommentThread } from "./commentThread";
import { cloneCommentThread } from "./commentThreadNormalization";

export interface CommentThreadRetargetOptions {
    selectionCapable: boolean;
    pageLabelHash: string;
}

export function retargetCommentThreads(
    threads: readonly CommentThread[],
    filePath: string,
    options: CommentThreadRetargetOptions,
): CommentThread[] {
    const pageLabel = getPageCommentLabel(filePath);

    return threads.map((sourceThread) => {
        const thread = cloneCommentThread(sourceThread);
        const entries = thread.entries.map((entry) => {
            if (!entry.anchor) {
                return entry;
            }

            if (!options.selectionCapable) {
                delete entry.anchor;
                return entry;
            }

            entry.anchor.filePath = filePath;
            return entry;
        });
        const isPageThread = thread.anchorKind === "page" || !options.selectionCapable;

        if (!isPageThread) {
            return {
                ...thread,
                filePath,
                entries,
            };
        }

        return {
            ...thread,
            filePath,
            ...(!options.selectionCapable ? {
                startLine: 0,
                startChar: 0,
                endLine: 0,
                endChar: 0,
            } : {}),
            selectedText: pageLabel,
            selectedTextHash: options.pageLabelHash,
            anchorKind: "page",
            orphaned: false,
            entries,
        };
    });
}

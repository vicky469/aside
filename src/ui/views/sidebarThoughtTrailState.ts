import type { Comment, CommentThread } from "../../commentManager";
import {
    buildThoughtTrailLines,
    type ThoughtTrailBuildOptions,
} from "../../core/derived/thoughtTrail";
import type { SidebarPrimaryMode } from "./viewState";

export function hasAvailableThoughtTrail(options: {
    allCommentsNotePath: string;
    comments: Array<Comment | CommentThread>;
    hasRootScope: boolean;
    resolveWikiLinkPath: ThoughtTrailBuildOptions["resolveWikiLinkPath"];
    vaultName: string;
}): boolean {
    if (!options.hasRootScope) {
        return false;
    }

    return buildThoughtTrailLines(options.vaultName, options.comments, {
        allCommentsNotePath: options.allCommentsNotePath,
        resolveWikiLinkPath: options.resolveWikiLinkPath,
    }).length > 0;
}

export function mergeCurrentFileThreadsForThoughtTrail(
    indexedThreads: CommentThread[],
    currentFilePath: string,
    currentFileThreads: CommentThread[],
): CommentThread[] {
    return indexedThreads
        .filter((thread) => thread.filePath !== currentFilePath)
        .concat(currentFileThreads);
}

export function resolveModeWithThoughtTrailAvailability(
    mode: SidebarPrimaryMode,
    isThoughtTrailEnabled: boolean,
): SidebarPrimaryMode {
    return mode === "thought-trail" && !isThoughtTrailEnabled
        ? "list"
        : mode;
}

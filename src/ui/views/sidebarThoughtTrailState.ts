import type { Comment, CommentThread } from "../../commentManager";
import {
    type ThoughtTrailBuildOptions,
} from "../../core/derived/thoughtTrail";
import {
    buildThoughtTrailNoteLinkGraph,
    buildThoughtTrailNoteLinkLines,
} from "../../core/derived/thoughtTrailNoteLinkGraph";
import type { SidebarPrimaryMode } from "./viewState";

export function hasAvailableThoughtTrail(options: {
    allCommentsNotePath: string;
    comments: Array<Comment | CommentThread>;
    hasRootScope: boolean;
    rootFilePath?: string | null;
    resolveWikiLinkPath: ThoughtTrailBuildOptions["resolveWikiLinkPath"];
    sourceMarkdownFilePaths?: readonly string[];
    getSourceMarkdownLinks?: (sourceFilePath: string) => readonly string[];
    getSourceMarkdownEmbeds?: (sourceFilePath: string) => readonly string[];
    resolveSourceMarkdownLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
    vaultName: string;
}): boolean {
    if (!options.hasRootScope) {
        return false;
    }

    const graph = buildThoughtTrailNoteLinkGraph(options.comments, {
        allCommentsNotePath: options.allCommentsNotePath,
        sourceMarkdownFilePaths: options.sourceMarkdownFilePaths,
        getSourceMarkdownLinks: options.getSourceMarkdownLinks,
        getSourceMarkdownEmbeds: options.getSourceMarkdownEmbeds,
        resolveSideNoteWikiLinkPath: options.resolveWikiLinkPath,
        resolveSourceMarkdownLinkPath: options.resolveSourceMarkdownLinkPath,
    });
    return buildThoughtTrailNoteLinkLines(options.vaultName, graph, options.rootFilePath).length > 0;
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

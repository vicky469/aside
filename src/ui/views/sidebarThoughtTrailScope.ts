import type { CommentThread } from "../../commentManager";
import {
    buildThoughtTrailNoteLinkGraph,
    getThoughtTrailNoteLinkConnectedComponent,
    type ThoughtTrailNoteLinkGraph,
} from "../../core/derived/thoughtTrailNoteLinkGraph";
import { filterCommentsByFilePaths } from "./indexFileFilter";

export function buildRootedThoughtTrailScope(
    threads: CommentThread[],
    options: {
        rootFilePath: string;
        allCommentsNotePath: string;
        resolveWikiLinkPath: (linkPath: string, sourceFilePath: string) => string | null;
        sourceMarkdownFilePaths?: readonly string[];
        getSourceMarkdownLinks?: (sourceFilePath: string) => readonly string[];
        getSourceMarkdownEmbeds?: (sourceFilePath: string) => readonly string[];
        resolveSourceMarkdownLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
    },
): {
    scopedFilePaths: string[];
    scopedThreads: CommentThread[];
    thoughtTrailGraph: ThoughtTrailNoteLinkGraph;
} {
    const graph = buildThoughtTrailNoteLinkGraph(threads, {
        allCommentsNotePath: options.allCommentsNotePath,
        sourceMarkdownFilePaths: options.sourceMarkdownFilePaths,
        getSourceMarkdownLinks: options.getSourceMarkdownLinks,
        getSourceMarkdownEmbeds: options.getSourceMarkdownEmbeds,
        resolveSideNoteWikiLinkPath: options.resolveWikiLinkPath,
        resolveSourceMarkdownLinkPath: options.resolveSourceMarkdownLinkPath,
    });
    const scopedFilePaths = getThoughtTrailNoteLinkConnectedComponent(graph, options.rootFilePath);

    return {
        scopedFilePaths,
        scopedThreads: scopedFilePaths.length
            ? filterCommentsByFilePaths(threads, scopedFilePaths)
            : [],
        thoughtTrailGraph: graph,
    };
}

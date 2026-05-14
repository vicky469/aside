import type { CommentThread } from "../../commentManager";
import {
    buildIndexFileFilterGraph,
    getIndexFileFilterConnectedComponent,
} from "../../core/derived/indexFileFilterGraph";
import { filterCommentsByFilePaths } from "./indexFileFilter";

export function buildRootedThoughtTrailScope(
    threads: CommentThread[],
    options: {
        rootFilePath: string;
        allCommentsNotePath: string;
        resolveWikiLinkPath: (linkPath: string, sourceFilePath: string) => string | null;
    },
): {
    scopedFilePaths: string[];
    scopedThreads: CommentThread[];
} {
    const graph = buildIndexFileFilterGraph(threads, {
        allCommentsNotePath: options.allCommentsNotePath,
        includeLinkedTargetFiles: true,
        resolveWikiLinkPath: options.resolveWikiLinkPath,
        showResolved: null,
    });
    const scopedFilePaths = getIndexFileFilterConnectedComponent(graph, options.rootFilePath);

    return {
        scopedFilePaths,
        scopedThreads: scopedFilePaths.length
            ? filterCommentsByFilePaths(threads, scopedFilePaths)
            : [],
    };
}

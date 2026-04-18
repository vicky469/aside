import type { Comment, CommentThread } from "../../commentManager";
import { filterCommentsByResolvedVisibility } from "../rules/resolvedCommentVisibility";
import { extractWikiLinks } from "../text/commentMentions";

const ALL_COMMENTS_NOTE_PATH = "SideNote2 index.md";
const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";

export interface IndexFileFilterGraphBuildOptions {
    allCommentsNotePath?: string;
    showResolved?: boolean | null;
    resolveWikiLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
}

export interface IndexFileFilterGraph {
    availableFiles: string[];
    fileCommentCounts: Map<string, number>;
    outgoingAdjacency: Map<string, Set<string>>;
    undirectedAdjacency: Map<string, Set<string>>;
    connectedComponentByFile: Map<string, string[]>;
    componentSizeByFile: Map<string, number>;
}

function isThreadLike(value: Comment | CommentThread): value is CommentThread {
    return Array.isArray((value as CommentThread).entries);
}

function getCommentBodies(value: Comment | CommentThread): string[] {
    if (isThreadLike(value)) {
        return value.entries.map((entry) => entry.body ?? "");
    }

    return [value.comment ?? ""];
}

function normalizeNotePath(filePath: string): string {
    const parts = filePath.replace(/\\/g, "/").split("/");
    const normalizedParts: string[] = [];

    for (const part of parts) {
        if (!part || part === ".") {
            continue;
        }

        if (part === "..") {
            normalizedParts.pop();
            continue;
        }

        normalizedParts.push(part);
    }

    return normalizedParts.join("/");
}

function isAllCommentsNotePath(filePath: string, currentPath: string = ALL_COMMENTS_NOTE_PATH): boolean {
    const normalizedPath = normalizeNotePath(filePath);
    return normalizedPath === normalizeNotePath(currentPath) || normalizedPath === LEGACY_ALL_COMMENTS_NOTE_PATH;
}

function toSortedPaths(paths: Iterable<string>): string[] {
    return Array.from(paths).sort((left, right) => left.localeCompare(right));
}

function ensureAdjacencySet(
    adjacency: Map<string, Set<string>>,
    filePath: string,
): Set<string> {
    const existing = adjacency.get(filePath);
    if (existing) {
        return existing;
    }

    const created = new Set<string>();
    adjacency.set(filePath, created);
    return created;
}

function buildConnectedComponents(
    availableFiles: readonly string[],
    undirectedAdjacency: Map<string, Set<string>>,
): {
    connectedComponentByFile: Map<string, string[]>;
    componentSizeByFile: Map<string, number>;
} {
    const connectedComponentByFile = new Map<string, string[]>();
    const componentSizeByFile = new Map<string, number>();
    const visited = new Set<string>();

    for (const rootFilePath of availableFiles) {
        if (visited.has(rootFilePath)) {
            continue;
        }

        const component = new Set<string>();
        const pending = [rootFilePath];
        visited.add(rootFilePath);

        while (pending.length) {
            const currentFilePath = pending.pop();
            if (!currentFilePath) {
                continue;
            }

            component.add(currentFilePath);
            for (const neighborFilePath of undirectedAdjacency.get(currentFilePath) ?? []) {
                if (visited.has(neighborFilePath)) {
                    continue;
                }

                visited.add(neighborFilePath);
                pending.push(neighborFilePath);
            }
        }

        const sortedComponent = toSortedPaths(component);
        for (const filePath of sortedComponent) {
            connectedComponentByFile.set(filePath, sortedComponent);
            componentSizeByFile.set(filePath, sortedComponent.length);
        }
    }

    return {
        connectedComponentByFile,
        componentSizeByFile,
    };
}

export function buildIndexFileFilterGraph(
    comments: Array<Comment | CommentThread>,
    options: IndexFileFilterGraphBuildOptions = {},
): IndexFileFilterGraph {
    const scopedComments = comments.filter((comment) => !isAllCommentsNotePath(comment.filePath, options.allCommentsNotePath));
    const visibleComments = options.showResolved === null
        ? scopedComments
        : filterCommentsByResolvedVisibility(scopedComments, options.showResolved ?? false);
    const fileCommentCounts = new Map<string, number>();

    for (const comment of visibleComments) {
        const filePath = normalizeNotePath(comment.filePath);
        fileCommentCounts.set(filePath, (fileCommentCounts.get(filePath) ?? 0) + 1);
    }

    const availableFiles = toSortedPaths(fileCommentCounts.keys());
    const availableFileSet = new Set(availableFiles);
    const outgoingAdjacency = new Map<string, Set<string>>();
    const undirectedAdjacency = new Map<string, Set<string>>();

    for (const filePath of availableFiles) {
        outgoingAdjacency.set(filePath, new Set());
        undirectedAdjacency.set(filePath, new Set());
    }

    if (options.resolveWikiLinkPath) {
        for (const comment of visibleComments) {
            const sourceFilePath = normalizeNotePath(comment.filePath);
            const outgoingTargets = ensureAdjacencySet(outgoingAdjacency, sourceFilePath);
            const sourceNeighbors = ensureAdjacencySet(undirectedAdjacency, sourceFilePath);
            const seenTargets = new Set<string>();

            for (const body of getCommentBodies(comment)) {
                for (const match of extractWikiLinks(body)) {
                    const resolvedPath = options.resolveWikiLinkPath(match.linkPath, comment.filePath);
                    if (!resolvedPath) {
                        continue;
                    }

                    const normalizedTargetPath = normalizeNotePath(resolvedPath);
                    if (
                        normalizedTargetPath === sourceFilePath
                        || isAllCommentsNotePath(normalizedTargetPath, options.allCommentsNotePath)
                        || !availableFileSet.has(normalizedTargetPath)
                        || seenTargets.has(normalizedTargetPath)
                    ) {
                        continue;
                    }

                    seenTargets.add(normalizedTargetPath);
                    outgoingTargets.add(normalizedTargetPath);
                    sourceNeighbors.add(normalizedTargetPath);
                    ensureAdjacencySet(undirectedAdjacency, normalizedTargetPath).add(sourceFilePath);
                }
            }
        }
    }

    const {
        connectedComponentByFile,
        componentSizeByFile,
    } = buildConnectedComponents(availableFiles, undirectedAdjacency);

    return {
        availableFiles,
        fileCommentCounts,
        outgoingAdjacency,
        undirectedAdjacency,
        connectedComponentByFile,
        componentSizeByFile,
    };
}

export function getIndexFileFilterConnectedComponent(
    graph: IndexFileFilterGraph,
    rootFilePath: string | null | undefined,
): string[] {
    if (!rootFilePath) {
        return [];
    }

    return graph.connectedComponentByFile.get(normalizeNotePath(rootFilePath))?.slice() ?? [];
}

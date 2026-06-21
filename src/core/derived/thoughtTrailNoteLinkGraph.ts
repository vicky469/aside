import type { Comment, CommentThread } from "../../commentManager";
import { extractWikiLinks } from "../text/commentMentions";
import {
    buildThoughtTrailLinesFromEdges,
    type ThoughtTrailRenderableEdge,
} from "./thoughtTrail";

const ALL_COMMENTS_NOTE_PATH = "Aside index.md";

export type ThoughtTrailNoteLinkEdgeSource = "side-note" | "source-markdown";

export interface ThoughtTrailNoteLinkGraphEdge extends ThoughtTrailRenderableEdge {
    source: ThoughtTrailNoteLinkEdgeSource;
}

export interface ThoughtTrailNoteLinkGraph {
    availableFiles: string[];
    edges: ThoughtTrailNoteLinkGraphEdge[];
    edgesBySourceFile: Map<string, ThoughtTrailNoteLinkGraphEdge[]>;
    undirectedAdjacency: Map<string, Set<string>>;
    connectedComponentByFile: Map<string, string[]>;
}

export interface ThoughtTrailNoteLinkGraphBuildOptions {
    allCommentsNotePath?: string;
    sourceMarkdownFilePaths?: readonly string[];
    getSourceMarkdownLinks?: (sourceFilePath: string) => readonly string[];
    getSourceMarkdownEmbeds?: (sourceFilePath: string) => readonly string[];
    resolveSideNoteWikiLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
    resolveSourceMarkdownLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
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

function getCommentTimestamp(value: Comment | CommentThread): number {
    return isThreadLike(value) ? value.createdAt : value.timestamp;
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
    return normalizeNotePath(filePath) === normalizeNotePath(currentPath);
}

function sortCommentItemsByPosition(items: Array<Comment | CommentThread>): Array<Comment | CommentThread> {
    return items.slice().sort((left, right) => {
        if (left.startLine !== right.startLine) {
            return left.startLine - right.startLine;
        }

        if (left.startChar !== right.startChar) {
            return left.startChar - right.startChar;
        }

        return getCommentTimestamp(left) - getCommentTimestamp(right);
    });
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

function createEdgePairKey(sourceFilePath: string, targetFilePath: string): string {
    return `${sourceFilePath}\u0000${targetFilePath}`;
}

function resolveTargetPath(
    linkPath: string,
    sourceFilePath: string,
    allCommentsNotePath: string | undefined,
    resolver: ((linkPath: string, sourceFilePath: string) => string | null) | undefined,
): string | null {
    if (!resolver) {
        return null;
    }

    const resolvedPath = resolver(linkPath, sourceFilePath);
    if (!resolvedPath) {
        return null;
    }

    const normalizedTargetPath = normalizeNotePath(resolvedPath);
    if (
        !normalizedTargetPath
        || normalizedTargetPath === sourceFilePath
        || isAllCommentsNotePath(normalizedTargetPath, allCommentsNotePath)
    ) {
        return null;
    }

    return normalizedTargetPath;
}

function buildConnectedComponents(
    availableFiles: readonly string[],
    undirectedAdjacency: Map<string, Set<string>>,
): Map<string, string[]> {
    const connectedComponentByFile = new Map<string, string[]>();
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
        }
    }

    return connectedComponentByFile;
}

function buildEdgesBySourceFile(edges: readonly ThoughtTrailNoteLinkGraphEdge[]): Map<string, ThoughtTrailNoteLinkGraphEdge[]> {
    const edgesBySourceFile = new Map<string, ThoughtTrailNoteLinkGraphEdge[]>();
    for (const edge of edges) {
        const existing = edgesBySourceFile.get(edge.sourceFilePath);
        if (existing) {
            existing.push(edge);
        } else {
            edgesBySourceFile.set(edge.sourceFilePath, [edge]);
        }
    }

    return edgesBySourceFile;
}

function addSideNoteEdges(
    comments: Array<Comment | CommentThread>,
    options: ThoughtTrailNoteLinkGraphBuildOptions,
    edges: ThoughtTrailNoteLinkGraphEdge[],
    availableFileSet: Set<string>,
): Set<string> {
    const sideNoteEdgePairs = new Set<string>();
    const commentsByFile = new Map<string, Array<Comment | CommentThread>>();
    for (const comment of comments) {
        const sourceFilePath = normalizeNotePath(comment.filePath);
        if (!sourceFilePath || isAllCommentsNotePath(sourceFilePath, options.allCommentsNotePath)) {
            continue;
        }

        availableFileSet.add(sourceFilePath);
        const existing = commentsByFile.get(sourceFilePath);
        if (existing) {
            existing.push(comment);
        } else {
            commentsByFile.set(sourceFilePath, [comment]);
        }
    }

    for (const sourceFilePath of toSortedPaths(commentsByFile.keys())) {
        const fileComments = sortCommentItemsByPosition(commentsByFile.get(sourceFilePath) ?? []);
        for (const comment of fileComments) {
            const seenTargets = new Set<string>();
            for (const body of getCommentBodies(comment)) {
                for (const match of extractWikiLinks(body)) {
                    const targetFilePath = resolveTargetPath(
                        match.linkPath,
                        sourceFilePath,
                        options.allCommentsNotePath,
                        options.resolveSideNoteWikiLinkPath,
                    );
                    if (!targetFilePath || seenTargets.has(targetFilePath)) {
                        continue;
                    }

                    seenTargets.add(targetFilePath);
                    availableFileSet.add(targetFilePath);
                    sideNoteEdgePairs.add(createEdgePairKey(sourceFilePath, targetFilePath));
                    edges.push({
                        sourceFilePath,
                        targetFilePath,
                        source: "side-note",
                        comment,
                    });
                }
            }
        }
    }

    return sideNoteEdgePairs;
}

function addSourceMarkdownEdges(
    options: ThoughtTrailNoteLinkGraphBuildOptions,
    sideNoteEdgePairs: Set<string>,
    edges: ThoughtTrailNoteLinkGraphEdge[],
    availableFileSet: Set<string>,
): void {
    if (!options.resolveSourceMarkdownLinkPath) {
        return;
    }

    for (const rawSourceFilePath of toSortedPaths(options.sourceMarkdownFilePaths ?? [])) {
        const sourceFilePath = normalizeNotePath(rawSourceFilePath);
        if (!sourceFilePath || isAllCommentsNotePath(sourceFilePath, options.allCommentsNotePath)) {
            continue;
        }

        availableFileSet.add(sourceFilePath);
        const seenTargets = new Set<string>();
        const references = [
            ...(options.getSourceMarkdownLinks?.(sourceFilePath) ?? []),
            ...(options.getSourceMarkdownEmbeds?.(sourceFilePath) ?? []),
        ];

        for (const linkPath of references) {
            const targetFilePath = resolveTargetPath(
                linkPath,
                sourceFilePath,
                options.allCommentsNotePath,
                options.resolveSourceMarkdownLinkPath,
            );
            if (!targetFilePath || seenTargets.has(targetFilePath)) {
                continue;
            }

            seenTargets.add(targetFilePath);
            availableFileSet.add(targetFilePath);
            if (sideNoteEdgePairs.has(createEdgePairKey(sourceFilePath, targetFilePath))) {
                continue;
            }

            edges.push({
                sourceFilePath,
                targetFilePath,
                source: "source-markdown",
            });
        }
    }
}

export function buildThoughtTrailNoteLinkGraph(
    comments: Array<Comment | CommentThread>,
    options: ThoughtTrailNoteLinkGraphBuildOptions = {},
): ThoughtTrailNoteLinkGraph {
    const edges: ThoughtTrailNoteLinkGraphEdge[] = [];
    const availableFileSet = new Set<string>();
    const sideNoteEdgePairs = addSideNoteEdges(comments, options, edges, availableFileSet);
    addSourceMarkdownEdges(options, sideNoteEdgePairs, edges, availableFileSet);

    const undirectedAdjacency = new Map<string, Set<string>>();
    for (const filePath of availableFileSet) {
        ensureAdjacencySet(undirectedAdjacency, filePath);
    }

    for (const edge of edges) {
        ensureAdjacencySet(undirectedAdjacency, edge.sourceFilePath).add(edge.targetFilePath);
        ensureAdjacencySet(undirectedAdjacency, edge.targetFilePath).add(edge.sourceFilePath);
    }

    const availableFiles = toSortedPaths(availableFileSet);
    const connectedComponentByFile = buildConnectedComponents(availableFiles, undirectedAdjacency);

    return {
        availableFiles,
        edges,
        edgesBySourceFile: buildEdgesBySourceFile(edges),
        undirectedAdjacency,
        connectedComponentByFile,
    };
}

export function getThoughtTrailNoteLinkConnectedComponent(
    graph: ThoughtTrailNoteLinkGraph,
    rootFilePath: string | null | undefined,
): string[] {
    if (!rootFilePath) {
        return [];
    }

    return graph.connectedComponentByFile.get(normalizeNotePath(rootFilePath))?.slice() ?? [];
}

export function buildThoughtTrailNoteLinkLines(
    vaultName: string,
    graph: ThoughtTrailNoteLinkGraph,
    rootFilePath?: string | null,
): string[] {
    const scopedFilePaths = rootFilePath
        ? getThoughtTrailNoteLinkConnectedComponent(graph, rootFilePath)
        : graph.availableFiles;
    if (!scopedFilePaths.length) {
        return [];
    }

    const scopedFileSet = new Set(scopedFilePaths);
    const scopedEdges = graph.edges.filter((edge) =>
        scopedFileSet.has(edge.sourceFilePath) && scopedFileSet.has(edge.targetFilePath)
    );

    return buildThoughtTrailLinesFromEdges(vaultName, scopedEdges);
}

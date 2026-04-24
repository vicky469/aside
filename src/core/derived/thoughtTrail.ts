import type { Comment, CommentThread } from "../../commentManager";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment, isPageComment } from "../anchors/commentAnchors";
import { extractWikiLinks } from "../text/commentMentions";
import { buildSideNoteReferenceUrl, extractSideNoteReferences } from "../text/commentReferences";

const ALL_COMMENTS_NOTE_PATH = "SideNote2 index.md";
const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";
const MAX_EDGE_LABEL_WORDS = 4;
const MAX_LOCAL_NODE_LABEL_WORDS = 6;
const THOUGHT_TRAIL_MERMAID_RENDER_CONFIG = {
    fontFamily: "var(--font-interface-theme)",
    themeVariables: {
        fontSize: "14px",
    },
    flowchart: {
        nodeSpacing: 3,
        // Keep enough vertical edge length that the connector line stays visible
        // between stacked note boxes without making the whole card oversized.
        rankSpacing: 14,
        padding: 3,
        diagramPadding: 0,
        useMaxWidth: false,
        htmlLabels: true,
    },
};
const THOUGHT_TRAIL_MERMAID_INIT = `%%{init: ${JSON.stringify(THOUGHT_TRAIL_MERMAID_RENDER_CONFIG)}}%%`;

export interface ThoughtTrailBuildOptions {
    allCommentsNotePath?: string;
    localVaultName?: string | null;
    resolveSideNoteReferencePath?: (commentId: string, filePathHint: string | null) => string | null;
    resolveWikiLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
}

interface ThoughtTrailEdge {
    comment: Comment | CommentThread;
    targetFilePath: string;
}

interface LocalThoughtTrailEdge {
    sourceComment: Comment | CommentThread;
    targetComment: Comment | CommentThread;
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

function sortCommentItemsByPosition(items: Array<Comment | CommentThread>): Array<Comment | CommentThread> {
    return items.slice().sort((left, right) => {
        if (left.startLine !== right.startLine) {
            return left.startLine - right.startLine;
        }

        if (left.startChar !== right.startChar) {
            return left.startChar - right.startChar;
        }

        const leftTimestamp = isThreadLike(left) ? left.createdAt : left.timestamp;
        const rightTimestamp = isThreadLike(right) ? right.createdAt : right.timestamp;
        return leftTimestamp - rightTimestamp;
    });
}

function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
}

function stripMarkdownSyntax(value: string): string {
    return value
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1")
        .replace(/[*_~`>#=-]+/g, " ")
        .replace(/\s+/g, " ")
        .trim();
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
    return filePath === normalizeNotePath(currentPath) || filePath === LEGACY_ALL_COMMENTS_NOTE_PATH;
}

function toInlineWordPreview(value: string, maxWords: number): string {
    const normalized = value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "(blank selection)";
    }

    const words = normalized.split(" ").filter(Boolean);
    if (words.length <= maxWords) {
        return normalized;
    }

    return `${words.slice(0, maxWords).join(" ")}...`;
}

function getCommentItemId(value: Comment | CommentThread): string {
    return value.id;
}

function buildNoteOpenUrl(vaultName: string, filePath: string): string {
    return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(normalizeNotePath(filePath))}`;
}

function toMermaidText(value: string): string {
    return value
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim()
        .replace(/["`]/g, "'")
        .replace(/[|{}[\]]/g, " ");
}

function formatEdgeLabel(comment: Comment | CommentThread): string | null {
    let label: string;
    if (isPageComment(comment)) {
        return null;
    } else {
        const selectedPreview = toInlineWordPreview(getCommentSelectionLabel(comment), MAX_EDGE_LABEL_WORDS);
        label = isAnchoredComment(comment)
            ? selectedPreview
            : `${getCommentStatusLabel(comment)}: ${selectedPreview}`;
    }

    if (comment.resolved) {
        return `${label} (resolved)`;
    }

    return toMermaidText(label);
}

function formatLocalNodeBaseLabel(comment: Comment | CommentThread): string {
    const selectedPreview = toInlineWordPreview(getCommentSelectionLabel(comment), MAX_LOCAL_NODE_LABEL_WORDS);
    const firstBodyPreview = getCommentBodies(comment)
        .map((body) => toInlineWordPreview(stripMarkdownSyntax(body), MAX_LOCAL_NODE_LABEL_WORDS))
        .find((preview) => preview && preview !== "(blank selection)");
    const label = isPageComment(comment)
        ? firstBodyPreview || selectedPreview
        : isAnchoredComment(comment)
            ? selectedPreview
            : `${getCommentStatusLabel(comment)} · ${selectedPreview}`;

    return comment.resolved
        ? `${label} (resolved)`
        : label;
}

function buildUniqueLocalNodeLabels(comments: Array<Comment | CommentThread>): Map<string, string> {
    const countsByBaseLabel = new Map<string, number>();
    for (const comment of comments) {
        const baseLabel = formatLocalNodeBaseLabel(comment);
        countsByBaseLabel.set(baseLabel, (countsByBaseLabel.get(baseLabel) ?? 0) + 1);
    }

    const seenByBaseLabel = new Map<string, number>();
    const labels = new Map<string, string>();
    for (const comment of comments) {
        const baseLabel = formatLocalNodeBaseLabel(comment);
        const duplicateCount = countsByBaseLabel.get(baseLabel) ?? 0;
        if (duplicateCount <= 1) {
            labels.set(getCommentItemId(comment), baseLabel);
            continue;
        }

        const occurrence = (seenByBaseLabel.get(baseLabel) ?? 0) + 1;
        seenByBaseLabel.set(baseLabel, occurrence);
        labels.set(getCommentItemId(comment), `${baseLabel} · ${occurrence}`);
    }

    return labels;
}

function buildLocalThoughtTrailEdges(
    comments: Array<Comment | CommentThread>,
    options: {
        allCommentsNotePath?: string;
        localVaultName?: string | null;
        rootFilePath: string;
    },
): LocalThoughtTrailEdge[] {
    const normalizedRootFilePath = normalizeNotePath(options.rootFilePath);
    const commentById = new Map<string, Comment | CommentThread>();
    for (const comment of comments) {
        commentById.set(getCommentItemId(comment), comment);
        if (!isThreadLike(comment)) {
            continue;
        }

        for (const entry of comment.entries) {
            commentById.set(entry.id, comment);
        }
    }

    const edges: LocalThoughtTrailEdge[] = [];
    for (const comment of sortCommentItemsByPosition(comments)) {
        const seenTargetCommentIds = new Set<string>();
        for (const body of getCommentBodies(comment)) {
            for (const reference of extractSideNoteReferences(body, {
                localOnly: true,
                localVaultName: options.localVaultName ?? null,
            })) {
                const targetComment = commentById.get(reference.target.commentId);
                if (!targetComment) {
                    continue;
                }

                if (
                    normalizeNotePath(targetComment.filePath) !== normalizedRootFilePath
                    || isAllCommentsNotePath(targetComment.filePath, options.allCommentsNotePath)
                ) {
                    continue;
                }

                const sourceCommentId = getCommentItemId(comment);
                const targetCommentId = getCommentItemId(targetComment);
                if (sourceCommentId === targetCommentId || seenTargetCommentIds.has(targetCommentId)) {
                    continue;
                }

                seenTargetCommentIds.add(targetCommentId);
                edges.push({
                    sourceComment: comment,
                    targetComment,
                });
            }
        }
    }

    return edges;
}

function formatNodeLabel(filePath: string): string {
    return normalizeNotePath(filePath).replace(/\.md$/i, "");
}

function splitPathLabelSegments(filePath: string): string[] {
    const normalized = formatNodeLabel(filePath);
    return normalized.split("/").filter(Boolean);
}

function buildCompactNodeLabels(filePaths: Iterable<string>): Map<string, string> {
    const uniqueFilePaths = Array.from(new Set(
        Array.from(filePaths, (filePath) => normalizeNotePath(filePath)).filter(Boolean),
    )).sort((left, right) => left.localeCompare(right));
    const segmentsByFilePath = new Map(uniqueFilePaths.map((filePath) => [filePath, splitPathLabelSegments(filePath)]));
    const depthsByFilePath = new Map(uniqueFilePaths.map((filePath) => [filePath, 1]));

    while (true) {
        const labelsByValue = new Map<string, string[]>();
        for (const filePath of uniqueFilePaths) {
            const segments = segmentsByFilePath.get(filePath) ?? [formatNodeLabel(filePath)];
            const depth = depthsByFilePath.get(filePath) ?? 1;
            const label = segments.slice(-depth).join("/");
            const matchedFilePaths = labelsByValue.get(label);
            if (matchedFilePaths) {
                matchedFilePaths.push(filePath);
            } else {
                labelsByValue.set(label, [filePath]);
            }
        }

        let updated = false;
        for (const matchedFilePaths of labelsByValue.values()) {
            if (matchedFilePaths.length <= 1) {
                continue;
            }

            for (const filePath of matchedFilePaths) {
                const segments = segmentsByFilePath.get(filePath) ?? [formatNodeLabel(filePath)];
                const currentDepth = depthsByFilePath.get(filePath) ?? 1;
                if (currentDepth >= segments.length) {
                    continue;
                }

                depthsByFilePath.set(filePath, currentDepth + 1);
                updated = true;
            }
        }

        if (!updated) {
            break;
        }
    }

    return new Map(uniqueFilePaths.map((filePath) => {
        const segments = segmentsByFilePath.get(filePath) ?? [formatNodeLabel(filePath)];
        const depth = depthsByFilePath.get(filePath) ?? 1;
        return [filePath, segments.slice(-depth).join("/")];
    }));
}

function buildEdgesBySourceFile(
    commentsByFile: Map<string, Array<Comment | CommentThread>>,
    options: ThoughtTrailBuildOptions,
): Map<string, ThoughtTrailEdge[]> {
    const resolveWikiLinkPath = options.resolveWikiLinkPath;
    const resolveSideNoteReferencePath = options.resolveSideNoteReferencePath;
    if (!resolveWikiLinkPath && !resolveSideNoteReferencePath) {
        return new Map();
    }

    const edgesBySourceFile = new Map<string, ThoughtTrailEdge[]>();
    for (const filePath of Array.from(commentsByFile.keys()).sort((left, right) => left.localeCompare(right))) {
        const fileComments = sortCommentItemsByPosition(commentsByFile.get(filePath) ?? []);
        const edges: ThoughtTrailEdge[] = [];
        for (const comment of fileComments) {
            const seenTargets = new Set<string>();

            for (const body of getCommentBodies(comment)) {
                if (resolveWikiLinkPath) {
                    for (const match of extractWikiLinks(body)) {
                        const resolvedPath = resolveWikiLinkPath(match.linkPath, comment.filePath);
                        if (!resolvedPath || resolvedPath === comment.filePath || isAllCommentsNotePath(resolvedPath, options.allCommentsNotePath)) {
                            continue;
                        }

                        if (seenTargets.has(resolvedPath)) {
                            continue;
                        }

                        seenTargets.add(resolvedPath);
                        edges.push({
                            comment,
                            targetFilePath: resolvedPath,
                        });
                    }
                }

                if (!resolveSideNoteReferencePath) {
                    continue;
                }

                for (const reference of extractSideNoteReferences(body, {
                    localOnly: true,
                    localVaultName: options.localVaultName ?? null,
                })) {
                    const resolvedPath = resolveSideNoteReferencePath(
                        reference.target.commentId,
                        reference.target.filePath,
                    );
                    if (!resolvedPath || resolvedPath === comment.filePath || isAllCommentsNotePath(resolvedPath, options.allCommentsNotePath)) {
                        continue;
                    }

                    if (seenTargets.has(resolvedPath)) {
                        continue;
                    }

                    seenTargets.add(resolvedPath);
                    edges.push({
                        comment,
                        targetFilePath: resolvedPath,
                    });
                }
            }
        }

        if (edges.length) {
            edgesBySourceFile.set(filePath, edges);
        }
    }

    return edgesBySourceFile;
}

function getOrderedRoots(edgesBySourceFile: Map<string, ThoughtTrailEdge[]>): string[] {
    const sourceFilePaths = Array.from(edgesBySourceFile.keys()).sort((left, right) => left.localeCompare(right));
    const incomingCounts = new Map<string, number>();
    for (const edges of edgesBySourceFile.values()) {
        for (const edge of edges) {
            incomingCounts.set(edge.targetFilePath, (incomingCounts.get(edge.targetFilePath) ?? 0) + 1);
        }
    }

    const orderedRoots: string[] = [];
    const coveredSources = new Set<string>();

    const markReachableSources = (rootFilePath: string): void => {
        const pending = [rootFilePath];

        while (pending.length) {
            const currentFilePath = pending.pop();
            if (!currentFilePath || coveredSources.has(currentFilePath)) {
                continue;
            }

            coveredSources.add(currentFilePath);
            for (const edge of edgesBySourceFile.get(currentFilePath) ?? []) {
                if (edgesBySourceFile.has(edge.targetFilePath) && !coveredSources.has(edge.targetFilePath)) {
                    pending.push(edge.targetFilePath);
                }
            }
        }
    };

    for (const filePath of sourceFilePaths) {
        if (incomingCounts.has(filePath)) {
            continue;
        }

        orderedRoots.push(filePath);
        markReachableSources(filePath);
    }

    for (const filePath of sourceFilePaths) {
        if (coveredSources.has(filePath)) {
            continue;
        }

        orderedRoots.push(filePath);
        markReachableSources(filePath);
    }

    return orderedRoots;
}

export function buildThoughtTrailLines(
    vaultName: string,
    comments: Array<Comment | CommentThread>,
    options: ThoughtTrailBuildOptions = {},
): string[] {
    const visibleComments = comments.filter((comment) => !isAllCommentsNotePath(comment.filePath, options.allCommentsNotePath));
    if (!visibleComments.length) {
        return [];
    }

    const commentsByFile = new Map<string, Array<Comment | CommentThread>>();
    for (const comment of visibleComments) {
        const existing = commentsByFile.get(comment.filePath);
        if (existing) {
            existing.push(comment);
        } else {
            commentsByFile.set(comment.filePath, [comment]);
        }
    }

    const edgesBySourceFile = buildEdgesBySourceFile(commentsByFile, options);
    if (!edgesBySourceFile.size) {
        return [];
    }

    const nodeLabelByFilePath = buildCompactNodeLabels([
        ...edgesBySourceFile.keys(),
        ...Array.from(edgesBySourceFile.values()).flatMap((edges) => edges.map((edge) => edge.targetFilePath)),
    ]);
    const nodeLines: string[] = [];
    const edgeLines: string[] = [];
    const clickLines: string[] = [];
    const nodeIds = new Map<string, string>();
    const expandedSourceFilePaths = new Set<string>();

    const ensureNode = (filePath: string): string => {
        const existing = nodeIds.get(filePath);
        if (existing) {
            return existing;
        }

        const nodeId = `n${nodeIds.size}`;
        nodeIds.set(filePath, nodeId);
        const label = JSON.stringify(toMermaidText(nodeLabelByFilePath.get(filePath) ?? formatNodeLabel(filePath)));
        nodeLines.push(`    ${nodeId}[${label}]`);
        clickLines.push(
            `    click ${nodeId} href ${JSON.stringify(buildNoteOpenUrl(vaultName, filePath))} ${JSON.stringify(`Open ${normalizeNotePath(filePath)}`)}`,
        );
        return nodeId;
    };

    const renderBranch = (
        sourceFilePath: string,
        branchVisited: Set<string>,
    ): void => {
        const sourceId = ensureNode(sourceFilePath);
        for (const edge of edgesBySourceFile.get(sourceFilePath) ?? []) {
            const targetId = ensureNode(edge.targetFilePath);
            const label = formatEdgeLabel(edge.comment);
            edgeLines.push(label
                ? `    ${sourceId} -->|${label}| ${targetId}`
                : `    ${sourceId} --> ${targetId}`);

            if (
                branchVisited.has(edge.targetFilePath)
                || expandedSourceFilePaths.has(edge.targetFilePath)
                || !edgesBySourceFile.has(edge.targetFilePath)
            ) {
                continue;
            }

            branchVisited.add(edge.targetFilePath);
            renderBranch(edge.targetFilePath, branchVisited);
            branchVisited.delete(edge.targetFilePath);
        }

        expandedSourceFilePaths.add(sourceFilePath);
    };

    for (const rootFilePath of getOrderedRoots(edgesBySourceFile)) {
        ensureNode(rootFilePath);
        if (expandedSourceFilePaths.has(rootFilePath)) {
            continue;
        }

        renderBranch(rootFilePath, new Set([rootFilePath]));
    }

    const lines = [
        THOUGHT_TRAIL_MERMAID_INIT,
        "```mermaid",
        "flowchart TD",
    ];
    lines.push(...nodeLines, ...edgeLines, ...clickLines, "```");
    return lines;
}

export function buildLocalThoughtTrailLines(
    vaultName: string,
    comments: Array<Comment | CommentThread>,
    options: {
        allCommentsNotePath?: string;
        localVaultName?: string | null;
        rootFilePath: string;
    },
): string[] {
    const normalizedRootFilePath = normalizeNotePath(options.rootFilePath);
    const rootFileComments = sortCommentItemsByPosition(
        comments.filter((comment) =>
            !isAllCommentsNotePath(comment.filePath, options.allCommentsNotePath)
            && normalizeNotePath(comment.filePath) === normalizedRootFilePath
        ),
    );
    if (!rootFileComments.length) {
        return [];
    }

    const edges = buildLocalThoughtTrailEdges(rootFileComments, options);
    if (!edges.length) {
        return [];
    }

    const labelsByCommentId = buildUniqueLocalNodeLabels(rootFileComments);
    const nodeLines: string[] = [];
    const edgeLines: string[] = [];
    const clickLines: string[] = [];
    const nodeIds = new Map<string, string>();

    const ensureNode = (comment: Comment | CommentThread): string => {
        const commentId = getCommentItemId(comment);
        const existing = nodeIds.get(commentId);
        if (existing) {
            return existing;
        }

        const nodeId = `n${nodeIds.size}`;
        nodeIds.set(commentId, nodeId);
        const label = JSON.stringify(toMermaidText(
            labelsByCommentId.get(commentId)
            ?? formatLocalNodeBaseLabel(comment),
        ));
        nodeLines.push(`    ${nodeId}[${label}]`);
        clickLines.push(
            `    click ${nodeId} href ${JSON.stringify(buildSideNoteReferenceUrl(vaultName, {
                commentId,
                filePath: comment.filePath,
            }))} ${JSON.stringify("Open side note")}`,
        );
        return nodeId;
    };

    for (const edge of edges) {
        const sourceId = ensureNode(edge.sourceComment);
        const targetId = ensureNode(edge.targetComment);
        edgeLines.push(`    ${sourceId} --> ${targetId}`);
    }

    const lines = [
        THOUGHT_TRAIL_MERMAID_INIT,
        "```mermaid",
        "flowchart TD",
    ];
    lines.push(...nodeLines, ...edgeLines, ...clickLines, "```");
    return lines;
}

export function extractThoughtTrailMermaidSource(lines: string[]): string {
    return lines
        .filter((line, index) => {
            if (index === 0 && line.startsWith("%%{init:")) {
                return false;
            }

            const trimmed = line.trim();
            return trimmed !== "```mermaid" && trimmed !== "```";
        })
        .join("\n");
}

export function getThoughtTrailMermaidRenderConfig() {
    return cloneJsonValue(THOUGHT_TRAIL_MERMAID_RENDER_CONFIG);
}

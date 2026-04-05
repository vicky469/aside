import type { Comment } from "../../commentManager";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment, isPageComment } from "../anchors/commentAnchors";
import { sortCommentsByPosition } from "../storage/noteCommentStorage";
import { extractWikiLinks } from "../text/commentMentions";

const ALL_COMMENTS_NOTE_PATH = "SideNote2 index.md";
const LEGACY_ALL_COMMENTS_NOTE_PATH = "SideNote2 comments.md";
const MAX_PREVIEW_LENGTH = 80;
const MAX_EDGE_LABEL_LENGTH = 24;
const THOUGHT_TRAIL_MERMAID_RENDER_CONFIG = {
    fontFamily: "var(--font-interface-theme)",
    themeVariables: {
        fontSize: "12px",
    },
    flowchart: {
        nodeSpacing: 3,
        rankSpacing: 5,
        padding: 1,
        diagramPadding: 0,
        useMaxWidth: false,
        htmlLabels: true,
    },
};
const THOUGHT_TRAIL_MERMAID_INIT = `%%{init: ${JSON.stringify(THOUGHT_TRAIL_MERMAID_RENDER_CONFIG)}}%%`;

export interface ThoughtTrailBuildOptions {
    allCommentsNotePath?: string;
    resolveWikiLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
}

interface ThoughtTrailEdge {
    comment: Comment;
    targetFilePath: string;
    pageNoteOrdinal?: number;
}

function cloneJsonValue<T>(value: T): T {
    return JSON.parse(JSON.stringify(value)) as T;
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

function toInlinePreview(value: string, maxLength: number = MAX_PREVIEW_LENGTH): string {
    const normalized = value.replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();
    if (!normalized) {
        return "(blank selection)";
    }

    if (normalized.length <= maxLength) {
        return normalized;
    }

    return `${normalized.slice(0, maxLength - 3).trimEnd()}...`;
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

function formatEdgeLabel(comment: Comment, pageNoteOrdinal?: number): string {
    let label: string;
    if (isPageComment(comment)) {
        label = pageNoteOrdinal ? `pn${pageNoteOrdinal}` : "pn";
    } else {
        const selectedPreview = toInlinePreview(getCommentSelectionLabel(comment), MAX_EDGE_LABEL_LENGTH);
        label = isAnchoredComment(comment)
            ? selectedPreview
            : `${getCommentStatusLabel(comment)}: ${selectedPreview}`;
    }

    if (comment.resolved) {
        return `${label} (resolved)`;
    }

    return toMermaidText(label);
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
    commentsByFile: Map<string, Comment[]>,
    options: ThoughtTrailBuildOptions,
): Map<string, ThoughtTrailEdge[]> {
    const resolveWikiLinkPath = options.resolveWikiLinkPath;
    if (!resolveWikiLinkPath) {
        return new Map();
    }

    const edgesBySourceFile = new Map<string, ThoughtTrailEdge[]>();
    for (const filePath of Array.from(commentsByFile.keys()).sort((left, right) => left.localeCompare(right))) {
        const fileComments = sortCommentsByPosition(commentsByFile.get(filePath) ?? []);
        const pageNoteOrdinals = new Map<string, number>();
        let nextPageNoteOrdinal = 1;
        for (const comment of fileComments) {
            if (!isPageComment(comment)) {
                continue;
            }

            pageNoteOrdinals.set(comment.id, nextPageNoteOrdinal);
            nextPageNoteOrdinal += 1;
        }

        const edges: ThoughtTrailEdge[] = [];
        for (const comment of fileComments) {
            const seenTargets = new Set<string>();

            for (const match of extractWikiLinks(comment.comment ?? "")) {
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
                    pageNoteOrdinal: pageNoteOrdinals.get(comment.id),
                });
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
    comments: Comment[],
    options: ThoughtTrailBuildOptions = {},
): string[] {
    const visibleComments = comments.filter((comment) => !isAllCommentsNotePath(comment.filePath, options.allCommentsNotePath));
    if (!visibleComments.length) {
        return [];
    }

    const commentsByFile = new Map<string, Comment[]>();
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
            const label = formatEdgeLabel(edge.comment, edge.pageNoteOrdinal);
            edgeLines.push(`    ${sourceId} -->|${label}| ${targetId}`);

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

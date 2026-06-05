import type { Comment, CommentThread } from "../../commentManager";
import { getCommentSelectionLabel, getCommentStatusLabel, isAnchoredComment, isPageComment } from "../anchors/commentAnchors";
import { extractWikiLinks } from "../text/commentMentions";
import { extractTagsFromText } from "../text/commentTags";

const ALL_COMMENTS_NOTE_PATH = "Aside index.md";
const LEGACY_ALL_COMMENTS_NOTE_PATHS = new Set([
    "Aside comments.md",
    "SideNote2 index.md",
    "SideNote2 comments.md",
]);
const MAX_EDGE_LABEL_WORDS = 4;
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
    resolveWikiLinkPath?: (linkPath: string, sourceFilePath: string) => string | null;
}

export type ThoughtTrailFileTagLookup = (filePath: string) => readonly string[] | null | undefined;

interface ThoughtTrailEdge {
    comment: Comment | CommentThread;
    targetFilePath: string;
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
    return filePath === normalizeNotePath(currentPath) || LEGACY_ALL_COMMENTS_NOTE_PATHS.has(filePath);
}

function toInlineWordPreview(value: string, maxWords: number): string {
    const normalized = value
        .replace(/!?\[([^\]\n]+)\]\([^)]+\)/g, "$1")
        .replace(/\[\[([^\]|#\n]+)(?:#[^\]|\n]+)?(?:\|([^\]\n]+))?\]\]/g, (_match, target: string, displayText?: string) => {
            const label = displayText?.trim() || target.split("/").pop()?.replace(/\.md$/i, "") || target;
            return label;
        })
        .replace(/\r\n/g, "\n")
        .replace(/\s+/g, " ")
        .trim();
    if (!normalized) {
        return "(blank selection)";
    }

    const words = normalized.split(" ").filter(Boolean);
    if (words.length <= maxWords) {
        return normalized;
    }

    return `${words.slice(0, maxWords).join(" ")}...`;
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
        return toMermaidText(`${label} (resolved)`);
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
    commentsByFile: Map<string, Array<Comment | CommentThread>>,
    options: ThoughtTrailBuildOptions,
): Map<string, ThoughtTrailEdge[]> {
    const resolveWikiLinkPath = options.resolveWikiLinkPath;
    if (!resolveWikiLinkPath) {
        return new Map();
    }

    const edgesBySourceFile = new Map<string, ThoughtTrailEdge[]>();
    for (const filePath of Array.from(commentsByFile.keys()).sort((left, right) => left.localeCompare(right))) {
        const fileComments = sortCommentItemsByPosition(commentsByFile.get(filePath) ?? []);
        const edges: ThoughtTrailEdge[] = [];
        for (const comment of fileComments) {
            const seenTargets = new Set<string>();

            for (const body of getCommentBodies(comment)) {
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
        }

        if (edges.length) {
            edgesBySourceFile.set(filePath, edges);
        }
    }

    return edgesBySourceFile;
}

function normalizeThoughtTrailTagKey(value: string): string | null {
    const normalized = value.trim().replace(/^#+/, "");
    return normalized ? normalized.toLowerCase() : null;
}

function getNormalizedThoughtTrailTagKeys(tags: readonly string[] | null | undefined): Set<string> {
    const keys = new Set<string>();
    for (const tag of tags ?? []) {
        const key = normalizeThoughtTrailTagKey(tag);
        if (key) {
            keys.add(key);
        }
    }

    return keys;
}

function hasEveryTagKey(candidateKeys: Set<string>, requiredKeys: Set<string>): boolean {
    for (const requiredKey of requiredKeys) {
        if (!candidateKeys.has(requiredKey)) {
            return false;
        }
    }

    return true;
}

export function buildThoughtTrailCommentTagsByFilePath(
    comments: ReadonlyArray<Comment | CommentThread>,
): Map<string, string[]> {
    const tagsByFilePath = new Map<string, Map<string, string>>();

    for (const comment of comments) {
        const filePath = normalizeNotePath(comment.filePath);
        let tagsByKey = tagsByFilePath.get(filePath);
        for (const body of getCommentBodies(comment)) {
            for (const rawTag of extractTagsFromText(body)) {
                const tagKey = rawTag.slice(1).toLowerCase();
                if (!tagKey) {
                    continue;
                }

                if (!tagsByKey) {
                    tagsByKey = new Map<string, string>();
                    tagsByFilePath.set(filePath, tagsByKey);
                }
                if (!tagsByKey.has(tagKey)) {
                    tagsByKey.set(tagKey, rawTag);
                }
            }
        }
    }

    return new Map(
        Array.from(tagsByFilePath.entries()).map(([filePath, tagsByKey]) => [
            filePath,
            Array.from(tagsByKey.entries())
                .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
                .map(([, tagText]) => tagText),
        ]),
    );
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

export function buildTagRelatedFileLines(
    vaultName: string,
    sourceFilePath: string,
    candidateFilePaths: readonly string[],
    getTagsForFilePath: ThoughtTrailFileTagLookup,
): string[] {
    const normalizedSourcePath = normalizeNotePath(sourceFilePath);
    const sourceTagKeys = getNormalizedThoughtTrailTagKeys(getTagsForFilePath(normalizedSourcePath));
    if (!sourceTagKeys.size) {
        return [];
    }

    const matchedFilePaths: string[] = [];
    const seenFilePaths = new Set<string>();
    for (const candidateFilePath of candidateFilePaths) {
        const normalizedCandidatePath = normalizeNotePath(candidateFilePath);
        if (
            !normalizedCandidatePath
            || normalizedCandidatePath === normalizedSourcePath
            || seenFilePaths.has(normalizedCandidatePath)
        ) {
            continue;
        }

        seenFilePaths.add(normalizedCandidatePath);
        const candidateTagKeys = getNormalizedThoughtTrailTagKeys(getTagsForFilePath(normalizedCandidatePath));
        if (hasEveryTagKey(candidateTagKeys, sourceTagKeys)) {
            matchedFilePaths.push(normalizedCandidatePath);
        }
    }

    if (!matchedFilePaths.length) {
        return [];
    }

    const nodeLabelByFilePath = buildCompactNodeLabels([normalizedSourcePath, ...matchedFilePaths]);
    const nodeLines: string[] = [];
    const edgeLines: string[] = [];
    const clickLines: string[] = [];
    const nodeIds = new Map<string, string>();

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

    const sourceId = ensureNode(normalizedSourcePath);
    for (const matchedFilePath of matchedFilePaths) {
        const targetId = ensureNode(matchedFilePath);
        edgeLines.push(`    ${sourceId} --> ${targetId}`);
    }

    return [
        THOUGHT_TRAIL_MERMAID_INIT,
        "```mermaid",
        "flowchart TD",
        ...nodeLines,
        ...edgeLines,
        ...clickLines,
        "```",
    ];
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
                ? `    ${sourceId} -->|${JSON.stringify(label)}| ${targetId}`
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

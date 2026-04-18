import * as assert from "node:assert/strict";
import test from "node:test";
import type { Comment, CommentThread } from "../src/commentManager";
import {
    buildIndexFileFilterGraph,
    getIndexFileFilterConnectedComponent,
} from "../src/core/derived/indexFileFilterGraph";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/a.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        comment: overrides.comment ?? "",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/a.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "comment",
        selectedTextHash: overrides.selectedTextHash ?? "hash:comment",
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        entries: overrides.entries ?? [],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 200,
    };
}

function createResolver(resolvedPathsByKey: Record<string, string | null>) {
    return (linkPath: string) => resolvedPathsByKey[linkPath] ?? null;
}

function sortedNeighbors(graphValue: Map<string, Set<string>>, filePath: string): string[] {
    return Array.from(graphValue.get(filePath) ?? []).sort((left, right) => left.localeCompare(right));
}

test("buildIndexFileFilterGraph builds full connected components from outgoing and incoming wiki links", () => {
    const graph = buildIndexFileFilterGraph([
        createComment({
            id: "a-1",
            filePath: "docs/a.md",
            comment: "See [[B]]",
        }),
        createComment({
            id: "b-1",
            filePath: "docs/b.md",
            comment: "Then [[C]]",
        }),
        createComment({
            id: "d-1",
            filePath: "docs/d.md",
            comment: "Back to [[A]]",
        }),
        createComment({
            id: "e-1",
            filePath: "docs/e.md",
            comment: "Isolated",
        }),
        createComment({
            id: "c-1",
            filePath: "docs/c.md",
            comment: "No links",
        }),
    ], {
        resolveWikiLinkPath: createResolver({
            A: "docs/a.md",
            B: "docs/b.md",
            C: "docs/c.md",
        }),
    });

    assert.deepEqual(graph.availableFiles, [
        "docs/a.md",
        "docs/b.md",
        "docs/c.md",
        "docs/d.md",
        "docs/e.md",
    ]);
    assert.deepEqual(getIndexFileFilterConnectedComponent(graph, "docs/a.md"), [
        "docs/a.md",
        "docs/b.md",
        "docs/c.md",
        "docs/d.md",
    ]);
    assert.deepEqual(getIndexFileFilterConnectedComponent(graph, "docs/d.md"), [
        "docs/a.md",
        "docs/b.md",
        "docs/c.md",
        "docs/d.md",
    ]);
    assert.deepEqual(getIndexFileFilterConnectedComponent(graph, "docs/e.md"), [
        "docs/e.md",
    ]);
    assert.deepEqual(sortedNeighbors(graph.outgoingAdjacency, "docs/a.md"), ["docs/b.md"]);
    assert.deepEqual(sortedNeighbors(graph.undirectedAdjacency, "docs/a.md"), ["docs/b.md", "docs/d.md"]);
    assert.equal(graph.componentSizeByFile.get("docs/a.md"), 4);
    assert.equal(graph.componentSizeByFile.get("docs/e.md"), 1);
});

test("buildIndexFileFilterGraph ignores targets without side notes, self-links, and the index note", () => {
    const graph = buildIndexFileFilterGraph([
        createComment({
            id: "a-1",
            filePath: "docs/a.md",
            comment: "Self [[A]] missing [[Missing]] index [[Index]] real [[B]]",
        }),
        createComment({
            id: "b-1",
            filePath: "docs/b.md",
            comment: "",
        }),
    ], {
        allCommentsNotePath: "SideNote2 index.md",
        resolveWikiLinkPath: createResolver({
            A: "docs/a.md",
            B: "docs/b.md",
            Index: "SideNote2 index.md",
            Missing: "docs/missing.md",
        }),
    });

    assert.deepEqual(sortedNeighbors(graph.outgoingAdjacency, "docs/a.md"), ["docs/b.md"]);
    assert.deepEqual(getIndexFileFilterConnectedComponent(graph, "docs/a.md"), [
        "docs/a.md",
        "docs/b.md",
    ]);
});

test("buildIndexFileFilterGraph respects resolved-only visibility when building counts and closure", () => {
    const comments = [
        createComment({
            id: "a-active",
            filePath: "docs/a.md",
            resolved: false,
            comment: "[[B]]",
        }),
        createComment({
            id: "b-active",
            filePath: "docs/b.md",
            resolved: false,
            comment: "",
        }),
        createComment({
            id: "r-only",
            filePath: "docs/r.md",
            resolved: true,
            comment: "[[S]]",
        }),
        createComment({
            id: "s-only",
            filePath: "docs/s.md",
            resolved: true,
            comment: "",
        }),
    ];
    const resolveWikiLinkPath = createResolver({
        B: "docs/b.md",
        S: "docs/s.md",
    });

    const activeGraph = buildIndexFileFilterGraph(comments, {
        showResolved: false,
        resolveWikiLinkPath,
    });
    const resolvedGraph = buildIndexFileFilterGraph(comments, {
        showResolved: true,
        resolveWikiLinkPath,
    });

    assert.deepEqual(activeGraph.availableFiles, ["docs/a.md", "docs/b.md"]);
    assert.deepEqual(resolvedGraph.availableFiles, ["docs/r.md", "docs/s.md"]);
    assert.deepEqual(getIndexFileFilterConnectedComponent(activeGraph, "docs/a.md"), [
        "docs/a.md",
        "docs/b.md",
    ]);
    assert.deepEqual(getIndexFileFilterConnectedComponent(resolvedGraph, "docs/r.md"), [
        "docs/r.md",
        "docs/s.md",
    ]);
    assert.equal(activeGraph.fileCommentCounts.get("docs/r.md"), undefined);
    assert.equal(resolvedGraph.fileCommentCounts.get("docs/a.md"), undefined);
});

test("buildIndexFileFilterGraph can include both active and resolved comments when requested", () => {
    const graph = buildIndexFileFilterGraph([
        createComment({
            id: "a-active",
            filePath: "docs/a.md",
            resolved: false,
        }),
        createComment({
            id: "r-resolved",
            filePath: "docs/r.md",
            resolved: true,
        }),
    ], {
        showResolved: null,
    });

    assert.deepEqual(graph.availableFiles, ["docs/a.md", "docs/r.md"]);
});

test("getIndexFileFilterConnectedComponent returns empty for missing roots", () => {
    const graph = buildIndexFileFilterGraph([
        createComment({
            id: "a-1",
            filePath: "docs/a.md",
            comment: "",
        }),
    ]);

    assert.deepEqual(getIndexFileFilterConnectedComponent(graph, null), []);
    assert.deepEqual(getIndexFileFilterConnectedComponent(graph, "docs/missing.md"), []);
});

test("buildIndexFileFilterGraph keeps thread links from older child entries", () => {
    const graph = buildIndexFileFilterGraph([
        createThread({
            id: "a-thread",
            filePath: "docs/a.md",
            entries: [
                { id: "a-entry-1", body: "Older child links [[B]].", timestamp: 100 },
                { id: "a-entry-2", body: "Latest child has no link.", timestamp: 200 },
            ],
        }),
        createThread({
            id: "b-thread",
            filePath: "docs/b.md",
            entries: [
                { id: "b-entry-1", body: "No links", timestamp: 300 },
            ],
        }),
    ], {
        resolveWikiLinkPath: createResolver({
            B: "docs/b.md",
        }),
    });

    assert.deepEqual(sortedNeighbors(graph.outgoingAdjacency, "docs/a.md"), ["docs/b.md"]);
    assert.deepEqual(getIndexFileFilterConnectedComponent(graph, "docs/a.md"), [
        "docs/a.md",
        "docs/b.md",
    ]);
});

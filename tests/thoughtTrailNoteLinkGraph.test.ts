import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import { buildIndexFileFilterGraph, getIndexFileFilterConnectedComponent } from "../src/core/derived/indexFileFilterGraph";
import {
    buildThoughtTrailNoteLinkGraph,
    buildThoughtTrailNoteLinkLines,
    getThoughtTrailNoteLinkConnectedComponent,
} from "../src/core/derived/thoughtTrailNoteLinkGraph";

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/a.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 5,
        selectedText: overrides.selectedText ?? "source selection",
        selectedTextHash: overrides.selectedTextHash ?? "hash:source",
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        entries: overrides.entries ?? [
            {
                id: `${overrides.id ?? "thread-1"}-entry`,
                body: "",
                timestamp: 100,
            },
        ],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 100,
    };
}

function createResolver(resolvedPathsByLink: Record<string, string | null>) {
    return (linkPath: string): string | null => resolvedPathsByLink[linkPath] ?? null;
}

test("buildThoughtTrailNoteLinkGraph includes source markdown normal links and rooted transitive components", () => {
    const graph = buildThoughtTrailNoteLinkGraph([], {
        allCommentsNotePath: "Aside index.md",
        sourceMarkdownFilePaths: [
            "docs/a.md",
            "docs/b.md",
            "docs/c.md",
            "docs/incoming.md",
            "docs/unrelated.md",
        ],
        getSourceMarkdownLinks: (sourceFilePath) => {
            if (sourceFilePath === "docs/a.md") {
                return ["B"];
            }
            if (sourceFilePath === "docs/b.md") {
                return ["C"];
            }
            if (sourceFilePath === "docs/incoming.md") {
                return ["A"];
            }
            return [];
        },
        resolveSourceMarkdownLinkPath: createResolver({
            A: "docs/a.md",
            B: "docs/b.md",
            C: "docs/c.md",
        }),
    });

    assert.deepEqual(
        graph.edges.map((edge) => ({
            sourceFilePath: edge.sourceFilePath,
            targetFilePath: edge.targetFilePath,
            source: edge.source,
        })),
        [
            { sourceFilePath: "docs/a.md", targetFilePath: "docs/b.md", source: "source-markdown" },
            { sourceFilePath: "docs/b.md", targetFilePath: "docs/c.md", source: "source-markdown" },
            { sourceFilePath: "docs/incoming.md", targetFilePath: "docs/a.md", source: "source-markdown" },
        ],
    );
    assert.deepEqual(getThoughtTrailNoteLinkConnectedComponent(graph, "docs/a.md"), [
        "docs/a.md",
        "docs/b.md",
        "docs/c.md",
        "docs/incoming.md",
    ]);

    const lines = buildThoughtTrailNoteLinkLines("dev", graph, "docs/a.md");
    assert.equal(lines.some((line) => line.includes("-->|")), false);
    assert.equal(lines.some((line) => line.includes("Open docs/incoming.md")), true);
    assert.equal(lines.some((line) => line.includes("Open docs/unrelated.md")), false);
});

test("buildThoughtTrailNoteLinkGraph includes source markdown embeds only when they resolve to markdown notes", () => {
    const graph = buildThoughtTrailNoteLinkGraph([], {
        allCommentsNotePath: "Aside index.md",
        sourceMarkdownFilePaths: ["docs/a.md", "docs/embedded.md"],
        getSourceMarkdownEmbeds: (sourceFilePath) =>
            sourceFilePath === "docs/a.md"
                ? ["Embedded", "Image"]
                : [],
        resolveSourceMarkdownLinkPath: createResolver({
            Embedded: "docs/embedded.md",
            Image: null,
        }),
    });

    assert.deepEqual(
        graph.edges.map((edge) => ({
            sourceFilePath: edge.sourceFilePath,
            targetFilePath: edge.targetFilePath,
            source: edge.source,
        })),
        [
            { sourceFilePath: "docs/a.md", targetFilePath: "docs/embedded.md", source: "source-markdown" },
        ],
    );
});

test("source-markdown-only related notes appear in Thought Trail but do not affect index file filter membership", () => {
    const sourceThread = createThread({
        id: "source-thread",
        filePath: "docs/a.md",
        entries: [
            {
                id: "source-entry",
                body: "No side-note wikilinks here.",
                timestamp: 100,
            },
        ],
    });
    const thoughtTrailGraph = buildThoughtTrailNoteLinkGraph([sourceThread], {
        allCommentsNotePath: "Aside index.md",
        sourceMarkdownFilePaths: ["docs/a.md", "docs/commentless.md"],
        getSourceMarkdownLinks: (sourceFilePath) =>
            sourceFilePath === "docs/a.md"
                ? ["Commentless"]
                : [],
        resolveSourceMarkdownLinkPath: createResolver({
            Commentless: "docs/commentless.md",
        }),
    });

    assert.deepEqual(getThoughtTrailNoteLinkConnectedComponent(thoughtTrailGraph, "docs/a.md"), [
        "docs/a.md",
        "docs/commentless.md",
    ]);

    const indexGraph = buildIndexFileFilterGraph([sourceThread], {
        allCommentsNotePath: "Aside index.md",
        includeLinkedTargetFiles: true,
        resolveWikiLinkPath: () => null,
    });

    assert.deepEqual(getIndexFileFilterConnectedComponent(indexGraph, "docs/a.md"), ["docs/a.md"]);
});

test("side-note edges suppress duplicate source-markdown edges for the same source and target", () => {
    const graph = buildThoughtTrailNoteLinkGraph([
        createThread({
            id: "thread-a",
            filePath: "docs/a.md",
            selectedText: "side note label",
            entries: [
                {
                    id: "entry-a",
                    body: "See [[B]].",
                    timestamp: 100,
                },
            ],
        }),
    ], {
        allCommentsNotePath: "Aside index.md",
        sourceMarkdownFilePaths: ["docs/a.md", "docs/b.md"],
        getSourceMarkdownLinks: (sourceFilePath) =>
            sourceFilePath === "docs/a.md"
                ? ["B"]
                : [],
        resolveSideNoteWikiLinkPath: createResolver({
            B: "docs/b.md",
        }),
        resolveSourceMarkdownLinkPath: createResolver({
            B: "docs/b.md",
        }),
    });

    assert.deepEqual(graph.edges.map((edge) => edge.source), ["side-note"]);

    const lines = buildThoughtTrailNoteLinkLines("dev", graph, "docs/a.md");
    assert.equal(lines.some((line) => line.includes("-->|\"side note label\"|")), true);
    assert.equal(lines.filter((line) => /^\s+n\d+ --> n\d+$/.test(line)).length, 0);
});

test("buildThoughtTrailNoteLinkGraph excludes self-links, index-note links, unresolved links, and non-markdown targets", () => {
    const graph = buildThoughtTrailNoteLinkGraph([], {
        allCommentsNotePath: "Aside index.md",
        sourceMarkdownFilePaths: ["docs/a.md", "docs/target.md", "Aside index.md"],
        getSourceMarkdownLinks: (sourceFilePath) =>
            sourceFilePath === "docs/a.md"
                ? ["Self", "Index", "Missing", "Pdf", "Target"]
                : [],
        resolveSourceMarkdownLinkPath: createResolver({
            Self: "docs/a.md",
            Index: "Aside index.md",
            Missing: null,
            Pdf: null,
            Target: "docs/target.md",
        }),
    });

    assert.deepEqual(
        graph.edges.map((edge) => ({
            sourceFilePath: edge.sourceFilePath,
            targetFilePath: edge.targetFilePath,
            source: edge.source,
        })),
        [
            { sourceFilePath: "docs/a.md", targetFilePath: "docs/target.md", source: "source-markdown" },
        ],
    );
});

import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildThoughtTrailLines,
    extractThoughtTrailMermaidSource,
    getThoughtTrailMermaidRenderConfig,
} from "../src/core/derived/thoughtTrail";
import type { Comment, CommentThread } from "../src/commentManager";

const THOUGHT_TRAIL_INIT = "%%{init: {\"fontFamily\":\"var(--font-interface-theme)\",\"themeVariables\":{\"fontSize\":\"14px\"},\"flowchart\":{\"nodeSpacing\":3,\"rankSpacing\":14,\"padding\":3,\"diagramPadding\":0,\"useMaxWidth\":false,\"htmlLabels\":true}}}%%";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "file1.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 5,
        selectedText: overrides.selectedText ?? "hello",
        selectedTextHash: overrides.selectedTextHash ?? "hash-1",
        comment: overrides.comment ?? "",
        timestamp: overrides.timestamp ?? 1710000000000,
        resolved: overrides.resolved ?? false,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
    };
}

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "file1.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 5,
        selectedText: overrides.selectedText ?? "hello",
        selectedTextHash: overrides.selectedTextHash ?? "hash-1",
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        entries: overrides.entries ?? [],
        createdAt: overrides.createdAt ?? 1710000000000,
        updatedAt: overrides.updatedAt ?? 1710000001000,
    };
}

test("buildThoughtTrailLines renders a mermaid graph from wiki links", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            id: "root-note",
            filePath: "file1.md",
            selectedText: "setup",
            comment: "See [[file3]] and [[file2]].",
        }),
        createComment({
            id: "deep-note",
            filePath: "file3.md",
            selectedText: "internals",
            comment: "Continue to [[file4]].",
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.deepEqual(lines, [
        THOUGHT_TRAIL_INIT,
        "```mermaid",
        "flowchart TD",
        "    n0[\"file1\"]",
        "    n1[\"file3\"]",
        "    n2[\"file4\"]",
        "    n3[\"file2\"]",
        "    n0 -->|setup| n1",
        "    n1 -->|internals| n2",
        "    n0 -->|setup| n3",
        "    click n0 href \"obsidian://open?vault=dev&file=file1.md\" \"Open file1.md\"",
        "    click n1 href \"obsidian://open?vault=dev&file=file3.md\" \"Open file3.md\"",
        "    click n2 href \"obsidian://open?vault=dev&file=file4.md\" \"Open file4.md\"",
        "    click n3 href \"obsidian://open?vault=dev&file=file2.md\" \"Open file2.md\"",
        "```",
    ]);
});

test("buildThoughtTrailLines returns no rows when nothing connects", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            filePath: "file1.md",
            selectedText: "setup",
            comment: "No links here.",
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.deepEqual(lines, []);
});

test("buildThoughtTrailLines marks cycles and avoids duplicate roots", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            id: "note-a",
            filePath: "file1.md",
            selectedText: "alpha",
            comment: "Go to [[file2]].",
        }),
        createComment({
            id: "note-b",
            filePath: "file2.md",
            selectedText: "beta",
            comment: "Return to [[file1]].",
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.equal(lines[0], THOUGHT_TRAIL_INIT);
    assert.equal(lines[1], "```mermaid");
    assert.equal(lines[2], "flowchart TD");
    assert.equal(lines.includes("    n0 -->|alpha| n1"), true);
    assert.equal(lines.includes("    n1 -->|beta| n0"), true);
    assert.equal(lines.includes("    n1[\"file2\"]"), true);
    assert.equal(lines.filter((line) => line === "    n1[\"file2\"]").length, 1);
});

test("buildThoughtTrailLines omits edge labels for page notes", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            id: "page-note",
            filePath: "file1.md",
            selectedText: "",
            anchorKind: "page",
            comment: "Connects to [[target]].",
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.deepEqual(lines, [
        THOUGHT_TRAIL_INIT,
        "```mermaid",
        "flowchart TD",
        "    n0[\"file1\"]",
        "    n1[\"target\"]",
        "    n0 --> n1",
        "    click n0 href \"obsidian://open?vault=dev&file=file1.md\" \"Open file1.md\"",
        "    click n1 href \"obsidian://open?vault=dev&file=target.md\" \"Open target.md\"",
        "```",
    ]);
});

test("buildThoughtTrailLines truncates anchored edge labels to a few words", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            id: "anchored-note",
            filePath: "file1.md",
            selectedText: "this is a longer anchored selection for the edge label",
            comment: "Connects to [[target]].",
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.equal(lines.includes("    n0 -->|this is a longer...| n1"), true);
});

test("buildThoughtTrailLines renders a full chain without a depth limit", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            id: "chain-1",
            filePath: "file1.md",
            selectedText: "one",
            comment: "Go to [[file2]].",
        }),
        createComment({
            id: "chain-2",
            filePath: "file2.md",
            selectedText: "two",
            comment: "Go to [[file3]].",
        }),
        createComment({
            id: "chain-3",
            filePath: "file3.md",
            selectedText: "three",
            comment: "Go to [[file4]].",
        }),
        createComment({
            id: "chain-4",
            filePath: "file4.md",
            selectedText: "four",
            comment: "Go to [[file5]].",
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.equal(lines.includes("    n4[\"file5\"]"), true);
    assert.equal(lines.includes("    n3 -->|four| n4"), true);
});

test("buildThoughtTrailLines uses compact unique suffix labels instead of full file paths", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            id: "alpha-1",
            filePath: "notes/alpha.md",
            selectedText: "alpha",
            comment: "Go to [[beta]].",
        }),
        createComment({
            id: "alpha-2",
            filePath: "archive/alpha.md",
            selectedText: "archive alpha",
            comment: "Go to [[gamma]].",
        }),
    ], {
        resolveWikiLinkPath: (linkPath, sourceFilePath) => {
            if (linkPath === "beta") {
                return "notes/beta.md";
            }
            if (linkPath === "gamma") {
                return "archive/gamma.md";
            }
            return sourceFilePath;
        },
    });

    assert.equal(lines.includes("    n0[\"archive/alpha\"]"), true);
    assert.equal(lines.includes("    n2[\"notes/alpha\"]"), true);
    assert.equal(lines.includes("    click n2 href \"obsidian://open?vault=dev&file=notes%2Falpha.md\" \"Open notes/alpha.md\""), true);
});

test("buildThoughtTrailLines includes links from older child entries in a thread", () => {
    const lines = buildThoughtTrailLines("dev", [
        createThread({
            id: "thread-a",
            filePath: "file1.md",
            selectedText: "setup",
            entries: [
                { id: "entry-a1", body: "Older child links [[file2]].", timestamp: 100 },
                { id: "entry-a2", body: "Newest child is plain text.", timestamp: 200 },
            ],
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.equal(lines.includes("    n0 -->|setup| n1"), true);
    assert.equal(lines.includes("    n1[\"file2\"]"), true);
});

test("extractThoughtTrailMermaidSource removes the init line and fences", () => {
    const source = extractThoughtTrailMermaidSource([
        THOUGHT_TRAIL_INIT,
        "```mermaid",
        "flowchart TD",
        "    n0[\"file1\"]",
        "```",
    ]);

    assert.equal(source, [
        "flowchart TD",
        "    n0[\"file1\"]",
    ].join("\n"));
});

test("getThoughtTrailMermaidRenderConfig returns a cloned config", () => {
    const firstConfig = getThoughtTrailMermaidRenderConfig();
    const secondConfig = getThoughtTrailMermaidRenderConfig();

    assert.notEqual(firstConfig, secondConfig);
    assert.deepEqual(firstConfig, secondConfig);

    firstConfig.flowchart.padding = 99;
    assert.equal(secondConfig.flowchart.padding, 3);
});

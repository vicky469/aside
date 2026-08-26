import * as assert from "node:assert/strict";
import test from "node:test";
import {
    buildTagRelatedFileSetModel,
    buildThoughtTrailCommentTagsByFilePath,
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
        "    n0 -->|\"setup\"| n1",
        "    n1 -->|\"internals\"| n2",
        "    n0 -->|\"setup\"| n3",
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
    assert.equal(lines.includes("    n0 -->|\"alpha\"| n1"), true);
    assert.equal(lines.includes("    n1 -->|\"beta\"| n0"), true);
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

    assert.equal(lines.includes("    n0 -->|\"this is a longer...\"| n1"), true);
});

test("buildThoughtTrailLines strips markdown link targets from edge labels", () => {
    const lines = buildThoughtTrailLines("dev", [
        createComment({
            id: "markdown-link-label",
            filePath: "file1.md",
            selectedText: "[Program synthesis](https://en.wikipedia.org/wiki/Program_synthesis)",
            comment: "Connects to [[target]].",
        }),
    ], {
        resolveWikiLinkPath: (linkPath) => `${linkPath}.md`,
    });

    assert.equal(lines.includes("    n0 -->|\"Program synthesis\"| n1"), true);
    assert.equal(lines.some((line) => line.includes("https://en.wikipedia.org/wiki/Program_synthesis")), false);
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
    assert.equal(lines.includes("    n3 -->|\"four\"| n4"), true);
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

    assert.equal(lines.includes("    n0 -->|\"setup\"| n1"), true);
    assert.equal(lines.includes("    n1[\"file2\"]"), true);
});

test("buildTagRelatedFileSetModel deduplicates paths and accumulates every shared tag", () => {
    const tagsByPath = new Map<string, string[]>([
        ["docs/source.md", ["#Status", "#Finance", "#FINANCE"]],
        ["docs/a.md", ["#finance", "#status", "#extra"]],
        ["docs/b.md", ["#FINANCE"]],
        ["docs/c.md", ["#status"]],
        ["docs/no-match.md", ["#other"]],
    ]);

    assert.deepEqual(
        buildTagRelatedFileSetModel(
            "docs/./source.md",
            [
                "docs/source.md",
                "./docs/a.md",
                "docs/../docs/a.md",
                "docs/c.md",
                "docs/b.md",
                "docs/no-match.md",
                "",
            ],
            (filePath: string) => tagsByPath.get(filePath) ?? [],
        ),
        {
            currentFile: {
                filePath: "docs/source.md",
                label: "source (current)",
            },
            tags: [
                { tagKey: "finance", tagDisplay: "Finance", fileCount: 2 },
                { tagKey: "status", tagDisplay: "Status", fileCount: 2 },
            ],
            files: [
                {
                    filePath: "docs/a.md",
                    label: "a",
                    tags: [
                        { tagKey: "finance", tagDisplay: "Finance" },
                        { tagKey: "status", tagDisplay: "Status" },
                    ],
                },
                {
                    filePath: "docs/b.md",
                    label: "b",
                    tags: [{ tagKey: "finance", tagDisplay: "Finance" }],
                },
                {
                    filePath: "docs/c.md",
                    label: "c",
                    tags: [{ tagKey: "status", tagDisplay: "Status" }],
                },
            ],
        },
    );
});

test("buildTagRelatedFileSetModel preserves distinct full paths with the same basename", () => {
    const tagsByPath = new Map<string, string[]>([
        ["docs/source.md", ["#project"]],
        ["folder-a/index.md", ["#project"]],
        ["folder-b/index.md", ["#PROJECT"]],
        ["Custom Aside Index.md", ["#project"]],
    ]);

    const model = buildTagRelatedFileSetModel(
        "docs/source.md",
        [
            "folder-b/index.md",
            "Custom Aside Index.md",
            "folder-a/./index.md",
            "docs/source.md",
        ],
        (filePath: string) => tagsByPath.get(filePath) ?? [],
        { allCommentsNotePath: "Custom Aside Index.md" },
    );

    assert.deepEqual(model.tags, [
        { tagKey: "project", tagDisplay: "project", fileCount: 2 },
    ]);
    assert.deepEqual(model.files.map(({ filePath, label }) => ({ filePath, label })), [
        { filePath: "folder-a/index.md", label: "index" },
        { filePath: "folder-b/index.md", label: "index" },
    ]);
});

test("buildTagRelatedFileSetModel uses side-comment tags and excludes the generated index", () => {
    const tagsByPath = buildThoughtTrailCommentTagsByFilePath([
        createThread({
            id: "source-thread",
            filePath: "docs/source.md",
            entries: [{ id: "source-entry", body: "Source side comment #project", timestamp: 100 }],
        }),
        createThread({
            id: "target-thread",
            filePath: "docs/a.md",
            entries: [{ id: "target-entry", body: "Target side comment #project", timestamp: 100 }],
        }),
        createThread({
            id: "index-thread",
            filePath: "Custom Aside Index.md",
            entries: [{ id: "index-entry", body: "Generated index mention #project", timestamp: 100 }],
        }),
    ]);

    const model = buildTagRelatedFileSetModel(
        "docs/source.md",
        ["docs/a.md", "Custom Aside Index.md"],
        (filePath: string) => tagsByPath.get(filePath) ?? [],
        { allCommentsNotePath: "Custom Aside Index.md" },
    );

    assert.deepEqual(model.files.map((file) => file.filePath), ["docs/a.md"]);
    assert.deepEqual(model.tags, [
        { tagKey: "project", tagDisplay: "project", fileCount: 1 },
    ]);
});

test("buildTagRelatedFileSetModel returns empty membership for invalid or untagged sources", () => {
    const untagged = buildTagRelatedFileSetModel(
        "docs/source.md",
        ["docs/a.md"],
        () => [],
    );
    assert.deepEqual(untagged, {
        currentFile: { filePath: "docs/source.md", label: "source (current)" },
        tags: [],
        files: [],
    });

    assert.deepEqual(
        buildTagRelatedFileSetModel(
            "./",
            ["docs/a.md"],
            () => ["#project"],
        ),
        { currentFile: null, tags: [], files: [] },
    );

    assert.deepEqual(
        buildTagRelatedFileSetModel(
            "Custom Aside Index.md",
            ["docs/a.md"],
            () => ["#project"],
            { allCommentsNotePath: "Custom Aside Index.md" },
        ),
        { currentFile: null, tags: [], files: [] },
    );
});

test("buildTagRelatedFileSetModel omits source tags with no related files", () => {
    const tagsByPath = new Map<string, string[]>([
        ["docs/source.md", ["#Project", "#Unused"]],
        ["docs/a.md", ["#project"]],
    ]);

    const model = buildTagRelatedFileSetModel(
        "docs/source.md",
        ["docs/a.md"],
        (filePath: string) => tagsByPath.get(filePath) ?? [],
    );

    assert.deepEqual(model.tags, [
        { tagKey: "project", tagDisplay: "Project", fileCount: 1 },
    ]);
    assert.deepEqual(model.files[0]?.tags, [
        { tagKey: "project", tagDisplay: "Project" },
    ]);
});

test("buildThoughtTrailCommentTagsByFilePath collects tags from side comment entries", () => {
    const tagsByPath = buildThoughtTrailCommentTagsByFilePath([
        createThread({
            id: "thread-a",
            filePath: "docs/source.md",
            entries: [
                { id: "entry-a1", body: "Root note #semantic-triplet", timestamp: 100 },
                { id: "entry-a2", body: "Reply repeats #Semantic-Triplet and adds #graph", timestamp: 200 },
            ],
        }),
        createComment({
            id: "comment-b",
            filePath: "docs/target.md",
            comment: "Legacy flat comment #graph",
        }),
    ]);

    assert.deepEqual(tagsByPath.get("docs/source.md"), ["#graph", "#semantic-triplet"]);
    assert.deepEqual(tagsByPath.get("docs/target.md"), ["#graph"]);
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

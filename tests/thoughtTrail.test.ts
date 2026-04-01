import * as assert from "node:assert/strict";
import test from "node:test";
import { buildThoughtTrailLines } from "../src/core/derived/thoughtTrail";
import type { Comment } from "../src/commentManager";

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
        "%%{init: {\"themeVariables\": {\"fontSize\": \"7px\"}, \"flowchart\": {\"nodeSpacing\": 6, \"rankSpacing\": 10, \"diagramPadding\": 1, \"useMaxWidth\": true, \"htmlLabels\": false}} }%%",
        "```mermaid",
        "flowchart TD",
        "    n0[\"file1\"]",
        "    n1[\"file3\"]",
        "    n2[\"file4\"]",
        "    n3[\"file2\"]",
        "    n0 -->|setup| n1",
        "    n1 -->|internals| n2",
        "    n0 -->|setup| n3",
        "    click n0 href \"obsidian://open?vault=dev&file=file1.md\" \"Open file1\"",
        "    click n1 href \"obsidian://open?vault=dev&file=file3.md\" \"Open file3\"",
        "    click n2 href \"obsidian://open?vault=dev&file=file4.md\" \"Open file4\"",
        "    click n3 href \"obsidian://open?vault=dev&file=file2.md\" \"Open file2\"",
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

    assert.equal(lines[0], "%%{init: {\"themeVariables\": {\"fontSize\": \"7px\"}, \"flowchart\": {\"nodeSpacing\": 6, \"rankSpacing\": 10, \"diagramPadding\": 1, \"useMaxWidth\": true, \"htmlLabels\": false}} }%%");
    assert.equal(lines[1], "```mermaid");
    assert.equal(lines[2], "flowchart TD");
    assert.equal(lines.includes("    n0 -->|alpha| n1"), true);
    assert.equal(lines.includes("    n1 -->|beta| n0"), true);
    assert.equal(lines.includes("    n1[\"file2\"]"), true);
    assert.equal(lines.filter((line) => line === "    n1[\"file2\"]").length, 1);
});

test("buildThoughtTrailLines uses pn ordinals for page notes", () => {
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
        "%%{init: {\"themeVariables\": {\"fontSize\": \"7px\"}, \"flowchart\": {\"nodeSpacing\": 6, \"rankSpacing\": 10, \"diagramPadding\": 1, \"useMaxWidth\": true, \"htmlLabels\": false}} }%%",
        "```mermaid",
        "flowchart TD",
        "    n0[\"file1\"]",
        "    n1[\"target\"]",
        "    n0 -->|pn1| n1",
        "    click n0 href \"obsidian://open?vault=dev&file=file1.md\" \"Open file1\"",
        "    click n1 href \"obsidian://open?vault=dev&file=target.md\" \"Open target\"",
        "```",
    ]);
});

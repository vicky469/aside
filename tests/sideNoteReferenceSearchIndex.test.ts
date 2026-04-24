import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import { AggregateCommentIndex } from "../src/index/AggregateCommentIndex";
import { buildSideNoteReferenceSearchIndex } from "../src/index/SideNoteReferenceSearchIndex";

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/a.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "selection",
        selectedTextHash: overrides.selectedTextHash ?? "hash:selection",
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        entries: overrides.entries ?? [{
            id: overrides.id ?? "thread-1",
            body: overrides.selectedText ?? "selection",
            timestamp: overrides.createdAt ?? 100,
        }],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 200,
    };
}

test("side note reference search includes same-file matches and ranks them ahead of other files", () => {
    const aggregateCommentIndex = new AggregateCommentIndex();
    aggregateCommentIndex.updateFile("docs/current.md", [
        createThread({
            id: "thread-current",
            filePath: "docs/current.md",
            selectedText: "Alpha insight",
        }),
        createThread({
            id: "thread-same-file",
            filePath: "docs/current.md",
            selectedText: "Alpha insight",
            startLine: 10,
            updatedAt: 150,
        }),
    ]);
    aggregateCommentIndex.updateFile("docs/other.md", [
        createThread({
            id: "thread-other",
            filePath: "docs/other.md",
            selectedText: "Alpha insight",
        }),
    ]);

    const index = buildSideNoteReferenceSearchIndex(aggregateCommentIndex, {
        allCommentsNotePath: "SideNote2 index.md",
    });
    const results = index.search("alpha insight", {
        excludeThreadId: "thread-current",
        sourceFilePath: "docs/current.md",
    });

    assert.deepEqual(results.map((result) => result.threadId), [
        "thread-same-file",
        "thread-other",
    ]);
});

test("side note reference search can still exclude same-file matches when requested", () => {
    const aggregateCommentIndex = new AggregateCommentIndex();
    aggregateCommentIndex.updateFile("docs/current.md", [
        createThread({
            id: "thread-current",
            filePath: "docs/current.md",
            selectedText: "Alpha insight",
        }),
    ]);
    aggregateCommentIndex.updateFile("docs/other.md", [
        createThread({
            id: "thread-other",
            filePath: "docs/other.md",
            selectedText: "Alpha insight",
        }),
    ]);

    const index = buildSideNoteReferenceSearchIndex(aggregateCommentIndex, {
        allCommentsNotePath: "SideNote2 index.md",
    });
    const results = index.search("alpha insight", {
        includeSameFile: false,
        sourceFilePath: "docs/current.md",
    });

    assert.deepEqual(results.map((result) => result.threadId), [
        "thread-other",
    ]);
});

test("side note reference search indexes child entry ids onto the parent thread document", () => {
    const aggregateCommentIndex = new AggregateCommentIndex();
    aggregateCommentIndex.updateFile("docs/roadmap.md", [
        createThread({
            id: "thread-roadmap",
            filePath: "docs/roadmap.md",
            selectedText: "Roadmap review",
            entries: [
                { id: "thread-roadmap", body: "Root entry", timestamp: 100 },
                { id: "entry-roadmap-2", body: "Child entry", timestamp: 110 },
            ],
        }),
    ]);

    const index = buildSideNoteReferenceSearchIndex(aggregateCommentIndex, {
        allCommentsNotePath: "SideNote2 index.md",
    });

    assert.equal(index.getDocument("entry-roadmap-2")?.threadId, "thread-roadmap");
    assert.equal(index.search("roadmap")[0]?.threadId, "thread-roadmap");
});

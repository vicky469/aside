import * as assert from "node:assert/strict";
import test from "node:test";
import { commentToThread, type Comment } from "../src/commentManager";
import { buildRootedThoughtTrailScope } from "../src/ui/views/sidebarThoughtTrailScope";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "comment-1",
        filePath: overrides.filePath ?? "docs/current.md",
        startLine: overrides.startLine ?? 4,
        startChar: overrides.startChar ?? 1,
        endLine: overrides.endLine ?? 4,
        endChar: overrides.endChar ?? 8,
        selectedText: overrides.selectedText ?? "selected text",
        selectedTextHash: overrides.selectedTextHash ?? "hash:selected",
        comment: overrides.comment ?? "Comment body",
        timestamp: overrides.timestamp ?? 100,
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

test("buildRootedThoughtTrailScope keeps note thought trails rooted on the current file component", () => {
    const currentThread = commentToThread(createComment({
        id: "current-thread",
        filePath: "docs/current.md",
        comment: "Follow [[connected]] next.",
    }));
    const connectedThread = commentToThread(createComment({
        id: "connected-thread",
        filePath: "docs/connected.md",
        comment: "Loop back to [[current]].",
    }));
    const unrelatedThread = commentToThread(createComment({
        id: "unrelated-thread",
        filePath: "docs/unrelated.md",
        comment: "This stays on its own.",
    }));

    const scoped = buildRootedThoughtTrailScope(
        [currentThread, connectedThread, unrelatedThread],
        {
            rootFilePath: "docs/current.md",
            allCommentsNotePath: "SideNote2 index.md",
            resolveWikiLinkPath: (linkPath) => {
                if (linkPath === "connected") {
                    return "docs/connected.md";
                }
                if (linkPath === "current") {
                    return "docs/current.md";
                }
                return null;
            },
        },
    );

    assert.deepEqual(scoped.scopedFilePaths, ["docs/connected.md", "docs/current.md"]);
    assert.deepEqual(scoped.scopedThreads.map((thread) => thread.id), [
        "current-thread",
        "connected-thread",
    ]);
});

test("buildRootedThoughtTrailScope returns no scope when the current file is absent from the graph", () => {
    const unrelatedThread = commentToThread(createComment({
        id: "unrelated-thread",
        filePath: "docs/unrelated.md",
        comment: "This stays on its own.",
    }));

    const scoped = buildRootedThoughtTrailScope(
        [unrelatedThread],
        {
            rootFilePath: "docs/current.md",
            allCommentsNotePath: "SideNote2 index.md",
            resolveWikiLinkPath: () => null,
        },
    );

    assert.deepEqual(scoped.scopedFilePaths, []);
    assert.deepEqual(scoped.scopedThreads, []);
});

import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import {
    hasAvailableThoughtTrail,
    mergeCurrentFileThreadsForThoughtTrail,
    resolveModeWithThoughtTrailAvailability,
} from "../src/ui/views/sidebarThoughtTrailState";

function createThread(overrides: Partial<CommentThread> = {}): CommentThread {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "docs/current.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 5,
        selectedText: overrides.selectedText ?? "current selection",
        selectedTextHash: overrides.selectedTextHash ?? "hash:current",
        anchorKind: overrides.anchorKind ?? "selection",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
        entries: overrides.entries ?? [
            {
                id: overrides.id ?? "thread-1",
                body: "See [[connected]] next.",
                timestamp: 100,
            },
        ],
        createdAt: overrides.createdAt ?? 100,
        updatedAt: overrides.updatedAt ?? 100,
    };
}

test("hasAvailableThoughtTrail is false without a root scope", () => {
    assert.equal(
        hasAvailableThoughtTrail({
            allCommentsNotePath: "SideNote2 index.md",
            comments: [createThread()],
            hasRootScope: false,
            resolveWikiLinkPath: () => "docs/connected.md",
            vaultName: "dev",
        }),
        false,
    );
});

test("hasAvailableThoughtTrail is false when the scoped comments produce no trail lines", () => {
    assert.equal(
        hasAvailableThoughtTrail({
            allCommentsNotePath: "SideNote2 index.md",
            comments: [
                createThread({
                    entries: [
                        {
                            id: "thread-1",
                            body: "No links here.",
                            timestamp: 100,
                        },
                    ],
                }),
            ],
            hasRootScope: true,
            resolveWikiLinkPath: () => null,
            vaultName: "dev",
        }),
        false,
    );
});

test("hasAvailableThoughtTrail is true when scoped comments produce trail lines", () => {
    assert.equal(
        hasAvailableThoughtTrail({
            allCommentsNotePath: "SideNote2 index.md",
            comments: [createThread()],
            hasRootScope: true,
            resolveWikiLinkPath: () => "docs/connected.md",
            vaultName: "dev",
        }),
        true,
    );
});

test("resolveModeWithThoughtTrailAvailability falls back from unavailable thought trail to list", () => {
    assert.equal(resolveModeWithThoughtTrailAvailability("thought-trail", false), "list");
    assert.equal(resolveModeWithThoughtTrailAvailability("thought-trail", true), "thought-trail");
    assert.equal(resolveModeWithThoughtTrailAvailability("tags", false), "tags");
    assert.equal(resolveModeWithThoughtTrailAvailability("list", false), "list");
});

test("mergeCurrentFileThreadsForThoughtTrail uses current file threads without waiting for a loaded index", () => {
    const currentThread = createThread({
        id: "current-thread",
        filePath: "docs/current.md",
        entries: [
            {
                id: "current-thread",
                body: "See [[connected]] next.",
                timestamp: 100,
            },
        ],
    });
    const staleCurrentThread = createThread({
        id: "stale-current-thread",
        filePath: "docs/current.md",
        entries: [
            {
                id: "stale-current-thread",
                body: "No links in stale index.",
                timestamp: 100,
            },
        ],
    });
    const otherThread = createThread({
        id: "other-thread",
        filePath: "docs/other.md",
    });

    const merged = mergeCurrentFileThreadsForThoughtTrail(
        [staleCurrentThread, otherThread],
        "docs/current.md",
        [currentThread],
    );

    assert.deepEqual(merged.map((thread) => thread.id), ["other-thread", "current-thread"]);
    assert.equal(
        hasAvailableThoughtTrail({
            allCommentsNotePath: "SideNote2 index.md",
            comments: merged,
            hasRootScope: true,
            resolveWikiLinkPath: (linkPath) => linkPath === "connected" ? "docs/connected.md" : null,
            vaultName: "dev",
        }),
        true,
    );
});

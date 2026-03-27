import * as assert from "node:assert/strict";
import test from "node:test";
import { buildSidebarSections, formatSidebarCommentMeta } from "../src/ui/views/sidebarCommentSections";

test("buildSidebarSections orders page notes before anchored notes", () => {
    const sections = buildSidebarSections([
        { id: "a-1", timestamp: 1, anchorKind: "selection" as const },
        { id: "p-1", timestamp: 2, anchorKind: "page" as const },
        { id: "a-2", timestamp: 3, anchorKind: "selection" as const, orphaned: true },
        { id: "p-2", timestamp: 4, anchorKind: "page" as const },
    ]);

    assert.deepEqual(
        sections.map((section) => section.key),
        ["page", "anchored"],
    );
    assert.deepEqual(
        sections[0]?.comments.map((comment) => comment.id),
        ["p-1", "p-2"],
    );
    assert.deepEqual(
        sections[1]?.comments.map((comment) => comment.id),
        ["a-1", "a-2"],
    );
});

test("buildSidebarSections skips empty sections", () => {
    const sections = buildSidebarSections([
        { id: "a-1", timestamp: 1, anchorKind: "selection" as const },
    ]);

    assert.deepEqual(
        sections.map((section) => section.key),
        ["page", "anchored"],
    );
    assert.deepEqual(sections[0]?.comments, []);
    assert.deepEqual(
        sections[1]?.comments.map((comment) => comment.id),
        ["a-1"],
    );
});

test("formatSidebarCommentMeta omits repeated page and anchored labels", () => {
    const anchoredMeta = formatSidebarCommentMeta({
        timestamp: Date.UTC(2024, 0, 1, 13, 30),
        anchorKind: "selection",
    });
    const pageMeta = formatSidebarCommentMeta({
        timestamp: Date.UTC(2024, 0, 1, 13, 30),
        anchorKind: "page",
    });
    const orphanedResolvedMeta = formatSidebarCommentMeta({
        timestamp: Date.UTC(2024, 0, 1, 13, 30),
        anchorKind: "selection",
        orphaned: true,
        resolved: true,
    });

    assert.equal(anchoredMeta.includes("anchored"), false);
    assert.equal(pageMeta.includes("page note"), false);
    assert.equal(orphanedResolvedMeta.includes("orphaned"), true);
    assert.equal(orphanedResolvedMeta.includes("resolved"), true);
});

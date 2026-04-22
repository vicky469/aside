import * as assert from "node:assert/strict";
import test from "node:test";
import {
    formatSidebarCommentMeta,
    formatSidebarCommentSelectedTextPreview,
    formatSidebarCommentTimestamp,
} from "../src/ui/views/sidebarCommentSections";

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

test("formatSidebarCommentSelectedTextPreview normalizes anchored selections and skips page notes", () => {
    assert.equal(
        formatSidebarCommentSelectedTextPreview({
            anchorKind: "selection",
            selectedText: "  first line\nsecond\tline  ",
        }),
        "first line second line",
    );
    assert.equal(
        formatSidebarCommentSelectedTextPreview({
            anchorKind: "page",
            selectedText: "Page label",
        }),
        null,
    );
    assert.equal(
        formatSidebarCommentSelectedTextPreview({
            isBookmark: true,
            selectedText: "Legacy bookmark label",
        }),
        "Legacy bookmark label",
    );
});

test("formatSidebarCommentTimestamp uses compact calendar-style formatting for recent dates", () => {
    const referenceNow = new Date("2026-04-19T15:00:00").getTime();

    assert.equal(
        formatSidebarCommentTimestamp(new Date("2026-04-19T13:30:00").getTime(), referenceNow),
        "1:30 PM",
    );
    assert.equal(
        formatSidebarCommentTimestamp(new Date("2026-04-18T13:30:00").getTime(), referenceNow),
        "Yesterday",
    );
    assert.equal(
        formatSidebarCommentTimestamp(new Date("2026-04-17T13:30:00").getTime(), referenceNow),
        "Fri 1:30 PM",
    );
});

test("formatSidebarCommentTimestamp falls back to compact dates for older timestamps", () => {
    const referenceNow = new Date("2026-04-19T15:00:00").getTime();

    assert.equal(
        formatSidebarCommentTimestamp(new Date("2026-03-10T13:30:00").getTime(), referenceNow),
        "Mar 10",
    );
    assert.equal(
        formatSidebarCommentTimestamp(new Date("2025-12-31T13:30:00").getTime(), referenceNow),
        "2025-12-31",
    );
});

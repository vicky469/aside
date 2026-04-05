import * as assert from "node:assert/strict";
import test from "node:test";
import { formatSidebarCommentMeta } from "../src/ui/views/sidebarCommentSections";

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

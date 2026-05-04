import * as assert from "node:assert/strict";
import test from "node:test";
import { estimateIndexPreviewScrollTop } from "../src/comments/indexPreviewScrollPlanner";

test("estimateIndexPreviewScrollTop uses rendered samples when available", () => {
    const scrollTop = estimateIndexPreviewScrollTop(
        120,
        400,
        [
            { line: 100, top: 1000 },
            { line: 140, top: 1800 },
        ],
        5000,
        800,
    );

    assert.equal(scrollTop, 1000);
});

test("estimateIndexPreviewScrollTop falls back to line ratio without samples", () => {
    const scrollTop = estimateIndexPreviewScrollTop(
        100,
        401,
        [],
        5000,
        800,
    );

    assert.equal(scrollTop, 850);
});

test("estimateIndexPreviewScrollTop clamps within the scrollable range", () => {
    const scrollTop = estimateIndexPreviewScrollTop(
        999,
        1000,
        [
            { line: 900, top: 4600 },
            { line: 950, top: 4850 },
        ],
        5000,
        800,
    );

    assert.equal(scrollTop, 4200);
});

import * as assert from "node:assert/strict";
import test from "node:test";
import {
    planCanonicalCommentStorage,
} from "../src/core/storage/canonicalCommentStorage";

test("canonical comment storage planner prefers sidecar records over legacy inline blocks", () => {
    const plan = planCanonicalCommentStorage({
        sidecarRecordFound: true,
        inlineThreadCount: 2,
        hasThreadedInlineBlock: true,
    });

    assert.deepEqual(plan, {
        action: "use-sidecar",
        source: "sidecar",
        shouldRecoverRenamedSource: false,
        shouldStripInlineBlock: true,
        shouldWriteInlineThreadsToSidecar: false,
    });
});

test("canonical comment storage planner treats an empty sidecar record as canonical", () => {
    const plan = planCanonicalCommentStorage({
        sidecarRecordFound: true,
        inlineThreadCount: 0,
        hasThreadedInlineBlock: false,
    });

    assert.equal(plan.action, "use-sidecar");
    assert.equal(plan.source, "sidecar");
    assert.equal(plan.shouldRecoverRenamedSource, false);
    assert.equal(plan.shouldWriteInlineThreadsToSidecar, false);
});

test("canonical comment storage planner migrates legacy inline threads only when no sidecar exists", () => {
    const plan = planCanonicalCommentStorage({
        sidecarRecordFound: false,
        inlineThreadCount: 1,
        hasThreadedInlineBlock: true,
    });

    assert.deepEqual(plan, {
        action: "migrate-inline",
        source: "inline",
        shouldRecoverRenamedSource: false,
        shouldStripInlineBlock: true,
        shouldWriteInlineThreadsToSidecar: true,
    });
});

test("canonical comment storage planner strips empty legacy blocks while checking rename recovery", () => {
    const plan = planCanonicalCommentStorage({
        sidecarRecordFound: false,
        inlineThreadCount: 0,
        hasThreadedInlineBlock: true,
    });

    assert.deepEqual(plan, {
        action: "check-renamed-source",
        source: "none",
        shouldRecoverRenamedSource: true,
        shouldStripInlineBlock: true,
        shouldWriteInlineThreadsToSidecar: false,
    });
});

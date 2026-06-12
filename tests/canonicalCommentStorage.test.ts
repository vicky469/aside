import * as assert from "node:assert/strict";
import test from "node:test";
import {
    planCanonicalCommentStorage,
} from "../src/core/storage/canonicalCommentStorage";

test("canonical comment storage planner uses current sidecar records when present", () => {
    const plan = planCanonicalCommentStorage({
        sidecarRecordFound: true,
    });

    assert.deepEqual(plan, {
        action: "use-sidecar",
        source: "sidecar",
        shouldRecoverRenamedSource: false,
    });
});

test("canonical comment storage planner checks current rename recovery when no sidecar exists", () => {
    const plan = planCanonicalCommentStorage({
        sidecarRecordFound: false,
    });

    assert.deepEqual(plan, {
        action: "check-renamed-source",
        source: "none",
        shouldRecoverRenamedSource: true,
    });
});

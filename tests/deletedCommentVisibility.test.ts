import * as assert from "node:assert/strict";
import test from "node:test";
import * as deletedCommentVisibility from "../src/core/rules/deletedCommentVisibility";

const DAY_MS = 24 * 60 * 60 * 1000;

test("soft-deleted notes are retained for seven days before expiry", () => {
    const deletedAt = 1_710_000_000_000;

    assert.equal(deletedCommentVisibility.SOFT_DELETE_RETENTION_DAYS, 7);
    assert.equal(deletedCommentVisibility.SOFT_DELETE_RETENTION_MS, 7 * DAY_MS);
    assert.equal(
        deletedCommentVisibility.isSoftDeletedExpired(deletedAt, deletedAt + (7 * DAY_MS) - 1),
        false,
    );
    assert.equal(
        deletedCommentVisibility.isSoftDeletedExpired(deletedAt, deletedAt + (7 * DAY_MS)),
        true,
    );
});

test("deleted note retention helper copy matches the configured duration", () => {
    assert.equal(
        deletedCommentVisibility.getSoftDeleteRetentionMessage?.(),
        "Deleted notes are kept for 7 days, then permanently deleted.",
    );
});

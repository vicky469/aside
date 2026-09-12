import * as assert from "node:assert/strict";
import test from "node:test";
import { mergeCommentPinState, normalizeCommentPinState } from "../shared/commentPinState";
import { getPinnedCommentThreadIds, getPinnedEntriesWithParentContext } from "../src/domain/comments/commentPins";
import { cloneCommentThreadEntry } from "../src/domain/comments/commentThreadNormalization";

const entries = [
    { id: "root", body: "Parent", timestamp: 100 },
    { id: "child1", body: "Pinned", timestamp: 200, isPinned: true, pinUpdatedAt: 400 },
    { id: "child2", body: "Unpinned", timestamp: 300 },
];

test("pinned filtering includes reply-only pins, keeps parent context and preserves order", () => {
    const threads = [
        { id: "first", entries: [entries[0]], isPinned: false },
        { id: "second", entries, isPinned: false },
        { id: "third", entries: [entries[0]], isPinned: true },
    ];
    assert.deepEqual([...getPinnedCommentThreadIds(threads)], ["second", "third"]);
    assert.deepEqual(getPinnedEntriesWithParentContext(entries).map((entry) => entry.id), ["root", "child1"]);
    assert.deepEqual(getPinnedEntriesWithParentContext(entries, new Set(["child2"])), entries);
    assert.equal(entries.length, 3);
    assert.deepEqual([...getPinnedCommentThreadIds([{ id: "deleted", entries: [entries[0], { ...entries[1], deletedAt: 500 }] }])], []);
});

test("pin metadata survives normalization and merges independently of text versions", () => {
    const pin = { isPinned: true, pinUpdatedAt: 400 };
    const unpin = { isPinned: false, pinUpdatedAt: 500 };
    assert.deepEqual(cloneCommentThreadEntry(entries[1]), entries[1]);
    assert.deepEqual(mergeCommentPinState(pin, {}), pin);
    assert.deepEqual(mergeCommentPinState(unpin, pin), unpin);
    assert.deepEqual(mergeCommentPinState(pin, unpin), unpin);
    assert.deepEqual(normalizeCommentPinState({ isPinned: "yes", pinUpdatedAt: 500 }), {});
    assert.deepEqual(normalizeCommentPinState({ isPinned: true, pinUpdatedAt: -1 }), { isPinned: true });
});

import * as assert from "node:assert/strict";
import test from "node:test";
import type { CommentThread } from "../src/commentManager";
import { reconcileAnchoredNestedThreadDuplicates } from "../src/domain/comments/commentThreadReconciliation";

function createThread(id: string, selectedText: string): CommentThread {
    return {
        id,
        filePath: "docs/note.md",
        startLine: 1,
        startChar: 0,
        endLine: 1,
        endChar: selectedText.length,
        selectedText,
        selectedTextHash: `hash-${id}`,
        anchorKind: "selection",
        orphaned: false,
        entries: [{
            id,
            body: `${id} body`,
            timestamp: 100,
        }],
        createdAt: 100,
        updatedAt: 100,
    };
}

test("thread reconciliation removes a root already represented by an anchored nested entry", () => {
    const source = createThread("source-thread", "Source anchor");
    source.entries.push({
        id: "source-reply",
        body: "Preserve this reply",
        timestamp: 200,
    });
    source.updatedAt = 200;
    const target = createThread("target-thread", "Target anchor");
    target.entries.push({
        ...source.entries[0],
        anchor: {
            filePath: source.filePath,
            startLine: source.startLine,
            startChar: source.startChar,
            endLine: source.endLine,
            endChar: source.endChar,
            selectedText: source.selectedText,
            selectedTextHash: source.selectedTextHash,
            anchorKind: "selection",
        },
    });
    const input = [source, target];

    const reconciled = reconcileAnchoredNestedThreadDuplicates(input);

    assert.deepEqual(reconciled.removedRootThreadIds, [source.id]);
    assert.deepEqual(reconciled.threads.map((thread) => thread.id), [target.id]);
    assert.deepEqual(
        reconciled.threads[0]?.entries.map((entry) => entry.id),
        [target.id, source.id, "source-reply"],
    );
    assert.deepEqual(reconciled.threads[0]?.entries[1]?.anchor?.selectedText, source.selectedText);
    assert.deepEqual(input.map((thread) => thread.id), [source.id, target.id]);
    assert.deepEqual(source.entries.map((entry) => entry.id), [source.id, "source-reply"]);
});

test("thread reconciliation is idempotent", () => {
    const source = createThread("source-thread", "Source anchor");
    const target = createThread("target-thread", "Target anchor");
    target.entries.push({
        ...source.entries[0],
        anchor: {
            filePath: source.filePath,
            startLine: source.startLine,
            startChar: source.startChar,
            endLine: source.endLine,
            endChar: source.endChar,
            selectedText: source.selectedText,
            selectedTextHash: source.selectedTextHash,
            anchorKind: "selection",
        },
    });

    const first = reconcileAnchoredNestedThreadDuplicates([source, target]);
    const second = reconcileAnchoredNestedThreadDuplicates(first.threads);

    assert.deepEqual(second.threads, first.threads);
    assert.deepEqual(second.removedRootThreadIds, []);
});

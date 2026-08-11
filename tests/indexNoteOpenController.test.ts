import * as assert from "node:assert/strict";
import test from "node:test";
import { IndexNoteOpenController } from "../src/app/indexNoteOpenController";

interface Deferred<T> {
    promise: Promise<T>;
    resolve(value: T): void;
    reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createHarness(options: {
    indexExists: boolean;
    refreshAggregateNoteNow: () => Promise<void>;
}) {
    const calls: string[] = [];
    const refreshErrors: Array<{ context: "creation" | "background"; error: unknown }> = [];
    let indexExists = options.indexExists;

    const controller = new IndexNoteOpenController<string>({
        getIndexNotePath: () => "🐰 Aside Index.md",
        hasIndexNote: () => indexExists,
        revealIndexNote: async (filePath) => {
            calls.push(`reveal:${filePath}`);
            return "index-leaf";
        },
        refreshAggregateNoteNow: async () => {
            calls.push("refresh");
            await options.refreshAggregateNoteNow();
        },
        activateIndexSidebar: async () => {
            calls.push("activate-sidebar");
        },
        restoreIndexFocus: (focusTarget, filePath) => {
            calls.push(`restore:${focusTarget}:${filePath}`);
        },
        reportMissingIndex: (filePath) => {
            calls.push(`missing:${filePath}`);
        },
        handleRefreshError: (error, context) => {
            refreshErrors.push({ context, error });
        },
    });

    return {
        calls,
        controller,
        refreshErrors,
        setIndexExists(value: boolean) {
            indexExists = value;
        },
    };
}

test("existing index opens without waiting for aggregate refresh", async () => {
    const refresh = createDeferred<void>();
    const harness = createHarness({
        indexExists: true,
        refreshAggregateNoteNow: () => refresh.promise,
    });

    await harness.controller.open();

    assert.deepEqual(harness.calls, [
        "reveal:🐰 Aside Index.md",
        "refresh",
        "activate-sidebar",
        "restore:index-leaf:🐰 Aside Index.md",
    ]);
    refresh.resolve();
    await refresh.promise;
});

test("missing index waits for one creation refresh before opening", async () => {
    const refresh = createDeferred<void>();
    const harness = createHarness({
        indexExists: false,
        refreshAggregateNoteNow: () => refresh.promise,
    });

    const opening = harness.controller.open();
    await Promise.resolve();
    assert.deepEqual(harness.calls, ["refresh"]);

    harness.setIndexExists(true);
    refresh.resolve();
    await opening;

    assert.deepEqual(harness.calls, [
        "refresh",
        "reveal:🐰 Aside Index.md",
        "activate-sidebar",
        "restore:index-leaf:🐰 Aside Index.md",
    ]);
});

test("missing index reports the existing open error after failed creation", async () => {
    const refreshError = new Error("refresh failed");
    const harness = createHarness({
        indexExists: false,
        refreshAggregateNoteNow: async () => {
            throw refreshError;
        },
    });

    await harness.controller.open();

    assert.deepEqual(harness.calls, [
        "refresh",
        "missing:🐰 Aside Index.md",
    ]);
    assert.deepEqual(harness.refreshErrors, [{
        context: "creation",
        error: refreshError,
    }]);
});

test("background refresh failure is handled after an existing index opens", async () => {
    const refreshError = new Error("refresh failed");
    const harness = createHarness({
        indexExists: true,
        refreshAggregateNoteNow: async () => {
            throw refreshError;
        },
    });

    await harness.controller.open();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(harness.calls, [
        "reveal:🐰 Aside Index.md",
        "refresh",
        "activate-sidebar",
        "restore:index-leaf:🐰 Aside Index.md",
    ]);
    assert.deepEqual(harness.refreshErrors, [{
        context: "background",
        error: refreshError,
    }]);
});

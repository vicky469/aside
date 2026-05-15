import * as assert from "node:assert/strict";
import test from "node:test";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import {
    mergeSourceIdentityStates,
    SourceIdentityStore,
    type SourceIdentityState,
} from "../src/sync/sourceIdentityStore";

function createStore(options: {
    read: () => PersistedPluginData;
    write(data: PersistedPluginData): Promise<void>;
    now?: () => number;
    createSourceId?: () => string;
}): SourceIdentityStore {
    return new SourceIdentityStore({
        readPersistedPluginData: options.read,
        writePersistedPluginData: options.write,
        createSourceId: options.createSourceId ?? (() => "src-1"),
        now: options.now ?? (() => 1710000000000),
    });
}

test("source identity store records renames as current path plus aliases", async () => {
    let persistedData: PersistedPluginData = {};
    let idCounter = 0;
    const store = createStore({
        read: () => persistedData,
        write: async (data) => {
            persistedData = data;
        },
        createSourceId: () => `src-${++idCounter}`,
    });

    const original = await store.ensureSourceForPath("books/original.md", "fingerprint-a");
    const renamed = await store.recordRename("books/original.md", "books/renamed.md", "fingerprint-b");

    assert.equal(renamed.sourceId, original.sourceId);
    assert.equal(renamed.currentPath, "books/renamed.md");
    assert.deepEqual(renamed.aliases, ["books/original.md"]);
    assert.equal(renamed.contentFingerprint, "fingerprint-b");
    assert.equal(store.getRecordByPath("books/renamed.md")?.sourceId, original.sourceId);
    assert.equal(store.getRecordByPath("books/original.md"), null);
    assert.equal(store.getRecordByPathIncludingAliases("books/original.md")?.sourceId, original.sourceId);
});

test("source identity state merge preserves aliases and indexes only current paths", () => {
    const left: SourceIdentityState = {
        schemaVersion: 1,
        sources: {
            "src-1": {
                sourceId: "src-1",
                currentPath: "books/old.md",
                aliases: [],
                contentFingerprint: "fingerprint-a",
                createdAt: 1,
                updatedAt: 2,
            },
        },
        pathToSourceId: {
            "books/old.md": "src-1",
        },
    };
    const right: SourceIdentityState = {
        schemaVersion: 1,
        sources: {
            "src-1": {
                sourceId: "src-1",
                currentPath: "books/new.md",
                aliases: ["books/old.md"],
                contentFingerprint: "fingerprint-b",
                createdAt: 1,
                updatedAt: 3,
            },
        },
        pathToSourceId: {
            "books/old.md": "src-1",
            "books/new.md": "src-1",
        },
    };

    const merged = mergeSourceIdentityStates(left, right);

    assert.equal(merged.sources["src-1"].currentPath, "books/new.md");
    assert.deepEqual(merged.sources["src-1"].aliases, ["books/old.md"]);
    assert.equal(merged.sources["src-1"].contentFingerprint, "fingerprint-b");
    assert.equal(merged.pathToSourceId["books/new.md"], "src-1");
    assert.equal(merged.pathToSourceId["books/old.md"], undefined);
});

test("source identity store does not claim a recreated file through a stale alias", async () => {
    let persistedData: PersistedPluginData = {};
    let idCounter = 0;
    const store = createStore({
        read: () => persistedData,
        write: async (data) => {
            persistedData = data;
        },
        createSourceId: () => `src-${++idCounter}`,
        now: () => 1710000000000 + idCounter,
    });

    const original = await store.ensureSourceForPath("books/original.md", "fingerprint-a");
    await store.recordRename("books/original.md", "books/renamed.md", "fingerprint-b");
    const recreated = await store.ensureSourceForPath("books/original.md", "fingerprint-c");

    assert.notEqual(recreated.sourceId, original.sourceId);
    assert.equal(recreated.currentPath, "books/original.md");
    assert.equal(store.getRecordByPath("books/original.md")?.sourceId, recreated.sourceId);
    assert.equal(store.getRecordByPath("books/renamed.md")?.sourceId, original.sourceId);
});

test("source identity store removes deleted paths from persisted state", async () => {
    let persistedData: PersistedPluginData = {};
    let idCounter = 0;
    const store = createStore({
        read: () => persistedData,
        write: async (data) => {
            persistedData = data;
        },
        createSourceId: () => `src-${++idCounter}`,
    });

    const removed = await store.ensureSourceForPath("books/deleted.md", "fingerprint-a");
    const kept = await store.ensureSourceForPath("books/kept.md", "fingerprint-b");

    assert.equal((await store.removeSourceForPath("books/deleted.md"))?.sourceId, removed.sourceId);
    assert.equal(store.getRecordByPath("books/deleted.md"), null);
    assert.equal(store.getRecordByPath("books/kept.md")?.sourceId, kept.sourceId);
});

test("source identity store removes every source under a deleted folder", async () => {
    let persistedData: PersistedPluginData = {};
    let idCounter = 0;
    const store = createStore({
        read: () => persistedData,
        write: async (data) => {
            persistedData = data;
        },
        createSourceId: () => `src-${++idCounter}`,
    });

    await store.ensureSourceForPath("Deleted/a.md");
    await store.ensureSourceForPath("Deleted/nested/b.md");
    const kept = await store.ensureSourceForPath("Deletedness/c.md");

    const removed = await store.removeSourcesInFolder("Deleted");

    assert.deepEqual(removed.map((record) => record.currentPath), [
        "Deleted/a.md",
        "Deleted/nested/b.md",
    ]);
    assert.equal(store.getRecordByPath("Deleted/a.md"), null);
    assert.equal(store.getRecordByPath("Deleted/nested/b.md"), null);
    assert.equal(store.getRecordByPath("Deletedness/c.md")?.sourceId, kept.sourceId);
});

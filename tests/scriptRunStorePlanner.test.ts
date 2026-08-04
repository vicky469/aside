import * as assert from "node:assert/strict";
import test from "node:test";
import {
    cloneScriptRunRecord,
    cloneScriptRunRecords,
    getLatestScriptRunForTriggerEntry,
    getScriptRunById,
    getScriptRunByOutputEntryId,
    getScriptRunsForThread,
    type ScriptRunRecord,
} from "../src/core/scripts/scriptRuns";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import { ScriptRunStore } from "../src/vaultScripts/scriptRunStore";
import { normalizePersistedScriptRuns } from "../src/vaultScripts/scriptRunStorePlanner";

function createRun(overrides: Partial<ScriptRunRecord> = {}): ScriptRunRecord {
    return {
        id: "script-run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-1",
        filePath: "Note.md",
        scriptPath: "🛠️ scripts/clean.mjs",
        mentionName: "clean",
        status: "succeeded",
        promptText: "@clean",
        createdAt: 100,
        startedAt: 101,
        endedAt: 102,
        outputEntryId: "entry-2",
        ...overrides,
    };
}

test("normalizePersistedScriptRuns keeps strict valid records and rejects malformed records", () => {
    assert.deepEqual(normalizePersistedScriptRuns([
        {
            id: "script-run-queued",
            threadId: "thread-1",
            triggerEntryId: "entry-1",
            filePath: "Note.md",
            scriptPath: "🛠️ scripts/clean.mjs",
            mentionName: "clean",
            status: "queued",
            promptText: "@clean",
            createdAt: 100,
        },
        {
            ...createRun(),
            retryOfRunId: "script-run-original",
        },
        null,
        [],
        { ...createRun(), id: " " },
        { ...createRun(), status: "cancelled" },
        { ...createRun(), promptText: null },
        { ...createRun(), createdAt: Number.POSITIVE_INFINITY },
    ]), [
        {
            id: "script-run-queued",
            threadId: "thread-1",
            triggerEntryId: "entry-1",
            filePath: "Note.md",
            scriptPath: "🛠️ scripts/clean.mjs",
            mentionName: "clean",
            status: "queued",
            promptText: "@clean",
            createdAt: 100,
            startedAt: undefined,
            endedAt: undefined,
            retryOfRunId: undefined,
            outputEntryId: undefined,
            error: undefined,
        },
        {
            ...createRun(),
            retryOfRunId: "script-run-original",
            error: undefined,
        },
    ]);
    assert.deepEqual(normalizePersistedScriptRuns({}), []);
});

test("script-run clones and lookups return the intended detached records", () => {
    const first = createRun();
    const retry = createRun({
        id: "script-run-2",
        triggerEntryId: "entry-1",
        outputEntryId: "entry-3",
        retryOfRunId: first.id,
        createdAt: 200,
    });
    const otherThread = createRun({
        id: "script-run-3",
        threadId: "thread-2",
        triggerEntryId: "entry-4",
        outputEntryId: "entry-2",
        createdAt: 300,
    });
    const runs = [first, retry, otherThread];

    assert.equal(getScriptRunById(runs, retry.id), retry);
    assert.equal(getScriptRunByOutputEntryId(runs, "entry-2"), otherThread);
    assert.equal(getLatestScriptRunForTriggerEntry(runs, "entry-1"), retry);
    assert.equal(getScriptRunById(runs, "missing"), null);
    assert.equal(getScriptRunByOutputEntryId(runs, "missing"), null);
    assert.equal(getLatestScriptRunForTriggerEntry(runs, "missing"), null);

    const threadRuns = getScriptRunsForThread(runs, { id: "thread-1" });
    assert.deepEqual(threadRuns, [first, retry]);
    assert.notEqual(threadRuns[0], first);

    const cloned = cloneScriptRunRecord(first);
    const clonedMany = cloneScriptRunRecords(runs);
    cloned.filePath = "Changed.md";
    clonedMany[0].mentionName = "changed";
    assert.equal(first.filePath, "Note.md");
    assert.equal(first.mentionName, "clean");
});

test("ScriptRunStore mutates through immutable replacements and preserves other plugin data", async () => {
    const retainedAgentRuns = [{ id: "agent-run" }];
    let persistedData: PersistedPluginData = {
        agentRuns: retainedAgentRuns,
        scriptRuns: [createRun({ status: "queued", startedAt: undefined, endedAt: undefined })],
    };
    const writes: PersistedPluginData[] = [];
    const store = new ScriptRunStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
            writes.push(data);
        },
    });
    store.load();

    const loaded = store.getRuns();
    loaded[0].filePath = "Mutated.md";
    assert.equal(store.getRuns()[0]?.filePath, "Note.md");

    const addedInput = createRun({
        id: "script-run-2",
        status: "running",
        triggerEntryId: "entry-2",
        outputEntryId: undefined,
        startedAt: 201,
        endedAt: undefined,
        createdAt: 200,
    });
    const added = await store.addRun(addedInput);
    addedInput.filePath = "Mutated input.md";
    added.filePath = "Mutated result.md";
    assert.equal(store.getRunById("script-run-2")?.filePath, "Note.md");
    assert.equal(persistedData.agentRuns, retainedAgentRuns);

    const updated = await store.updateRun("script-run-2", (run) => {
        run.status = "succeeded";
        run.outputEntryId = "entry-output";
        return run;
    });
    assert.equal(updated?.status, "succeeded");
    if (updated) updated.status = "failed";
    assert.equal(store.getRunById("script-run-2")?.status, "succeeded");
    assert.equal(await store.updateRun("missing", (run) => run), null);

    assert.equal(await store.failPendingRuns("Interrupted", 300), true);
    assert.deepEqual(store.getRunById("script-run-1"), {
        ...createRun({ status: "queued", startedAt: undefined, endedAt: undefined }),
        status: "failed",
        endedAt: 300,
        retryOfRunId: undefined,
        error: "Interrupted",
    });
    assert.equal(await store.failPendingRuns("Again", 301), false);

    assert.equal(await store.renameFile("Note.md", "Renamed.md"), true);
    assert.ok(store.getRuns().every((run) => run.filePath === "Renamed.md"));
    assert.equal(await store.renameFile("Missing.md", "Other.md"), false);
    assert.equal(await store.renameFile("Renamed.md", "Renamed.md"), false);
    assert.equal(writes.length, 4);
    assert.equal(persistedData.agentRuns, retainedAgentRuns);
});

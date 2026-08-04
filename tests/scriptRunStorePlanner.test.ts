import * as assert from "node:assert/strict";
import test from "node:test";
import { AgentRunStore } from "../src/agents/agentRunStore";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
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

function createAgentRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
    return {
        id: "agent-run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-agent",
        filePath: "Note.md",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "queued",
        promptText: "@codex",
        createdAt: 100,
        ...overrides,
    };
}

function createAtomicStoreHost(
    initialData: PersistedPluginData = {},
    beforeCommit?: (data: PersistedPluginData) => Promise<void>,
) {
    let persistedData = initialData;
    let updateQueue: Promise<void> = Promise.resolve();
    return {
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: (updater: (data: PersistedPluginData) => PersistedPluginData) => {
            const result = updateQueue.then(async () => {
                const nextData = updater({ ...persistedData });
                await beforeCommit?.(nextData);
                persistedData = nextData;
                return { ...nextData };
            });
            updateQueue = result.then(() => undefined, () => undefined);
            return result;
        },
        getPersistedData: () => persistedData,
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
        updatePersistedPluginData: async (updater) => {
            persistedData = updater({ ...persistedData });
            writes.push(persistedData);
            return { ...persistedData };
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

test("ScriptRunStore serializes overlapping adds and snapshots caller input before awaiting", async () => {
    let releaseFirstSave = () => {};
    let persistedData: PersistedPluginData = {};
    let saveCount = 0;
    const store = new ScriptRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            const nextData = updater({ ...persistedData });
            saveCount += 1;
            if (saveCount === 1) {
                await new Promise<void>((resolve) => {
                    releaseFirstSave = resolve;
                });
            }
            persistedData = nextData;
            return { ...persistedData };
        },
    });
    const firstInput = createRun({ id: "script-run-a" });

    const firstAdd = store.addRun(firstInput);
    const secondAdd = store.addRun(createRun({ id: "script-run-b" }));
    firstInput.mentionName = "caller-mutated";
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(saveCount, 1);
    releaseFirstSave();

    const [firstResult] = await Promise.all([firstAdd, secondAdd]);
    assert.equal(firstResult.mentionName, "clean");
    assert.deepEqual(store.getRuns().map((run) => run.id), ["script-run-a", "script-run-b"]);
    assert.deepEqual(
        (persistedData.scriptRuns as ScriptRunRecord[]).map((run) => run.id),
        ["script-run-a", "script-run-b"],
    );
});

test("ScriptRunStore keeps memory unchanged after persistence failure and accepts a later mutation", async () => {
    let persistedData: PersistedPluginData = {};
    let shouldFail = true;
    const store = new ScriptRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            const nextData = updater({ ...persistedData });
            if (shouldFail) {
                shouldFail = false;
                throw new Error("save failed");
            }
            persistedData = nextData;
            return { ...persistedData };
        },
    });

    await assert.rejects(store.addRun(createRun({ id: "failed-run" })), /save failed/u);
    assert.deepEqual(store.getRuns(), []);
    await store.addRun(createRun({ id: "saved-run" }));
    assert.deepEqual(store.getRuns().map((run) => run.id), ["saved-run"]);
});

test("agent and script run stores preserve both fields through the shared atomic host", async () => {
    let updateCount = 0;
    let releaseFirstUpdate = () => {};
    const host = createAtomicStoreHost({}, async () => {
        updateCount += 1;
        if (updateCount === 1) {
            await new Promise<void>((resolve) => {
                releaseFirstUpdate = resolve;
            });
        }
    });
    const agentStore = new AgentRunStore(host);
    const scriptStore = new ScriptRunStore(host);

    const additions = Promise.all([
        agentStore.addRun(createAgentRun()),
        scriptStore.addRun(createRun()),
    ]);
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(updateCount, 1);
    releaseFirstUpdate();
    await additions;

    assert.deepEqual((host.getPersistedData().agentRuns as AgentRunRecord[]).map((run) => run.id), ["agent-run-1"]);
    assert.deepEqual((host.getPersistedData().scriptRuns as ScriptRunRecord[]).map((run) => run.id), ["script-run-1"]);
});

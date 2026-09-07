import * as assert from "node:assert/strict";
import test from "node:test";
import { AgentRunStore } from "../src/agents/agentRunStore";
import {
    clonePersistedAgentRuns,
    normalizePersistedAgentRuns,
} from "../src/agents/agentRunStorePlanner";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";

const ACTIVE_EVENT_CONTEXT = {
    signal: new AbortController().signal,
    isActive: () => true,
};

function createRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
    return {
        id: "agent-run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-1",
        filePath: "Note.md",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "queued",
        promptText: "@codex",
        createdAt: 100,
        ...overrides,
    };
}

function createDeferred() {
    let resolvePromise!: () => void;
    const promise = new Promise<void>((resolve) => {
        resolvePromise = resolve;
    });
    return { promise, resolve: resolvePromise };
}

test("normalizePersistedAgentRuns keeps valid records, normalizes legacy remote runs, and drops malformed ones", () => {
    assert.deepEqual(normalizePersistedAgentRuns([
        {
            id: "run-1",
            threadId: "thread-1",
            triggerEntryId: "entry-1",
            filePath: "Folder/Note.md",
            requestedAgent: "CLAUDE",
            runtime: "openclaw-acp",
            status: "queued",
            promptText: "@claude review this",
            createdAt: 100,
            remoteExecutionId: "remote-run-1",
            remoteCursor: "evt-1",
            usedSkills: [
                { name: " aside ", mode: " write ", source: " built-in " },
                { name: "" },
            ],
            usedTools: [" browser-use.browser_navigate ", "", 1],
            usedFiles: [
                " Folder/Note.md ",
                "Folder/Note.md",
                "",
                7,
            ],
            usedUrls: [
                "https://example.com/path?token=secret#frag",
                "not a url",
            ],
            usedToolErrors: [
                { name: " WebSearch (unavailable) ", payload: " unavailable " },
                { name: "", payload: "ignored" },
            ],
        },
        {
            id: "bad-run",
            threadId: null,
        },
    ]), [{
        id: "run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-1",
        filePath: "Folder/Note.md",
        requestedAgent: "claude",
        runtime: "direct-cli",
        status: "queued",
        promptText: "@claude review this",
        createdAt: 100,
        startedAt: undefined,
        endedAt: undefined,
        retryOfRunId: undefined,
        outputEntryId: undefined,
        error: undefined,
        modePreference: undefined,
        usedSkills: [{
            name: "aside",
            mode: "write",
            source: "built-in",
        }],
        usedTools: ["browser-use.browser_navigate"],
        usedFiles: ["Folder/Note.md"],
        usedUrls: ["https://example.com/path"],
        usedToolErrors: [{
            name: "WebSearch",
            payload: "unavailable",
        }],
    }]);
});

test("normalizePersistedAgentRuns seeds file metadata from the run file path", () => {
    assert.deepEqual(normalizePersistedAgentRuns([{
        id: "run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-1",
        filePath: "Folder/Note.md",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "succeeded",
        promptText: "@codex explain",
        createdAt: 100,
    }])[0]?.usedFiles, ["Folder/Note.md"]);
});

test("normalizePersistedAgentRuns keeps supported create-script fallback metadata", () => {
    const runs = normalizePersistedAgentRuns([{
        id: "run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-1",
        filePath: "Folder/Note.md",
        requestedAgent: "claude",
        preferredAgent: " GEMINI ",
        requestKind: "create-script",
        runtime: "direct-cli",
        status: "queued",
        promptText: "build a cleaner",
        createdAt: 100,
    }, {
        id: "run-2",
        threadId: "thread-2",
        triggerEntryId: "entry-2",
        filePath: "Folder/Other.md",
        requestedAgent: "codex",
        preferredAgent: "unknown",
        requestKind: "unknown",
        runtime: "direct-cli",
        status: "queued",
        promptText: "@codex explain",
        createdAt: 101,
    }]);

    assert.equal(runs[0]?.requestKind, "create-script");
    assert.equal(runs[0]?.preferredAgent, "gemini");
    assert.equal(runs[1]?.requestKind, undefined);
    assert.equal(runs[1]?.preferredAgent, undefined);
});

test("normalizePersistedAgentRuns keeps durable pdf-to-markdown metadata", () => {
    const runs = normalizePersistedAgentRuns([{
        id: "run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-1",
        filePath: "Books/Guide.pdf",
        requestedAgent: "claude",
        preferredAgent: " GEMINI ",
        requestKind: "pdf-to-markdown",
        targetScriptPath: "ignored.mjs",
        runtime: "direct-cli",
        status: "queued",
        promptText: "/pdf-to-markdown",
        createdAt: 100,
    }]);

    assert.equal(runs[0]?.requestKind, "pdf-to-markdown");
    assert.equal(runs[0]?.preferredAgent, "gemini");
    assert.equal(runs[0]?.targetScriptPath, undefined);
    assert.equal(clonePersistedAgentRuns(runs)[0]?.requestKind, "pdf-to-markdown");
});

test("normalizePersistedAgentRuns keeps valid update-script targets only", () => {
    const runs = normalizePersistedAgentRuns([{
        id: "run-1",
        threadId: "thread-1",
        triggerEntryId: "entry-1",
        filePath: "Folder/Note.md",
        requestedAgent: "codex",
        requestKind: "update-script",
        targetScriptPath: " 🛠️ scripts/embed-image-urls.mjs ",
        runtime: "direct-cli",
        status: "queued",
        promptText: "make the default size reasonable",
        createdAt: 100,
    }, {
        id: "run-2",
        threadId: "thread-2",
        triggerEntryId: "entry-2",
        filePath: "Folder/Other.md",
        requestedAgent: "codex",
        requestKind: "update-script",
        runtime: "direct-cli",
        status: "queued",
        promptText: "change it",
        createdAt: 101,
    }]);

    assert.equal(runs[0]?.requestKind, "update-script");
    assert.equal(runs[0]?.targetScriptPath, "🛠️ scripts/embed-image-urls.mjs");
    assert.equal(clonePersistedAgentRuns(runs)[0]?.targetScriptPath, "🛠️ scripts/embed-image-urls.mjs");
    assert.equal(runs[1]?.requestKind, undefined);
    assert.equal(runs[1]?.targetScriptPath, undefined);
});

test("AgentRunStore snapshots add input and leaves memory unchanged when persistence fails", async () => {
    let persistedData: PersistedPluginData = {};
    let saveAttempt = 0;
    let releaseFirstSave = () => {};
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            const nextData = updater({ ...persistedData });
            saveAttempt += 1;
            if (saveAttempt === 1) {
                await new Promise<void>((resolve) => {
                    releaseFirstSave = resolve;
                });
                throw new Error("save failed");
            }
            persistedData = nextData;
            return { ...persistedData };
        },
    });
    const failedInput = createRun({ id: "failed-run" });

    const failedAdd = store.addRun(failedInput);
    failedInput.promptText = "caller-mutated";
    await new Promise<void>((resolve) => setImmediate(resolve));
    releaseFirstSave();
    await assert.rejects(failedAdd, /save failed/u);
    assert.deepEqual(store.getRuns(), []);

    const savedInput = createRun({ id: "saved-run" });
    const saved = await store.addRun(savedInput);
    savedInput.promptText = "mutated after save";
    assert.equal(saved.promptText, "@codex");
    assert.deepEqual(store.getRuns().map((run) => run.id), ["saved-run"]);
});

test("AgentRunStore retargets every folder descendant with one persisted write", async () => {
    let persistedData: PersistedPluginData = {
        agentRuns: [
            createRun({ id: "a", filePath: "Drafts/a.md" }),
            createRun({ id: "b", filePath: "Drafts/nested/b.md" }),
            createRun({ id: "keep", filePath: "Draftsness/keep.md" }),
        ],
    };
    let writeCount = 0;
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            writeCount += 1;
            persistedData = updater({ ...persistedData });
            return { ...persistedData };
        },
    });
    store.load();

    assert.equal(await store.renameFolder("Drafts", "Published", ACTIVE_EVENT_CONTEXT), true);

    assert.equal(writeCount, 1);
    assert.deepEqual(store.getRuns().map((run) => run.filePath), [
        "Published/a.md",
        "Published/nested/b.md",
        "Draftsness/keep.md",
    ]);
    assert.equal(await store.renameFolder("Missing", "Other", ACTIVE_EVENT_CONTEXT), false);
    assert.equal(writeCount, 1);
});

test("AgentRunStore aborts a queued folder retarget before stale persistence or memory commits", async () => {
    const transactionStarted = createDeferred();
    const releaseTransaction = createDeferred();
    const abortController = new AbortController();
    let persistedData: PersistedPluginData = {
        agentRuns: [createRun({ id: "old", filePath: "Drafts/a.md" })],
    };
    let transactionCount = 0;
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            transactionCount += 1;
            transactionStarted.resolve();
            await releaseTransaction.promise;
            persistedData = updater({ ...persistedData });
            if (transactionCount === 1) {
                throw new Error("stale persistence failed after abort");
            }
            return { ...persistedData };
        },
    });
    store.load();
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };

    const staleRename = store.renameFolder("Drafts", "Published", context);
    await transactionStarted.promise;
    abortController.abort();
    persistedData = {
        agentRuns: [createRun({ id: "reloaded", filePath: "Reloaded/a.md" })],
    };
    store.load();
    releaseTransaction.resolve();

    assert.equal(await staleRename, false);
    assert.deepEqual((persistedData.agentRuns as AgentRunRecord[]).map((run) => run.filePath), ["Reloaded/a.md"]);
    assert.deepEqual(store.getRuns().map((run) => run.filePath), ["Reloaded/a.md"]);

    const currentContext = {
        signal: new AbortController().signal,
        isActive: () => true,
    };
    assert.equal(await store.renameFolder("Reloaded", "Current", currentContext), true);
    assert.deepEqual(store.getRuns().map((run) => run.filePath), ["Current/a.md"]);
});

test("AgentRunStore aborts a queued file retarget before stale persistence or memory commits", async () => {
    const transactionStarted = createDeferred();
    const releaseTransaction = createDeferred();
    const abortController = new AbortController();
    let persistedData: PersistedPluginData = {
        agentRuns: [createRun({ id: "old", filePath: "Draft.md" })],
    };
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            transactionStarted.resolve();
            await releaseTransaction.promise;
            persistedData = updater({ ...persistedData });
            throw new Error("stale file persistence failed after abort");
        },
    });
    store.load();
    const context = {
        signal: abortController.signal,
        isActive: () => !abortController.signal.aborted,
    };

    const staleRename = store.renameFile("Draft.md", "Published.md", context);
    await transactionStarted.promise;
    abortController.abort();
    persistedData = {
        agentRuns: [createRun({ id: "reloaded", filePath: "Reloaded.md" })],
    };
    store.load();
    releaseTransaction.resolve();

    assert.equal(await staleRename, false);
    assert.deepEqual((persistedData.agentRuns as AgentRunRecord[]).map((run) => run.filePath), ["Reloaded.md"]);
    assert.deepEqual(store.getRuns().map((run) => run.filePath), ["Reloaded.md"]);
});

test("AgentRunStore preserves active local runs across external reloads", async () => {
    let persistedData: PersistedPluginData = {
        agentRuns: [createRun({
            id: "local-run",
            status: "queued",
        })],
    };
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            persistedData = updater({ ...persistedData });
            return { ...persistedData };
        },
    });
    store.load();
    persistedData = {
        agentRuns: [createRun({
            id: "remote-run",
            status: "succeeded",
            createdAt: 50,
        })],
    };

    await store.reloadPreservingActiveRuns();

    assert.deepEqual(store.getRuns().map((run) => run.id), ["remote-run", "local-run"]);
    assert.equal(store.getRunById("local-run")?.status, "queued");
});

test("AgentRunStore preserves a run that finishes while external settings load", async () => {
    let persistedData: PersistedPluginData = {
        agentRuns: [createRun({
            id: "local-run",
            status: "running",
        })],
    };
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            persistedData = updater({ ...persistedData });
            return { ...persistedData };
        },
    });
    store.load();
    const locallyActiveRunIds = store.getActiveRunIds();
    await store.updateRun("local-run", (run) => ({
        ...run,
        status: "succeeded",
        endedAt: 200,
    }));
    persistedData = {
        agentRuns: [createRun({
            id: "remote-run",
            status: "succeeded",
            createdAt: 50,
        })],
    };

    await store.reloadPreservingActiveRuns(locallyActiveRunIds);

    assert.deepEqual(store.getRuns().map((run) => run.id), ["remote-run", "local-run"]);
    assert.equal(store.getRunById("local-run")?.status, "succeeded");
});

test("AgentRunStore preserves a new run completed during external settings load", async () => {
    const existingRun = createRun({
        id: "existing-run",
        status: "succeeded",
        createdAt: 50,
    });
    let persistedData: PersistedPluginData = {
        agentRuns: [existingRun],
    };
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            persistedData = updater({ ...persistedData });
            return { ...persistedData };
        },
    });
    store.load();
    const runIdsBeforeLoad = store.getRuns().map((run) => run.id);
    await store.addRun(createRun({
        id: "new-completed-run",
        status: "succeeded",
        createdAt: 100,
    }));
    persistedData = {
        agentRuns: [existingRun],
    };

    await store.reloadPreservingActiveRuns([], runIdsBeforeLoad);

    assert.deepEqual(
        store.getRuns().map((run) => run.id),
        ["existing-run", "new-completed-run"],
    );
});

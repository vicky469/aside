import * as assert from "node:assert/strict";
import test from "node:test";
import { AgentRunStore } from "../src/agents/agentRunStore";
import { normalizePersistedAgentRuns } from "../src/agents/agentRunStorePlanner";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";

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

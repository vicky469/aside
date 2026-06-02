import * as assert from "node:assert/strict";
import test from "node:test";
import { normalizePersistedAgentRuns } from "../src/agents/agentRunStorePlanner";

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
    }]);
});

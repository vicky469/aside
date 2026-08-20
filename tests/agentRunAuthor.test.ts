import * as assert from "node:assert/strict";
import test from "node:test";
import type { AgentRunRecord } from "../src/core/agents/agentRuns";
import { getAgentRunAuthorLabel } from "../src/ui/views/agentRunAuthor";

function createAgentRun(overrides: Partial<AgentRunRecord> = {}): AgentRunRecord {
    return {
        id: "run-1",
        threadId: "thread-1",
        triggerEntryId: "thread-1",
        filePath: "Folder/Note.md",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "running",
        promptText: "build a cleaner",
        createdAt: 100,
        ...overrides,
    };
}

test("getAgentRunAuthorLabel identifies the selected fallback agent", () => {
    assert.equal(getAgentRunAuthorLabel(createAgentRun({
        requestKind: "create-script",
        requestedAgent: "claude",
        preferredAgent: "gemini",
    })), "Claude Code (fallback for Gemini)");
});

test("getAgentRunAuthorLabel keeps ordinary and preferred-agent labels compact", () => {
    assert.equal(getAgentRunAuthorLabel(createAgentRun({
        requestedAgent: "codex",
    })), "Codex");
    assert.equal(getAgentRunAuthorLabel(createAgentRun({
        requestedAgent: "gemini",
        preferredAgent: "gemini",
    })), "Gemini");
});

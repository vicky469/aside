import { cloneAgentRunRecords, type AgentRunRecord, type AgentRunRuntime, type AgentRunStatus } from "../core/agents/agentRuns";
import { normalizeAgentRuntimeModePreference } from "../core/agents/agentRuntimePreferences";
import { normalizeAgentTarget } from "../core/config/agentTargets";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeRuntime(value: unknown): AgentRunRuntime {
    return value === "openclaw-acp" ? "openclaw-acp" : "direct-cli";
}

function normalizeStatus(value: unknown): AgentRunStatus | null {
    switch (value) {
        case "queued":
        case "running":
        case "succeeded":
        case "failed":
        case "cancelled":
            return value;
        default:
            return null;
    }
}

function normalizeOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function normalizeOptionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim()
        ? value
        : undefined;
}

function normalizeAgentRunRecord(value: unknown): AgentRunRecord | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = normalizeOptionalString(value.id);
    const threadId = normalizeOptionalString(value.threadId);
    const triggerEntryId = normalizeOptionalString(value.triggerEntryId);
    const filePath = normalizeOptionalString(value.filePath);
    const promptText = typeof value.promptText === "string"
        ? value.promptText
        : null;
    const createdAt = normalizeOptionalNumber(value.createdAt);
    const status = normalizeStatus(value.status);

    if (!id || !threadId || !triggerEntryId || !filePath || promptText === null || !createdAt || !status) {
        return null;
    }

    return {
        id,
        threadId,
        triggerEntryId,
        filePath,
        requestedAgent: normalizeAgentTarget(value.requestedAgent),
        runtime: normalizeRuntime(value.runtime),
        status,
        promptText,
        createdAt,
        startedAt: normalizeOptionalNumber(value.startedAt),
        endedAt: normalizeOptionalNumber(value.endedAt),
        retryOfRunId: normalizeOptionalString(value.retryOfRunId),
        outputEntryId: normalizeOptionalString(value.outputEntryId),
        error: normalizeOptionalString(value.error),
        modePreference: normalizeOptionalString(value.modePreference)
            ? normalizeAgentRuntimeModePreference(value.modePreference)
            : undefined,
        remoteExecutionId: normalizeOptionalString(value.remoteExecutionId),
        remoteCursor: normalizeOptionalString(value.remoteCursor),
    };
}

export function normalizePersistedAgentRuns(value: unknown): AgentRunRecord[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => normalizeAgentRunRecord(item))
        .filter((item): item is AgentRunRecord => !!item);
}

export function clonePersistedAgentRuns(runs: AgentRunRecord[]): AgentRunRecord[] {
    return cloneAgentRunRecords(runs);
}

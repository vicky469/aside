import {
    type ScriptRunRecord,
    type ScriptRunStatus,
} from "../core/scripts/scriptRuns";

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeStatus(value: unknown): ScriptRunStatus | null {
    switch (value) {
        case "queued":
        case "running":
        case "succeeded":
        case "failed":
            return value;
        default:
            return null;
    }
}

function normalizeRequiredString(value: unknown): string | null {
    return typeof value === "string" && value.trim()
        ? value
        : null;
}

function normalizeOptionalString(value: unknown): string | undefined {
    return normalizeRequiredString(value) ?? undefined;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value)
        ? value
        : undefined;
}

function normalizeScriptRunRecord(value: unknown): ScriptRunRecord | null {
    if (!isRecord(value)) {
        return null;
    }

    const id = normalizeRequiredString(value.id);
    const threadId = normalizeRequiredString(value.threadId);
    const triggerEntryId = normalizeRequiredString(value.triggerEntryId);
    const filePath = normalizeRequiredString(value.filePath);
    const scriptPath = normalizeRequiredString(value.scriptPath);
    const mentionName = normalizeRequiredString(value.mentionName);
    const status = normalizeStatus(value.status);
    const promptText = typeof value.promptText === "string"
        ? value.promptText
        : null;
    const createdAt = typeof value.createdAt === "number" && Number.isFinite(value.createdAt)
        ? value.createdAt
        : null;

    if (
        !id
        || !threadId
        || !triggerEntryId
        || !filePath
        || !scriptPath
        || !mentionName
        || !status
        || promptText === null
        || createdAt === null
    ) {
        return null;
    }

    return {
        id,
        threadId,
        triggerEntryId,
        filePath,
        scriptPath,
        mentionName,
        status,
        promptText,
        createdAt,
        startedAt: normalizeOptionalNumber(value.startedAt),
        endedAt: normalizeOptionalNumber(value.endedAt),
        retryOfRunId: normalizeOptionalString(value.retryOfRunId),
        outputEntryId: normalizeOptionalString(value.outputEntryId),
        error: normalizeOptionalString(value.error),
    };
}

export function normalizePersistedScriptRuns(value: unknown): ScriptRunRecord[] {
    if (!Array.isArray(value)) {
        return [];
    }

    return value
        .map((item) => normalizeScriptRunRecord(item))
        .filter((item): item is ScriptRunRecord => !!item);
}

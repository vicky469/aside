import type { CommentThread } from "../../commentManager";
import type { AsideAgentTarget } from "../config/agentTargets";
import type { AgentRuntimeModePreference } from "./agentRuntimePreferences";

export type AgentRunRuntime = "direct-cli";
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentRunSkillMetadata {
    name: string;
    mode?: string;
    source?: string;
}

export interface AgentRunToolErrorMetadata {
    name: string;
    payload: string;
}

export interface AgentRunMetadata {
    usedSkills?: AgentRunSkillMetadata[];
    usedTools?: string[];
    usedUrls?: string[];
    usedToolErrors?: AgentRunToolErrorMetadata[];
}

export interface AgentRunStreamState {
    runId: string;
    threadId: string;
    requestedAgent: AsideAgentTarget;
    runtime: AgentRunRuntime;
    status: AgentRunStatus;
    statusText?: string;
    statusHintText?: string;
    processLogLines?: string[];
    partialText: string;
    startedAt: number;
    updatedAt: number;
    outputEntryId?: string;
    error?: string;
    usedSkills?: AgentRunSkillMetadata[];
    usedTools?: string[];
    usedUrls?: string[];
    usedToolErrors?: AgentRunToolErrorMetadata[];
}

export interface AgentRunRecord extends AgentRunMetadata {
    id: string;
    threadId: string;
    triggerEntryId: string;
    filePath: string;
    requestedAgent: AsideAgentTarget;
    runtime: AgentRunRuntime;
    status: AgentRunStatus;
    promptText: string;
    createdAt: number;
    startedAt?: number;
    endedAt?: number;
    retryOfRunId?: string;
    outputEntryId?: string;
    error?: string;
    modePreference?: AgentRuntimeModePreference;
}

function normalizeMetadataToken(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.replace(/\s+/gu, " ").trim();
    return normalized || null;
}

function normalizeMetadataPayload(value: unknown): string | null {
    if (typeof value === "string") {
        const normalized = value.replace(/\r\n?/gu, "\n").trim();
        return normalized || null;
    }

    if (value == null) {
        return null;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return "[unserializable payload]";
    }
}

export function getAgentRunToolBaseName(value: string): string {
    return value.replace(/\s+\(unavailable\)$/iu, "").trim();
}

export function formatUnavailableAgentRunToolName(value: string): string {
    const baseName = getAgentRunToolBaseName(value);
    return baseName ? `${baseName} (unavailable)` : value;
}

export function sanitizeAgentRunUrl(value: unknown): string | null {
    const normalized = normalizeMetadataToken(value);
    if (!normalized) {
        return null;
    }

    try {
        const url = new URL(normalized);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return null;
        }

        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return null;
    }
}

function splitAgentRunUrlCandidates(value: unknown): string[] {
    if (typeof value !== "string") {
        return [];
    }

    return value
        .replace(/\r\n?/gu, "\n")
        .replace(/(?:\\n|\/n|\n)\s*-\s*/gu, "\n")
        .split(/\n+/u)
        .map((candidate) => candidate.trim().replace(/^-\s*/u, "").trim())
        .filter((candidate) => candidate.length > 0);
}

export function normalizeAgentRunSkillMetadata(value: unknown): AgentRunSkillMetadata[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const skills: AgentRunSkillMetadata[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }

        const rawSkill = item as Record<string, unknown>;
        const name = normalizeMetadataToken(rawSkill.name);
        if (!name) {
            continue;
        }

        const mode = normalizeMetadataToken(rawSkill.mode) ?? undefined;
        const source = normalizeMetadataToken(rawSkill.source) ?? undefined;
        const key = [name, mode ?? "", source ?? ""].join("\u0000");
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        skills.push({
            name,
            ...(mode ? { mode } : {}),
            ...(source ? { source } : {}),
        });
    }

    return skills;
}

export function normalizeAgentRunToolNames(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const tools = new Map<string, string>();
    for (const item of value) {
        const tool = normalizeMetadataToken(item);
        if (!tool) {
            continue;
        }

        const baseName = getAgentRunToolBaseName(tool);
        if (!baseName || baseName === "shell") {
            continue;
        }

        const label = /\(unavailable\)$/iu.test(tool)
            ? formatUnavailableAgentRunToolName(baseName)
            : tool;
        const currentLabel = tools.get(baseName);
        if (!currentLabel || /\(unavailable\)$/iu.test(label)) {
            tools.set(baseName, label);
        }
    }

    return Array.from(tools.values());
}

export function normalizeAgentRunUrls(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const urls = new Set<string>();
    for (const item of value) {
        for (const candidate of splitAgentRunUrlCandidates(item)) {
            const url = sanitizeAgentRunUrl(candidate);
            if (url) {
                urls.add(url);
            }
        }
    }

    return Array.from(urls);
}

export function normalizeAgentRunToolErrors(value: unknown): AgentRunToolErrorMetadata[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const seen = new Set<string>();
    const errors: AgentRunToolErrorMetadata[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            continue;
        }

        const rawError = item as Record<string, unknown>;
        const rawName = normalizeMetadataToken(rawError.name);
        const name = rawName ? getAgentRunToolBaseName(rawName) : null;
        const payload = normalizeMetadataPayload(rawError.payload);
        if (!name || name === "shell" || !payload) {
            continue;
        }

        const key = [name, payload].join("\u0000");
        if (seen.has(key)) {
            continue;
        }

        seen.add(key);
        errors.push({ name, payload });
    }

    return errors;
}

export function mergeAgentRunMetadata(
    base: AgentRunMetadata,
    next: AgentRunMetadata,
): AgentRunMetadata {
    const usedSkills = normalizeAgentRunSkillMetadata([
        ...(base.usedSkills ?? []),
        ...(next.usedSkills ?? []),
    ]);
    const usedTools = normalizeAgentRunToolNames([
        ...(base.usedTools ?? []),
        ...(next.usedTools ?? []),
    ]);
    const usedUrls = normalizeAgentRunUrls([
        ...(base.usedUrls ?? []),
        ...(next.usedUrls ?? []),
    ]);
    const usedToolErrors = normalizeAgentRunToolErrors([
        ...(base.usedToolErrors ?? []),
        ...(next.usedToolErrors ?? []),
    ]);
    const unavailableToolNames = new Set(usedToolErrors.map((error) => error.name));
    const displayToolsByBaseName = new Map<string, string>();
    for (const tool of usedTools) {
        const baseName = getAgentRunToolBaseName(tool);
        displayToolsByBaseName.set(
            baseName,
            unavailableToolNames.has(baseName)
                ? formatUnavailableAgentRunToolName(baseName)
                : tool,
        );
    }
    for (const toolName of unavailableToolNames) {
        if (!displayToolsByBaseName.has(toolName)) {
            displayToolsByBaseName.set(toolName, formatUnavailableAgentRunToolName(toolName));
        }
    }

    return {
        ...(usedSkills.length ? { usedSkills } : {}),
        ...(displayToolsByBaseName.size ? { usedTools: Array.from(displayToolsByBaseName.values()) } : {}),
        ...(usedUrls.length ? { usedUrls } : {}),
        ...(usedToolErrors.length ? { usedToolErrors } : {}),
    };
}

export function cloneAgentRunRecord(run: AgentRunRecord): AgentRunRecord {
    return {
        ...run,
        ...mergeAgentRunMetadata(run, {}),
    };
}

export function cloneAgentRunStreamState(stream: AgentRunStreamState): AgentRunStreamState {
    return {
        ...stream,
        ...(stream.processLogLines ? { processLogLines: [...stream.processLogLines] } : {}),
        ...mergeAgentRunMetadata(stream, {}),
    };
}

export function cloneAgentRunRecords(runs: AgentRunRecord[]): AgentRunRecord[] {
    return runs.map((run) => cloneAgentRunRecord(run));
}

export function getAgentRunsForThread(
    runs: readonly AgentRunRecord[],
    threadId: string,
): AgentRunRecord[] {
    return runs
        .filter((run) => run.threadId === threadId)
        .slice()
        .sort(compareAgentRunsByRecencyDesc);
}

export function getAgentRunsForCommentThread(
    runs: readonly AgentRunRecord[],
    thread: Pick<CommentThread, "id" | "entries">,
): AgentRunRecord[] {
    const identifiers = new Set<string>([
        thread.id,
        ...thread.entries.map((entry) => entry.id),
    ]);

    return runs
        .filter((run) => identifiers.has(run.threadId))
        .slice()
        .sort(compareAgentRunsByRecencyDesc);
}

export function getLatestAgentRunForThread(
    runs: readonly AgentRunRecord[],
    threadId: string,
): AgentRunRecord | null {
    return getAgentRunsForThread(runs, threadId)[0] ?? null;
}

export function getLatestAgentRunForTriggerEntry(
    runs: readonly AgentRunRecord[],
    triggerEntryId: string,
): AgentRunRecord | null {
    return runs
        .filter((run) => run.triggerEntryId === triggerEntryId)
        .slice()
        .sort(compareAgentRunsByRecencyDesc)[0] ?? null;
}

export function getLatestAgentRunForCommentThread(
    runs: readonly AgentRunRecord[],
    thread: Pick<CommentThread, "id" | "entries">,
): AgentRunRecord | null {
    return getAgentRunsForCommentThread(runs, thread)[0] ?? null;
}

export function getAgentRunById(
    runs: readonly AgentRunRecord[],
    runId: string,
): AgentRunRecord | null {
    return runs.find((run) => run.id === runId) ?? null;
}

export function getAgentRunByOutputEntryId(
    runs: readonly AgentRunRecord[],
    outputEntryId: string,
): AgentRunRecord | null {
    return runs
        .filter((run) => run.outputEntryId === outputEntryId)
        .slice()
        .sort(compareAgentRunsByRecencyDesc)[0] ?? null;
}

export function getQueuedAgentRuns(runs: readonly AgentRunRecord[]): AgentRunRecord[] {
    return runs
        .filter((run) => run.status === "queued")
        .slice()
        .sort(compareAgentRunsByCreatedAtAsc);
}

export function compareAgentRunsByCreatedAtAsc(left: AgentRunRecord, right: AgentRunRecord): number {
    if (left.createdAt !== right.createdAt) {
        return left.createdAt - right.createdAt;
    }

    return left.id.localeCompare(right.id);
}

export function compareAgentRunsByRecencyDesc(left: AgentRunRecord, right: AgentRunRecord): number {
    const leftAt = left.endedAt ?? left.startedAt ?? left.createdAt;
    const rightAt = right.endedAt ?? right.startedAt ?? right.createdAt;
    if (leftAt !== rightAt) {
        return rightAt - leftAt;
    }

    return right.id.localeCompare(left.id);
}

export function compareAgentThreadsByStatusAndRecency(
    left: AgentRunRecord,
    right: AgentRunRecord,
): number {
    const leftPriority = getAgentStatusPriority(left.status);
    const rightPriority = getAgentStatusPriority(right.status);
    if (leftPriority !== rightPriority) {
        return leftPriority - rightPriority;
    }

    return compareAgentRunsByRecencyDesc(left, right);
}

export function getAgentStatusPriority(status: AgentRunStatus): number {
    switch (status) {
        case "running":
            return 0;
        case "queued":
            return 1;
        case "failed":
            return 2;
        case "succeeded":
            return 3;
        case "cancelled":
            return 4;
        default:
            return 5;
    }
}

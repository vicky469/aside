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

export interface AgentRunMetadata {
    usedSkills?: AgentRunSkillMetadata[];
    usedTools?: string[];
    usedUrls?: string[];
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

    const tools = new Set<string>();
    for (const item of value) {
        const tool = normalizeMetadataToken(item);
        if (tool && tool !== "shell") {
            tools.add(tool);
        }
    }

    return Array.from(tools);
}

export function normalizeAgentRunUrls(value: unknown): string[] {
    if (!Array.isArray(value)) {
        return [];
    }

    const urls = new Set<string>();
    for (const item of value) {
        const url = sanitizeAgentRunUrl(item);
        if (url) {
            urls.add(url);
        }
    }

    return Array.from(urls);
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

    return {
        ...(usedSkills.length ? { usedSkills } : {}),
        ...(usedTools.length ? { usedTools } : {}),
        ...(usedUrls.length ? { usedUrls } : {}),
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

import type { CommentThread } from "../../commentManager";
import type { SideNote2AgentTarget } from "../config/agentTargets";

export type AgentRunRuntime = "openclaw-acp" | "direct-cli";
export type AgentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface AgentRunStreamState {
    runId: string;
    threadId: string;
    requestedAgent: SideNote2AgentTarget;
    status: AgentRunStatus;
    partialText: string;
    startedAt: number;
    updatedAt: number;
    outputEntryId?: string;
    error?: string;
}

export interface AgentRunRecord {
    id: string;
    threadId: string;
    triggerEntryId: string;
    filePath: string;
    requestedAgent: SideNote2AgentTarget;
    runtime: AgentRunRuntime;
    status: AgentRunStatus;
    promptText: string;
    createdAt: number;
    startedAt?: number;
    endedAt?: number;
    retryOfRunId?: string;
    outputEntryId?: string;
    error?: string;
}

export function cloneAgentRunRecord(run: AgentRunRecord): AgentRunRecord {
    return { ...run };
}

export function cloneAgentRunStreamState(stream: AgentRunStreamState): AgentRunStreamState {
    return { ...stream };
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

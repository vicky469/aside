import type { CommentThread } from "../../commentManager";
import {
    compareAgentThreadsByStatusAndRecency,
    getLatestAgentRunForCommentThread,
    type AgentRunRecord,
} from "../../core/agents/agentRuns";

export interface AgentSidebarThread {
    thread: CommentThread;
    latestRun: AgentRunRecord;
}

export type AgentSidebarOutcomeFilter = "all" | "succeeded" | "failed";

export function buildAgentSidebarThreads(
    threads: CommentThread[],
    runs: AgentRunRecord[],
): AgentSidebarThread[] {
    return threads
        .map((thread) => {
            const latestRun = getLatestAgentRunForCommentThread(runs, thread);
            return latestRun
                ? {
                    thread,
                    latestRun,
                }
                : null;
        })
        .filter((item): item is AgentSidebarThread => !!item)
        .sort((left, right) => compareAgentThreadsByStatusAndRecency(left.latestRun, right.latestRun));
}

export function filterAgentSidebarThreadsByOutcome(
    threads: readonly AgentSidebarThread[],
    outcome: AgentSidebarOutcomeFilter,
): AgentSidebarThread[] {
    if (outcome === "all") {
        return threads.slice();
    }

    return threads.filter((item) => item.latestRun.status === outcome);
}

export function countAgentSidebarThreadsByOutcome(
    threads: readonly AgentSidebarThread[],
    outcome: Exclude<AgentSidebarOutcomeFilter, "all">,
): number {
    return threads.filter((item) => item.latestRun.status === outcome).length;
}

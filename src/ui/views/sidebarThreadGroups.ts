import type { CommentThread } from "../../commentManager";
import type { SidebarPrimaryMode } from "./viewState";

export type SidebarThreadGroupMode = "todo" | "agent";

export interface SidebarThreadGroupCounts {
    agent: number;
    todo: number;
}

const TODO_MENTION_PATTERN = /@todo\b/iu;
const AGENT_MENTION_PATTERN = /@(codex|claude)\b/iu;

export const EMPTY_SIDEBAR_THREAD_GROUP_COUNTS: SidebarThreadGroupCounts = {
    agent: 0,
    todo: 0,
};

export function threadMatchesSidebarGroup(
    thread: CommentThread,
    groupMode: SidebarThreadGroupMode,
): boolean {
    const bodyText = getThreadBodyText(thread);
    return groupMode === "todo"
        ? TODO_MENTION_PATTERN.test(bodyText)
        : AGENT_MENTION_PATTERN.test(bodyText);
}

export function filterThreadsBySidebarGroupMode(
    threads: readonly CommentThread[],
    mode: SidebarPrimaryMode,
): CommentThread[] {
    if (mode !== "todo" && mode !== "agent") {
        return threads.slice();
    }

    return threads.filter((thread) => threadMatchesSidebarGroup(thread, mode));
}

export function getSidebarThreadGroupCounts(
    threads: readonly CommentThread[],
): SidebarThreadGroupCounts {
    let agent = 0;
    let todo = 0;
    for (const thread of threads) {
        if (threadMatchesSidebarGroup(thread, "agent")) {
            agent += 1;
        }
        if (threadMatchesSidebarGroup(thread, "todo")) {
            todo += 1;
        }
    }

    return { agent, todo };
}

export function resolveModeWithSidebarGroupAvailability(
    mode: SidebarPrimaryMode,
    counts: SidebarThreadGroupCounts,
): SidebarPrimaryMode {
    if (mode === "todo" && counts.todo === 0) {
        return "list";
    }
    if (mode === "agent" && counts.agent === 0) {
        return "list";
    }

    return mode;
}

function getThreadBodyText(thread: CommentThread): string {
    return thread.entries.map((entry) => entry.body).join("\n");
}

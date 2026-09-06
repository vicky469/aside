import type { AgentRunRecord, AgentRunRequestKind } from "../agents/agentRuns";

export function isScriptOrientedAgentRequestKind(
    requestKind: AgentRunRequestKind | undefined,
): boolean {
    return requestKind === "create-script"
        || requestKind === "update-script"
        || requestKind === "pdf-to-markdown";
}

export function canRetryAgentRunWithScriptsCapability(
    scriptsEnabled: boolean,
    run: Pick<AgentRunRecord, "requestKind"> | null,
): boolean {
    return scriptsEnabled || !run || !isScriptOrientedAgentRequestKind(run.requestKind);
}

export function canRetryScriptRunWithScriptsCapability(scriptsEnabled: boolean): boolean {
    return scriptsEnabled;
}

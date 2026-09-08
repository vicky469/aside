import type { AgentRunRequestKind } from "../agents/agentRuns";

const AGENT_REQUEST_KIND_REQUIRES_SCRIPTS = {
    "create-script": true,
    "update-script": true,
    "pdf-to-markdown": true,
} satisfies Record<AgentRunRequestKind, boolean>;

export function isScriptOrientedAgentRequestKind(
    requestKind: unknown,
): requestKind is AgentRunRequestKind {
    return typeof requestKind === "string"
        && Object.prototype.hasOwnProperty.call(
            AGENT_REQUEST_KIND_REQUIRES_SCRIPTS,
            requestKind,
        )
        && AGENT_REQUEST_KIND_REQUIRES_SCRIPTS[
            requestKind as AgentRunRequestKind
        ];
}

export function canRetryAgentRunWithScriptsCapability(
    scriptsEnabled: boolean,
    run: { requestKind?: unknown } | null,
): boolean {
    return scriptsEnabled || !run || !isScriptOrientedAgentRequestKind(run.requestKind);
}

export function canRetryScriptRunWithScriptsCapability(scriptsEnabled: boolean): boolean {
    return scriptsEnabled;
}

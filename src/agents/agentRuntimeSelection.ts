import type { CodexRuntimeDiagnostics } from "./agentRuntimeAdapter";
import type { AgentRunRuntime } from "../core/agents/agentRuns";
import type { AgentRuntimeModePreference } from "../core/agents/agentRuntimePreferences";

export interface RuntimeAvailabilityContext {
    modePreference: AgentRuntimeModePreference;
    localDiagnostics: CodexRuntimeDiagnostics;
}

export interface ResolvedAgentRuntimeSelection {
    kind: "resolved";
    runtime: AgentRunRuntime;
    modePreference: AgentRuntimeModePreference;
    ownershipMessage: string;
}

export interface BlockedAgentRuntimeSelection {
    kind: "blocked";
    modePreference: AgentRuntimeModePreference;
    notice: string;
}

export type AgentRuntimeSelection =
    | ResolvedAgentRuntimeSelection
    | BlockedAgentRuntimeSelection;

export function getAgentRuntimeOwnershipMessage(runtime: AgentRunRuntime): string {
    return "Using your local Codex setup";
}

export function getAgentRuntimeStatusLabel(runtime: AgentRunRuntime): string {
    return "Runtime: Local";
}

export function getAgentRuntimeCapabilityLabel(runtime: AgentRunRuntime): string {
    return "Capability: Workspace-aware";
}

function resolveLocalRuntimeSelection(modePreference: AgentRuntimeModePreference): ResolvedAgentRuntimeSelection {
    return {
        kind: "resolved",
        runtime: "direct-cli",
        modePreference,
        ownershipMessage: getAgentRuntimeOwnershipMessage("direct-cli"),
    };
}

function blockRuntimeSelection(modePreference: AgentRuntimeModePreference, notice: string): BlockedAgentRuntimeSelection {
    return {
        kind: "blocked",
        modePreference,
        notice,
    };
}

function getLocalRuntimeUnavailableNotice(localDiagnostics: CodexRuntimeDiagnostics): string {
    const message = typeof localDiagnostics.message === "string"
        ? localDiagnostics.message.trim()
        : "";
    return message || "Local runtime is unavailable on this device.";
}

export function resolveAgentRuntimeSelection(context: RuntimeAvailabilityContext): AgentRuntimeSelection {
    const localAvailable = context.localDiagnostics.status === "available";
    return localAvailable
        ? resolveLocalRuntimeSelection(context.modePreference)
        : blockRuntimeSelection(context.modePreference, getLocalRuntimeUnavailableNotice(context.localDiagnostics));
}

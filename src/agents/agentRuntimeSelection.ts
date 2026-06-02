import type { AgentRuntimeDiagnostics } from "./agentRuntimeAdapter";
import type { AgentRunRuntime } from "../core/agents/agentRuns";
import type { AgentRuntimeModePreference } from "../core/agents/agentRuntimePreferences";
import type { AsideAgentTarget } from "../core/config/agentTargets";
import { getAgentActorLabel } from "../core/agents/agentActorRegistry";

export interface RuntimeAvailabilityContext {
    target: AsideAgentTarget;
    modePreference: AgentRuntimeModePreference;
    localDiagnostics: AgentRuntimeDiagnostics;
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

export function getAgentRuntimeOwnershipMessage(runtime: AgentRunRuntime, target: AsideAgentTarget): string {
    return `Using your local ${getAgentActorLabel(target)} setup`;
}

export function getAgentRuntimeStatusLabel(runtime: AgentRunRuntime): string {
    return "Runtime: Local";
}

export function getAgentRuntimeCapabilityLabel(runtime: AgentRunRuntime): string {
    return "Capability: Workspace-aware";
}

function resolveLocalRuntimeSelection(
    modePreference: AgentRuntimeModePreference,
    target: AsideAgentTarget,
): ResolvedAgentRuntimeSelection {
    return {
        kind: "resolved",
        runtime: "direct-cli",
        modePreference,
        ownershipMessage: getAgentRuntimeOwnershipMessage("direct-cli", target),
    };
}

function blockRuntimeSelection(modePreference: AgentRuntimeModePreference, notice: string): BlockedAgentRuntimeSelection {
    return {
        kind: "blocked",
        modePreference,
        notice,
    };
}

function getLocalRuntimeUnavailableNotice(localDiagnostics: AgentRuntimeDiagnostics): string {
    const message = typeof localDiagnostics.message === "string"
        ? localDiagnostics.message.trim()
        : "";
    return message || "Local runtime is unavailable on this device.";
}

export function resolveAgentRuntimeSelection(context: RuntimeAvailabilityContext): AgentRuntimeSelection {
    const localAvailable = context.localDiagnostics.status === "available";
    return localAvailable
        ? resolveLocalRuntimeSelection(context.modePreference, context.target)
        : blockRuntimeSelection(context.modePreference, getLocalRuntimeUnavailableNotice(context.localDiagnostics));
}

import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import {
    getAgentActorLabel,
    getSupportedAgentActors,
} from "../../core/agents/agentActorRegistry";
import type { AsideAgentTarget } from "../../core/config/agentTargets";

export interface AgentRuntimeStatusLineInput {
    label: string;
    statusBadge: string;
}

export interface DefaultAgentOptionPresentation {
    target: AsideAgentTarget;
    label: string;
    available: boolean;
    selected: boolean;
}

export const AGENT_RUNTIME_STATUS_SEPARATOR = "    ";

export function buildDefaultAgentOptions(
    preferredAgent: AsideAgentTarget,
    diagnosticsByTarget: ReadonlyMap<AsideAgentTarget, AgentRuntimeDiagnostics>,
): DefaultAgentOptionPresentation[] {
    return getSupportedAgentActors().map((actor) => ({
        target: actor.id,
        label: actor.label,
        available: diagnosticsByTarget.get(actor.id)?.status === "available",
        selected: actor.id === preferredAgent,
    }));
}

export function formatDefaultAgentFallback(
    preferredAgent: AsideAgentTarget,
    selectedAgent: AsideAgentTarget,
): string {
    return preferredAgent === selectedAgent
        ? ""
        : `Using ${getAgentActorLabel(selectedAgent)} while ${getAgentActorLabel(preferredAgent)} is unavailable.`;
}

export function formatAgentRuntimeStatusLines(items: AgentRuntimeStatusLineInput[]): string[] {
    return [items.map((item) => `${item.label} ${item.statusBadge}`).join(AGENT_RUNTIME_STATUS_SEPARATOR)];
}

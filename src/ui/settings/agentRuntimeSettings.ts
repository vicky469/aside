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

export type DefaultAgentOptionStatus = "checking" | "available" | "unavailable";

export interface DefaultAgentOptionPresentation {
    target: AsideAgentTarget;
    label: string;
    status: DefaultAgentOptionStatus;
    statusLabel: "Checking…" | "Available" | "Unavailable";
    available: boolean;
    disabled: boolean;
    selected: boolean;
}

export const AGENT_RUNTIME_STATUS_SEPARATOR = "    ";

function resolveDefaultAgentOptionStatus(
    diagnostics: AgentRuntimeDiagnostics | undefined,
): Pick<DefaultAgentOptionPresentation, "status" | "statusLabel" | "available" | "disabled"> {
    if (diagnostics?.status === "available") {
        return {
            status: "available",
            statusLabel: "Available",
            available: true,
            disabled: false,
        };
    }
    if (!diagnostics || diagnostics.status === "checking") {
        return {
            status: "checking",
            statusLabel: "Checking…",
            available: false,
            disabled: true,
        };
    }
    return {
        status: "unavailable",
        statusLabel: "Unavailable",
        available: false,
        disabled: true,
    };
}

export function buildDefaultAgentOptions(
    preferredAgent: AsideAgentTarget,
    diagnosticsByTarget: ReadonlyMap<AsideAgentTarget, AgentRuntimeDiagnostics>,
): DefaultAgentOptionPresentation[] {
    return getSupportedAgentActors().map((actor) => ({
        target: actor.id,
        label: actor.label,
        ...resolveDefaultAgentOptionStatus(diagnosticsByTarget.get(actor.id)),
        selected: actor.id === preferredAgent,
    }));
}

export function resolveDefaultAgentRadioSelection(
    options: readonly DefaultAgentOptionPresentation[],
    target: AsideAgentTarget,
): AsideAgentTarget | null {
    return options.find((option) => option.target === target && !option.disabled)?.target ?? null;
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

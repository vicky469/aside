import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import type {
    AgentRuntimeSelection,
} from "../../agents/agentRuntimeSelection";
import type { AsideAgentTarget } from "../../core/config/agentTargets";
import { getAgentActorById } from "../../core/agents/agentActorRegistry";

export interface CodexRuntimeStatusPresentation {
    title: string;
    description: string;
}

export interface RuntimeOptionStatusPresentation {
    label: string;
    description: string;
    available: boolean;
}

function getCheckingMessage(target: AsideAgentTarget): string {
    const actor = getAgentActorById(target);
    return `Checking whether ${actor.directive} is available...`;
}

export function getAgentRuntimeStatusPresentation(
    target: AsideAgentTarget,
    diagnostics: AgentRuntimeDiagnostics,
): CodexRuntimeStatusPresentation {
    const actor = getAgentActorById(target);
    const checkingMessage = getCheckingMessage(target);
    switch (diagnostics.status) {
        case "available":
            return {
                title: `${actor.label} runtime: Available`,
                description: `Built-in ${actor.directive} can run in this Obsidian environment.`,
            };
        case "checking":
            return {
                title: `${actor.label} runtime: Checking...`,
                description: checkingMessage,
            };
        case "missing":
        case "unsupported":
        case "unavailable":
        default:
            return {
                title: `${actor.label} runtime: Unavailable on this device`,
                description: diagnostics.message || checkingMessage,
            };
    }
}

export function getCodexRuntimeStatusPresentation(
    diagnostics: AgentRuntimeDiagnostics,
): CodexRuntimeStatusPresentation {
    return getAgentRuntimeStatusPresentation("codex", diagnostics);
}

export function getCodexRuntimeStatusPresentationForSelection(
    selection: AgentRuntimeSelection,
): CodexRuntimeStatusPresentation {
    if (selection.kind === "resolved") {
        return {
            title: "Codex runtime: Available",
            description: selection.ownershipMessage,
        };
    }

    return {
        title: "Codex runtime: Unavailable",
        description: selection.notice,
    };
}

export function createCheckingAgentRuntimeDiagnostics(target: AsideAgentTarget): AgentRuntimeDiagnostics {
    return {
        status: "checking",
        message: getCheckingMessage(target),
    };
}

export function createCheckingCodexRuntimeDiagnostics(): AgentRuntimeDiagnostics {
    return createCheckingAgentRuntimeDiagnostics("codex");
}

export function getLocalRuntimeOptionStatusPresentation(
    diagnostics: AgentRuntimeDiagnostics,
): RuntimeOptionStatusPresentation {
    switch (diagnostics.status) {
        case "available":
            return {
                label: "Local ✅",
                description: "At least one local Aside agent can run in this Obsidian environment.",
                available: true,
            };
        case "checking":
            return {
                label: "Local ...",
                description: diagnostics.message,
                available: false,
            };
        case "missing":
        case "unsupported":
        case "unavailable":
        default:
            return {
                label: "Local ❌",
                description: diagnostics.message || "Local Aside agent execution is unavailable on this device.",
                available: false,
            };
    }
}

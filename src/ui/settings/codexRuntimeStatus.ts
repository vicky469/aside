import type { CodexRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import type {
    AgentRuntimeSelection,
    RemoteRuntimeAvailability,
} from "../../agents/agentRuntimeSelection";

export interface CodexRuntimeStatusPresentation {
    title: string;
    description: string;
}

export interface RuntimeOptionStatusPresentation {
    label: string;
    description: string;
    available: boolean;
}

const CHECKING_MESSAGE = "Checking whether @codex is available...";

export function getCodexRuntimeStatusPresentation(
    diagnostics: CodexRuntimeDiagnostics,
): CodexRuntimeStatusPresentation {
    switch (diagnostics.status) {
        case "available":
            return {
                title: "Codex runtime: Available",
                description: "Built-in @codex can run in this Obsidian environment.",
            };
        case "checking":
            return {
                title: "Codex runtime: Checking...",
                description: CHECKING_MESSAGE,
            };
        case "missing":
        case "unsupported":
        case "unavailable":
        default:
            return {
                title: "Codex runtime: Unavailable on this device",
                description: diagnostics.message || CHECKING_MESSAGE,
            };
    }
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

export function createCheckingCodexRuntimeDiagnostics(): CodexRuntimeDiagnostics {
    return {
        status: "checking",
        message: CHECKING_MESSAGE,
    };
}

export function getLocalRuntimeOptionStatusPresentation(
    diagnostics: CodexRuntimeDiagnostics,
): RuntimeOptionStatusPresentation {
    switch (diagnostics.status) {
        case "available":
            return {
                label: "Local ✅",
                description: "Built-in @codex can run in this Obsidian environment.",
                available: true,
            };
        case "checking":
            return {
                label: "Local ...",
                description: CHECKING_MESSAGE,
                available: false,
            };
        case "missing":
        case "unsupported":
        case "unavailable":
        default:
            return {
                label: "Local ❌",
                description: diagnostics.message || CHECKING_MESSAGE,
                available: false,
            };
    }
}

export function getRemoteRuntimeOptionStatusPresentation(
    availability: RemoteRuntimeAvailability,
): RuntimeOptionStatusPresentation {
    if (availability.status === "available") {
        const description = availability.originHost
            ? `Remote bridge configured at ${availability.originHost}.`
            : "Remote bridge is configured.";
        return {
            label: "Remote ✅",
            description,
            available: true,
        };
    }

    return {
        label: "Remote ❌",
        description: availability.message,
        available: false,
    };
}

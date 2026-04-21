import type { CodexRuntimeDiagnostics } from "../../control/agentRuntimeAdapter";
import type { AgentRuntimeSelection } from "../../control/agentRuntimeSelection";

export interface CodexRuntimeStatusPresentation {
    title: string;
    description: string;
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

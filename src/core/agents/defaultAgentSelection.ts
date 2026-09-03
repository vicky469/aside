import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import type { AsideAgentTarget } from "../config/agentTargets";

export type DefaultAgentSelection =
    | {
        kind: "preferred";
        preferredAgent: AsideAgentTarget;
        selectedAgent: AsideAgentTarget;
    }
    | {
        kind: "none";
        preferredAgent: AsideAgentTarget;
    };

export function resolveDefaultAgentSelection(
    preferredAgent: AsideAgentTarget,
    diagnosticsByTarget: ReadonlyMap<AsideAgentTarget, AgentRuntimeDiagnostics>,
): DefaultAgentSelection {
    if (diagnosticsByTarget.get(preferredAgent)?.status === "available") {
        return {
            kind: "preferred",
            preferredAgent,
            selectedAgent: preferredAgent,
        };
    }

    return {
        kind: "none",
        preferredAgent,
    };
}

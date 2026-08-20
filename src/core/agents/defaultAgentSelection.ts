import type { AgentRuntimeDiagnostics } from "../../agents/agentRuntimeAdapter";
import type { AsideAgentTarget } from "../config/agentTargets";
import { getSupportedAgentActors } from "./agentActorRegistry";

export type DefaultAgentSelection =
    | {
        kind: "preferred";
        preferredAgent: AsideAgentTarget;
        selectedAgent: AsideAgentTarget;
    }
    | {
        kind: "fallback";
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
    const availableTargets = getSupportedAgentActors()
        .filter((actor) => diagnosticsByTarget.get(actor.id)?.status === "available")
        .map((actor) => actor.id);
    if (availableTargets.includes(preferredAgent)) {
        return {
            kind: "preferred",
            preferredAgent,
            selectedAgent: preferredAgent,
        };
    }

    const selectedAgent = availableTargets[0];
    return selectedAgent
        ? {
            kind: "fallback",
            preferredAgent,
            selectedAgent,
        }
        : {
            kind: "none",
            preferredAgent,
        };
}

import { getAgentActorLabel } from "../../core/agents/agentActorRegistry";
import type { AgentRunRecord } from "../../core/agents/agentRuns";

export function getAgentRunAuthorLabel(
    run: Pick<AgentRunRecord, "requestedAgent" | "preferredAgent">,
): string {
    const selected = getAgentActorLabel(run.requestedAgent);
    return run.preferredAgent && run.preferredAgent !== run.requestedAgent
        ? `${selected} (fallback for ${getAgentActorLabel(run.preferredAgent)})`
        : selected;
}

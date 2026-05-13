import { normalizeAnyAgentTarget } from "../agents/agentActorRegistry";

export type { AsideAgentTarget } from "../agents/agentActorDefinition";

export function normalizeAgentTarget(value: unknown) {
    return normalizeAnyAgentTarget(value);
}

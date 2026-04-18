import {
    DEFAULT_SIDE_NOTE2_AGENT_ACTOR_ID,
    normalizeAnyAgentTarget,
    normalizeSupportedAgentTarget,
    SIDE_NOTE2_AGENT_LABELS,
    SUPPORTED_SIDE_NOTE2_AGENT_LABELS,
} from "../agents/agentActorRegistry";

export type { SideNote2AgentTarget } from "../agents/agentActorDefinition";

export const DEFAULT_PREFERRED_AGENT_TARGET = DEFAULT_SIDE_NOTE2_AGENT_ACTOR_ID;

export const SIDE_NOTE2_AGENT_TARGET_OPTIONS = SIDE_NOTE2_AGENT_LABELS;

export const SUPPORTED_SIDE_NOTE2_AGENT_TARGET_OPTIONS = SUPPORTED_SIDE_NOTE2_AGENT_LABELS;

export function normalizeAgentTarget(value: unknown) {
    return normalizeAnyAgentTarget(value);
}

export function normalizePreferredAgentTarget(value: unknown) {
    return normalizeSupportedAgentTarget(value);
}

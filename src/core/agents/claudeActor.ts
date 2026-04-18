import type { AgentActorDefinition } from "./agentActorDefinition";

export const CLAUDE_AGENT_ACTOR: AgentActorDefinition = {
    id: "claude",
    label: "Claude",
    directive: "@claude",
    supported: false,
    runtimeStrategy: "unsupported",
    unsupportedNotice: "This build currently supports @codex only.",
    settingsDescription: "Type @claude in a comment to have Claude read it and answer questions or do the task.",
};

import type { AgentActorDefinition } from "./agentActorDefinition";

export const CODEX_AGENT_ACTOR: AgentActorDefinition = {
    id: "codex",
    label: "Codex",
    directive: "@codex",
    supported: true,
    runtimeStrategy: "codex-app-server",
    unsupportedNotice: null,
    settingsDescription: "Type @codex in a comment to have Codex read it and answer questions or do the task.",
};

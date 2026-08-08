import type { AgentActorDefinition } from "./agentActorDefinition";

export const GEMINI_AGENT_ACTOR: AgentActorDefinition = {
    id: "gemini",
    label: "Gemini",
    directive: "@gemini",
    supported: true,
    runtimeStrategy: "gemini-cli",
    unsupportedNotice: null,
    settingsDescription: "Type @gemini in a comment to have Gemini read it and answer questions or do the task.",
};

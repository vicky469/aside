import type { AgentActorDefinition } from "./agentActorDefinition";

export const CURSOR_AGENT_ACTOR: AgentActorDefinition = {
    id: "cursor",
    label: "Cursor",
    directive: "@cursor",
    supported: true,
    runtimeStrategy: "cursor-cli",
    unsupportedNotice: null,
    settingsDescription: "Type @cursor in a comment to have Cursor read it and answer questions or do the task.",
};

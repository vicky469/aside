import type { AgentActorDefinition } from "./agentActorDefinition";

export const DEEPSEEK_AGENT_ACTOR: AgentActorDefinition = {
    id: "deepseek",
    label: "DeepSeek",
    directive: "@deepseek",
    supported: true,
    runtimeStrategy: "opencode-cli",
    unsupportedNotice: null,
    settingsDescription: "Type @deepseek in a comment to run the model currently configured in OpenCode.",
};

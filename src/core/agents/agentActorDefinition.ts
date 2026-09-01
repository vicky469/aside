export type AsideAgentTarget = "codex" | "claude" | "cursor" | "gemini" | "deepseek";

export type AgentActorRuntimeStrategy = "codex-cli" | "claude-cli" | "cursor-cli" | "gemini-cli" | "opencode-cli" | "unsupported";

export interface AgentActorDefinition {
    id: AsideAgentTarget;
    label: string;
    directive: `@${string}`;
    supported: boolean;
    runtimeStrategy: AgentActorRuntimeStrategy;
    unsupportedNotice: string | null;
    settingsDescription: string;
}

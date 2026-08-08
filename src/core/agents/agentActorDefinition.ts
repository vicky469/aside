export type AsideAgentTarget = "codex" | "claude" | "gemini";

export type AgentActorRuntimeStrategy = "codex-cli" | "claude-cli" | "gemini-cli" | "unsupported";

export interface AgentActorDefinition {
    id: AsideAgentTarget;
    label: string;
    directive: `@${string}`;
    supported: boolean;
    runtimeStrategy: AgentActorRuntimeStrategy;
    unsupportedNotice: string | null;
    settingsDescription: string;
}

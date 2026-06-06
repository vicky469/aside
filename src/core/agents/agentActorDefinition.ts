export type AsideAgentTarget = "codex" | "claude";

export type AgentActorRuntimeStrategy = "codex-cli" | "claude-cli" | "unsupported";

export interface AgentActorDefinition {
    id: AsideAgentTarget;
    label: string;
    directive: `@${string}`;
    supported: boolean;
    runtimeStrategy: AgentActorRuntimeStrategy;
    unsupportedNotice: string | null;
    settingsDescription: string;
}

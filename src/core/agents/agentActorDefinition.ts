export type AsideAgentTarget = "codex" | "claude";

export type AgentActorRuntimeStrategy = "codex-app-server" | "unsupported";

export interface AgentActorDefinition {
    id: AsideAgentTarget;
    label: string;
    directive: `@${string}`;
    supported: boolean;
    runtimeStrategy: AgentActorRuntimeStrategy;
    unsupportedNotice: string | null;
    settingsDescription: string;
}

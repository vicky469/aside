export type SideNote2AgentTarget = "codex" | "claude";

export type AgentActorRuntimeStrategy = "codex-app-server" | "unsupported";

export interface AgentActorDefinition {
    id: SideNote2AgentTarget;
    label: string;
    directive: `@${string}`;
    supported: boolean;
    runtimeStrategy: AgentActorRuntimeStrategy;
    unsupportedNotice: string | null;
    settingsDescription: string;
}

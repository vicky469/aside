export interface AgentRuntimeStatusVisibilitySettings {
    showAgentSidebarTab: boolean;
}

export interface AgentRuntimeStatusLineInput {
    directive: string;
    statusBadge: string;
}

export const AGENT_RUNTIME_STATUS_SEPARATOR = "    ";

export function shouldRenderAgentRuntimeStatus(settings: AgentRuntimeStatusVisibilitySettings): boolean {
    return settings.showAgentSidebarTab;
}

export function formatAgentRuntimeStatusLines(items: AgentRuntimeStatusLineInput[]): string[] {
    return [items.map((item) => `${item.directive} ${item.statusBadge}`).join(AGENT_RUNTIME_STATUS_SEPARATOR)];
}

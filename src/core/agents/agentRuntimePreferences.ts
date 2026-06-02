export type AgentRuntimeModePreference = "auto" | "local";

export function normalizeAgentRuntimeModePreference(value: unknown): AgentRuntimeModePreference {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
    switch (normalized) {
        case "local":
            return normalized;
        default:
            return "auto";
    }
}

export type AgentRuntimeModePreference = "auto" | "local" | "remote";

export interface AsideLocalSecrets {
    remoteRuntimeBearerToken?: string;
}

export function normalizeAgentRuntimeModePreference(value: unknown): AgentRuntimeModePreference {
    const normalized = typeof value === "string" ? value.trim().toLowerCase() : value;
    switch (normalized) {
        case "local":
        case "remote":
            return normalized;
        default:
            return "auto";
    }
}

export function normalizeRemoteRuntimeBaseUrl(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim().replace(/\/+$/u, "");
}

export function normalizeRemoteRuntimeBearerToken(value: unknown): string {
    if (typeof value !== "string") {
        return "";
    }

    return value.trim();
}

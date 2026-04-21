import type { CodexRuntimeDiagnostics } from "./agentRuntimeAdapter";
import type { AgentRunRuntime } from "../core/agents/agentRuns";
import type { AgentRuntimeModePreference } from "../core/agents/agentRuntimePreferences";

export interface RemoteRuntimeAvailability {
    status: "available" | "missing-base-url" | "missing-token" | "invalid-url" | "disallowed-url";
    message: string;
    originHost: string | null;
}

export interface RuntimeAvailabilityContext {
    modePreference: AgentRuntimeModePreference;
    localDiagnostics: CodexRuntimeDiagnostics;
    remoteRuntimeBaseUrl: string;
    remoteRuntimeBearerToken: string;
}

export interface ResolvedAgentRuntimeSelection {
    kind: "resolved";
    runtime: AgentRunRuntime;
    modePreference: AgentRuntimeModePreference;
    ownershipMessage: string;
}

export interface BlockedAgentRuntimeSelection {
    kind: "blocked";
    modePreference: AgentRuntimeModePreference;
    notice: string;
}

export type AgentRuntimeSelection =
    | ResolvedAgentRuntimeSelection
    | BlockedAgentRuntimeSelection;

export function getAgentRuntimeOwnershipMessage(runtime: AgentRunRuntime): string {
    return runtime === "openclaw-acp"
        ? "Using your remote runtime"
        : "Using your local Codex setup";
}

export function getAgentRuntimeStatusLabel(runtime: AgentRunRuntime): string {
    return runtime === "openclaw-acp"
        ? "Runtime: Your remote runtime"
        : "Runtime: Local desktop";
}

export function getAgentRuntimeCapabilityLabel(runtime: AgentRunRuntime): string {
    return runtime === "openclaw-acp"
        ? "Capability: Reply only"
        : "Capability: Workspace-aware";
}

export function getRemoteRuntimeAvailability(options: {
    remoteRuntimeBaseUrl: string;
    remoteRuntimeBearerToken: string;
}): RemoteRuntimeAvailability {
    if (!options.remoteRuntimeBaseUrl) {
        return {
            status: "missing-base-url",
            message: "Remote bridge is not configured.",
            originHost: null,
        };
    }

    if (!options.remoteRuntimeBearerToken) {
        return {
            status: "missing-token",
            message: "Remote bridge is not configured.",
            originHost: null,
        };
    }

    let parsedUrl: URL;
    try {
        parsedUrl = new URL(options.remoteRuntimeBaseUrl);
    } catch {
        return {
            status: "invalid-url",
            message: "Remote bridge URL is invalid.",
            originHost: null,
        };
    }

    const hostname = parsedUrl.hostname.toLowerCase();
    const isHttps = parsedUrl.protocol === "https:";
    const isLocalHttp = parsedUrl.protocol === "http:"
        && (hostname === "localhost" || hostname === "127.0.0.1");
    if (!isHttps && !isLocalHttp) {
        return {
            status: "disallowed-url",
            message: "Remote bridge must use HTTPS, or HTTP only for localhost development.",
            originHost: null,
        };
    }

    return {
        status: "available",
        message: "Using your remote runtime",
        originHost: parsedUrl.host || null,
    };
}

export function resolveAgentRuntimeSelection(context: RuntimeAvailabilityContext): AgentRuntimeSelection {
    const localAvailable = context.localDiagnostics.status === "available";
    const desktopCapable = context.localDiagnostics.status !== "unsupported";
    const remoteAvailability = getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: context.remoteRuntimeBaseUrl,
        remoteRuntimeBearerToken: context.remoteRuntimeBearerToken,
    });
    const remoteAvailable = remoteAvailability.status === "available";

    if (desktopCapable) {
        if (localAvailable) {
            return {
                kind: "resolved",
                runtime: "direct-cli",
                modePreference: "auto",
                ownershipMessage: getAgentRuntimeOwnershipMessage("direct-cli"),
            };
        }

        return {
            kind: "blocked",
            modePreference: "auto",
            notice: "Local desktop runtime is unavailable on this device.",
        };
    }

    if (remoteAvailable) {
        return {
            kind: "resolved",
            runtime: "openclaw-acp",
            modePreference: "auto",
            ownershipMessage: getAgentRuntimeOwnershipMessage("openclaw-acp"),
        };
    }

    return {
        kind: "blocked",
        modePreference: "auto",
        notice: remoteAvailability.message,
    };
}

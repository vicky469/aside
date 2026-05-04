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
    isDesktopWithFilesystem: boolean;
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
        ? "Using remote runtime"
        : "Using your local Codex setup";
}

export function getAgentRuntimeStatusLabel(runtime: AgentRunRuntime): string {
    return runtime === "openclaw-acp"
        ? "Runtime: Your remote runtime"
        : "Runtime: Local";
}

export function getAgentRuntimeCapabilityLabel(runtime: AgentRunRuntime): string {
    return "Capability: Workspace-aware";
}

function stripIpv6Brackets(hostname: string): string {
    return hostname.startsWith("[") && hostname.endsWith("]")
        ? hostname.slice(1, -1)
        : hostname;
}

function isIpv4Hostname(hostname: string): boolean {
    const octets = hostname.split(".");
    return octets.length === 4
        && octets.every((octet) => /^\d{1,3}$/u.test(octet) && Number(octet) >= 0 && Number(octet) <= 255);
}

function isPrivateOrLoopbackIpv4Hostname(hostname: string): boolean {
    if (!isIpv4Hostname(hostname)) {
        return false;
    }

    const [firstOctet, secondOctet] = hostname.split(".").map((octet) => Number(octet));
    return firstOctet === 10
        || firstOctet === 127
        || (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31)
        || (firstOctet === 192 && secondOctet === 168)
        || (firstOctet === 169 && secondOctet === 254);
}

function isPrivateOrLoopbackIpv6Hostname(hostname: string): boolean {
    const normalizedHostname = stripIpv6Brackets(hostname).toLowerCase();
    return normalizedHostname === "::1"
        || normalizedHostname === "0:0:0:0:0:0:0:1"
        || normalizedHostname.startsWith("fc")
        || normalizedHostname.startsWith("fd")
        || normalizedHostname.startsWith("fe80:");
}

function isLocalDevelopmentHttpHostname(hostname: string): boolean {
    const normalizedHostname = stripIpv6Brackets(hostname).toLowerCase();
    return normalizedHostname === "localhost"
        || isPrivateOrLoopbackIpv4Hostname(normalizedHostname)
        || isPrivateOrLoopbackIpv6Hostname(normalizedHostname);
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
        && isLocalDevelopmentHttpHostname(hostname);
    if (!isHttps && !isLocalHttp) {
        return {
            status: "disallowed-url",
            message: "Remote bridge must use HTTPS, or HTTP only for localhost and private LAN development.",
            originHost: null,
        };
    }

    return {
        status: "available",
        message: "Using remote runtime",
        originHost: parsedUrl.host || null,
    };
}

function resolveLocalRuntimeSelection(modePreference: AgentRuntimeModePreference): ResolvedAgentRuntimeSelection {
    return {
        kind: "resolved",
        runtime: "direct-cli",
        modePreference,
        ownershipMessage: getAgentRuntimeOwnershipMessage("direct-cli"),
    };
}

function resolveRemoteRuntimeSelection(modePreference: AgentRuntimeModePreference): ResolvedAgentRuntimeSelection {
    return {
        kind: "resolved",
        runtime: "openclaw-acp",
        modePreference,
        ownershipMessage: getAgentRuntimeOwnershipMessage("openclaw-acp"),
    };
}

function blockRuntimeSelection(modePreference: AgentRuntimeModePreference, notice: string): BlockedAgentRuntimeSelection {
    return {
        kind: "blocked",
        modePreference,
        notice,
    };
}

function getLocalRuntimeUnavailableNotice(localDiagnostics: CodexRuntimeDiagnostics): string {
    const message = typeof localDiagnostics.message === "string"
        ? localDiagnostics.message.trim()
        : "";
    return message || "Local runtime is unavailable on this device.";
}

export function resolveAgentRuntimeSelection(context: RuntimeAvailabilityContext): AgentRuntimeSelection {
    const localAvailable = context.localDiagnostics.status === "available";
    const remoteAvailability = getRemoteRuntimeAvailability({
        remoteRuntimeBaseUrl: context.remoteRuntimeBaseUrl,
        remoteRuntimeBearerToken: context.remoteRuntimeBearerToken,
    });
    const remoteAvailable = remoteAvailability.status === "available";

    switch (context.modePreference) {
        case "remote":
            return remoteAvailable
                ? resolveRemoteRuntimeSelection("remote")
                : blockRuntimeSelection("remote", remoteAvailability.message);
        case "local":
            return localAvailable
                ? resolveLocalRuntimeSelection("local")
                : blockRuntimeSelection("local", getLocalRuntimeUnavailableNotice(context.localDiagnostics));
        case "auto":
        default:
            if (context.isDesktopWithFilesystem) {
                return localAvailable
                    ? resolveLocalRuntimeSelection("auto")
                    : blockRuntimeSelection("auto", getLocalRuntimeUnavailableNotice(context.localDiagnostics));
            }

            if (remoteAvailable) {
                return resolveRemoteRuntimeSelection("auto");
            }

            return blockRuntimeSelection("auto", remoteAvailability.message);
    }
}

import type { AsideAgentTarget } from "../core/agents/agentActorDefinition";
import { getAgentActorLabel } from "../core/agents/agentActorRegistry";

const KNOWN_AGENT_PROVIDER_FAILURE_PATTERNS: readonly RegExp[] = [
    /\bresource_exhausted\b/iu,
    /\bresource has been exhausted\b/iu,
    /\b(?:quota|rate limit)(?: has been| was)? exceeded\b/iu,
    /\bexceeded (?:your )?(?:current )?quota\b/iu,
    /\byou(?:['’]ve| have)? (?:hit|reached) (?:your )?(?:current )?usage limit\b/iu,
    /\b429\b.{0,20}\btoo many requests\b/iu,
    /\b(?:insufficient|no|out of|exhausted) (?:api )?credits?\b/iu,
    /\bcredit balance\b.{0,40}\b(?:low|zero|empty|exhausted|insufficient)\b/iu,
    /\b(?:authentication|authorization) (?:failed|required)\b/iu,
    /\bnot (?:authenticated|authorized|logged in)\b/iu,
    /\b(?:billing|payment) (?:is )?(?:disabled|required|not enabled)\b/iu,
    /\b(?:service|model|runtime) (?:is )?(?:currently )?(?:unavailable|overloaded)\b/iu,
];

const MAX_PREFLIGHT_FAILURE_REPLY_LENGTH = 500;
const ANSI_ESCAPE_SEQUENCE = new RegExp(
    `${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`,
    "gu",
);

function formatGenericAgentFailureReply(target: AsideAgentTarget): string {
    return `${getAgentActorLabel(target)} couldn’t complete this request. Try another agent.`;
}

const STANDALONE_PROVIDER_FAILURE_PREFIX = /^(?:error\s*:\s*)?(?:resource_exhausted\b|resource has been exhausted\b|(?:quota|rate limit)\b|(?:you(?:['’]ve| have)?\s+(?:hit|reached)|you\s+exceeded)\b|429\b|(?:you\s+have\s+)?(?:insufficient|no|out of|exhausted)\s+(?:api\s+)?credits?\b|credit balance\b|(?:authentication|authorization)\s+(?:failed|required)\b|not\s+(?:authenticated|authorized|logged in)\b|(?:billing|payment)\s+(?:is\s+)?(?:disabled|required|not enabled)\b|(?:the\s+)?(?:service|model|runtime)\s+(?:is\s+)?(?:currently\s+)?(?:unavailable|overloaded)\b)/iu;

function redactDiagnosticUrl(value: string): string {
    try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") {
            return "[redacted]";
        }
        url.username = "";
        url.password = "";
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return "[redacted]";
    }
}

export function sanitizeAgentDiagnosticForDisplay(diagnostic: string): string {
    return diagnostic
        .replace(ANSI_ESCAPE_SEQUENCE, "")
        .replace(/\b(Authorization\s*:\s*(?:Bearer|Basic)\s+)\S+/giu, "$1[redacted]")
        .replace(/\b[A-Z][A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD)\s*=\s*[^\s]+/gu, "[redacted]")
        .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[a-z]-[A-Za-z0-9-]{20,})\b/gu, "[redacted]")
        .replace(/https?:\/\/[^\s"'<>]+/giu, (value) => redactDiagnosticUrl(value))
        .replace(/(?:\/Users\/|\/home\/)[^/\s]+(?:\/[^\s]*)?/gu, "[redacted-path]")
        .replace(/\b[A-Za-z]:\\Users\\[^\\\s]+(?:\\[^\s]*)?/gu, "[redacted-path]");
}

export function formatAgentPreflightFailureReply(
    target: AsideAgentTarget,
    diagnostic: string,
): string {
    const usefulLines = sanitizeAgentDiagnosticForDisplay(diagnostic)
        .split(/\r?\n/gu)
        .map((line) => line.trim().replace(/^Error:\s*/u, ""))
        .filter((line) => line.length > 0)
        .filter((line) => !/^(?:npm warn\b|warning:|[[{])/iu.test(line))
        .filter((line) => !/^(?:at\s|node:|npm ERR! command|PATH=|HOME=)/u.test(line))
        .filter((line) => !/^(?:launch failed|[\w.-]+ exited|.*\bcould not (?:be launched|start)\b.*)$/iu.test(line));
    const firstUsefulLine = usefulLines[0];
    if (!firstUsefulLine) {
        return formatGenericAgentFailureReply(target);
    }

    return firstUsefulLine.length <= MAX_PREFLIGHT_FAILURE_REPLY_LENGTH
        ? firstUsefulLine
        : `${firstUsefulLine.slice(0, MAX_PREFLIGHT_FAILURE_REPLY_LENGTH - 3).trimEnd()}...`;
}

export function formatStandaloneAgentProviderFailureReply(
    target: AsideAgentTarget,
    diagnostic: string,
): string | null {
    const normalized = diagnostic.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
        && normalized.length <= 240
        && STANDALONE_PROVIDER_FAILURE_PREFIX.test(normalized)
        && KNOWN_AGENT_PROVIDER_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized))
        ? formatGenericAgentFailureReply(target)
        : null;
}

export function isKnownAgentProviderFailure(value: string): boolean {
    const normalized = value.replace(/\s+/gu, " ").trim();
    return normalized.length > 0
        && KNOWN_AGENT_PROVIDER_FAILURE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function formatKnownAgentFailureReply(
    target: AsideAgentTarget,
    diagnostic: string,
): string | null {
    return isKnownAgentProviderFailure(diagnostic)
        ? formatGenericAgentFailureReply(target)
        : null;
}

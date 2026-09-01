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
        ? `${getAgentActorLabel(target)} couldn’t complete this request. Try another agent.`
        : null;
}

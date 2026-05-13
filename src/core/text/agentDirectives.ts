import { getAgentActorByDirectiveMention } from "../agents/agentActorRegistry";
import type { AsideAgentTarget } from "../config/agentTargets";

const COMMENT_MENTION_PATTERN = /(^|[^\w])(@[A-Za-z0-9_/-]+(?:\.[A-Za-z0-9_/-]+)*)/g;

export interface AgentDirectiveResolution {
    target: AsideAgentTarget | null;
    hasConflict: boolean;
    matchedTargets: AsideAgentTarget[];
    unsupportedTargets: AsideAgentTarget[];
}

export function parseAgentDirectives(value: string): AgentDirectiveResolution {
    const matchedTargets: AsideAgentTarget[] = [];
    const unsupportedTargets: AsideAgentTarget[] = [];
    const seenTargets = new Set<AsideAgentTarget>();
    COMMENT_MENTION_PATTERN.lastIndex = 0;

    for (let match = COMMENT_MENTION_PATTERN.exec(value); match; match = COMMENT_MENTION_PATTERN.exec(value)) {
        const mention = match[2]?.trim().toLowerCase();
        const actor = mention ? getAgentActorByDirectiveMention(mention) : null;
        if (!actor || seenTargets.has(actor.id)) {
            continue;
        }

        seenTargets.add(actor.id);
        if (actor.supported) {
            matchedTargets.push(actor.id);
            continue;
        }

        unsupportedTargets.push(actor.id);
    }

    return {
        target: matchedTargets.length === 1 && unsupportedTargets.length === 0
            ? matchedTargets[0]
            : null,
        hasConflict: matchedTargets.length > 1,
        matchedTargets,
        unsupportedTargets,
    };
}

import type { AgentActorDefinition, AsideAgentTarget } from "./agentActorDefinition";
import { CLAUDE_AGENT_ACTOR } from "./claudeActor";
import { CODEX_AGENT_ACTOR } from "./codexActor";

export const ASIDE_AGENT_ACTORS: readonly AgentActorDefinition[] = [
    CODEX_AGENT_ACTOR,
    CLAUDE_AGENT_ACTOR,
];

export const DEFAULT_ASIDE_AGENT_ACTOR_ID: AsideAgentTarget = CODEX_AGENT_ACTOR.id;

export const ASIDE_AGENT_LABELS = Object.fromEntries(
    ASIDE_AGENT_ACTORS.map((actor) => [actor.id, actor.label]),
) as Record<AsideAgentTarget, string>;

export const SUPPORTED_ASIDE_AGENT_LABELS = Object.fromEntries(
    ASIDE_AGENT_ACTORS
        .filter((actor) => actor.supported)
        .map((actor) => [actor.id, actor.label]),
) as Partial<Record<AsideAgentTarget, string>>;

const agentActorsById = new Map<AsideAgentTarget, AgentActorDefinition>(
    ASIDE_AGENT_ACTORS.map((actor) => [actor.id, actor]),
);

const agentActorsByDirective = new Map<string, AgentActorDefinition>(
    ASIDE_AGENT_ACTORS.map((actor) => [actor.directive.toLowerCase(), actor]),
);

export function getAgentActors(): readonly AgentActorDefinition[] {
    return ASIDE_AGENT_ACTORS;
}

export function getSupportedAgentActors(): AgentActorDefinition[] {
    return ASIDE_AGENT_ACTORS.filter((actor) => actor.supported);
}

export function getPrimarySupportedAgentActor(): AgentActorDefinition {
    return getSupportedAgentActors()[0] ?? CODEX_AGENT_ACTOR;
}

export function getAgentActorById(target: AsideAgentTarget): AgentActorDefinition {
    return agentActorsById.get(target) ?? CODEX_AGENT_ACTOR;
}

export function getAgentActorByDirectiveMention(mention: string): AgentActorDefinition | null {
    return agentActorsByDirective.get(mention.trim().toLowerCase()) ?? null;
}

export function getAgentActorLabel(target: AsideAgentTarget): string {
    return getAgentActorById(target).label;
}

export function normalizeAnyAgentTarget(value: unknown): AsideAgentTarget {
    if (typeof value !== "string") {
        return DEFAULT_ASIDE_AGENT_ACTOR_ID;
    }

    const normalized = value.trim().toLowerCase();
    return agentActorsById.has(normalized as AsideAgentTarget)
        ? normalized as AsideAgentTarget
        : DEFAULT_ASIDE_AGENT_ACTOR_ID;
}

export function normalizeSupportedAgentTarget(value: unknown): AsideAgentTarget {
    const target = normalizeAnyAgentTarget(value);
    return getAgentActorById(target).supported
        ? target
        : DEFAULT_ASIDE_AGENT_ACTOR_ID;
}

export function resolveUnsupportedAgentNotice(targets: readonly AsideAgentTarget[]): string {
    for (const target of targets) {
        const notice = getAgentActorById(target).unsupportedNotice;
        if (notice) {
            return notice;
        }
    }

    const supportedDirectives = getSupportedAgentActors().map((actor) => actor.directive);
    if (supportedDirectives.length === 0) {
        return "This build does not support Aside agent execution.";
    }

    return `This build currently supports ${supportedDirectives.join(" and ")} only.`;
}

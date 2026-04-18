import type { AgentActorDefinition, SideNote2AgentTarget } from "./agentActorDefinition";
import { CLAUDE_AGENT_ACTOR } from "./claudeActor";
import { CODEX_AGENT_ACTOR } from "./codexActor";

export const SIDE_NOTE2_AGENT_ACTORS = [
    CODEX_AGENT_ACTOR,
    CLAUDE_AGENT_ACTOR,
] as const satisfies readonly AgentActorDefinition[];

export const DEFAULT_SIDE_NOTE2_AGENT_ACTOR_ID: SideNote2AgentTarget = CODEX_AGENT_ACTOR.id;

export const SIDE_NOTE2_AGENT_LABELS = Object.fromEntries(
    SIDE_NOTE2_AGENT_ACTORS.map((actor) => [actor.id, actor.label]),
) as Record<SideNote2AgentTarget, string>;

export const SUPPORTED_SIDE_NOTE2_AGENT_LABELS = Object.fromEntries(
    SIDE_NOTE2_AGENT_ACTORS
        .filter((actor) => actor.supported)
        .map((actor) => [actor.id, actor.label]),
) as Partial<Record<SideNote2AgentTarget, string>>;

const agentActorsById = new Map<SideNote2AgentTarget, AgentActorDefinition>(
    SIDE_NOTE2_AGENT_ACTORS.map((actor) => [actor.id, actor]),
);

const agentActorsByDirective = new Map<string, AgentActorDefinition>(
    SIDE_NOTE2_AGENT_ACTORS.map((actor) => [actor.directive.toLowerCase(), actor]),
);

export function getAgentActors(): readonly AgentActorDefinition[] {
    return SIDE_NOTE2_AGENT_ACTORS;
}

export function getSupportedAgentActors(): AgentActorDefinition[] {
    return SIDE_NOTE2_AGENT_ACTORS.filter((actor) => actor.supported);
}

export function getPrimarySupportedAgentActor(): AgentActorDefinition {
    return getSupportedAgentActors()[0] ?? CODEX_AGENT_ACTOR;
}

export function getAgentActorById(target: SideNote2AgentTarget): AgentActorDefinition {
    return agentActorsById.get(target) ?? CODEX_AGENT_ACTOR;
}

export function getAgentActorByDirectiveMention(mention: string): AgentActorDefinition | null {
    return agentActorsByDirective.get(mention.trim().toLowerCase()) ?? null;
}

export function getAgentActorLabel(target: SideNote2AgentTarget): string {
    return getAgentActorById(target).label;
}

export function normalizeAnyAgentTarget(value: unknown): SideNote2AgentTarget {
    if (typeof value !== "string") {
        return DEFAULT_SIDE_NOTE2_AGENT_ACTOR_ID;
    }

    const normalized = value.trim().toLowerCase();
    return agentActorsById.has(normalized as SideNote2AgentTarget)
        ? normalized as SideNote2AgentTarget
        : DEFAULT_SIDE_NOTE2_AGENT_ACTOR_ID;
}

export function normalizeSupportedAgentTarget(value: unknown): SideNote2AgentTarget {
    const target = normalizeAnyAgentTarget(value);
    return getAgentActorById(target).supported
        ? target
        : DEFAULT_SIDE_NOTE2_AGENT_ACTOR_ID;
}

export function resolveUnsupportedAgentNotice(targets: readonly SideNote2AgentTarget[]): string {
    for (const target of targets) {
        const notice = getAgentActorById(target).unsupportedNotice;
        if (notice) {
            return notice;
        }
    }

    const supportedDirectives = getSupportedAgentActors().map((actor) => actor.directive);
    if (supportedDirectives.length === 0) {
        return "This build does not support SideNote2 agent execution.";
    }

    return `This build currently supports ${supportedDirectives.join(" and ")} only.`;
}

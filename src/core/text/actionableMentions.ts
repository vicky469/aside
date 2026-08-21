import { getSupportedAgentActors } from "../agents/agentActorRegistry";
import { CREATE_SCRIPT_DIRECTIVE } from "./createScriptDirective";
import { UPDATE_SCRIPT_DIRECTIVE } from "./updateScriptDirective";

export interface ActionableBuiltInMention {
    mention: `@${string}` | `/${string}`;
    label: string;
    requiresAgents: boolean;
}

export interface ActionableMentionContext {
    agentsFeatureAvailable: boolean;
    isRunnableVaultScriptMention(mention: string): boolean;
}

function getAllBuiltInMentions(): ActionableBuiltInMention[] {
    return [
        { mention: "@todo", label: "Todo", requiresAgents: false },
        ...getSupportedAgentActors().map((actor) => ({
            mention: actor.directive,
            label: actor.label,
            requiresAgents: true,
        })),
        { mention: CREATE_SCRIPT_DIRECTIVE, label: "Create script", requiresAgents: true },
        { mention: UPDATE_SCRIPT_DIRECTIVE, label: "Update script", requiresAgents: true },
    ];
}

export const RESERVED_BUILT_IN_MENTION_NAMES = new Set(
    getAllBuiltInMentions().map((item) => item.mention.slice(1).toLowerCase()),
);

export function getActionableBuiltInMentions(
    agentsFeatureAvailable: boolean,
): ActionableBuiltInMention[] {
    return getAllBuiltInMentions().filter(
        (item) => agentsFeatureAvailable || !item.requiresAgents,
    );
}

export function isActionableMention(
    mention: string,
    context: ActionableMentionContext,
): boolean {
    const normalized = mention.trim().toLowerCase();
    if (getActionableBuiltInMentions(context.agentsFeatureAvailable)
        .some((item) => item.mention === normalized)) {
        return true;
    }

    return normalized.startsWith("/")
        && context.isRunnableVaultScriptMention(normalized);
}

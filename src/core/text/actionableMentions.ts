import { getSupportedAgentActors } from "../agents/agentActorRegistry";
import { CREATE_SCRIPT_DIRECTIVE } from "./createScriptDirective";
import { PDF_TO_MARKDOWN_DIRECTIVE } from "./pdfToMarkdownDirective";
import { UPDATE_SCRIPT_DIRECTIVE } from "./updateScriptDirective";

export interface ActionableBuiltInMention {
    mention: `@${string}` | `/${string}`;
    label: string;
    capability: "always" | "scripts";
}

export interface ActionableMentionContext {
    scriptsEnabled: boolean;
    isRunnableVaultScriptMention(mention: string): boolean;
}

function getAllBuiltInMentions(): ActionableBuiltInMention[] {
    return [
        { mention: "@todo", label: "Todo", capability: "always" },
        ...getSupportedAgentActors().map((actor) => ({
            mention: actor.directive,
            label: actor.label,
            capability: "always" as const,
        })),
        { mention: CREATE_SCRIPT_DIRECTIVE, label: "Create script", capability: "scripts" },
        { mention: UPDATE_SCRIPT_DIRECTIVE, label: "Update script", capability: "scripts" },
        { mention: PDF_TO_MARKDOWN_DIRECTIVE, label: "PDF to Markdown", capability: "scripts" },
    ];
}

export const RESERVED_BUILT_IN_MENTION_NAMES = new Set(
    getAllBuiltInMentions().map((item) => item.mention.slice(1).toLowerCase()),
);

export function isActionableBuiltInMention(
    item: ActionableBuiltInMention,
    scriptsEnabled: boolean,
): boolean {
    return item.capability === "always" || scriptsEnabled;
}

export function getActionableBuiltInMentions(
    scriptsEnabled: boolean,
): ActionableBuiltInMention[] {
    return getAllBuiltInMentions()
        .filter((item) => isActionableBuiltInMention(item, scriptsEnabled));
}

export function isActionableMention(
    mention: string,
    context: ActionableMentionContext,
): boolean {
    const normalized = mention.trim().toLowerCase();
    if (getActionableBuiltInMentions(context.scriptsEnabled)
        .some((item) => item.mention === normalized)) {
        return true;
    }

    return context.scriptsEnabled
        && normalized.startsWith("/")
        && context.isRunnableVaultScriptMention(normalized);
}

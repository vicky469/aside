import { getSupportedAgentActors } from "../agents/agentActorRegistry";
import { CREATE_SCRIPT_DIRECTIVE } from "./createScriptDirective";
import { PDF_TO_MARKDOWN_DIRECTIVE } from "./pdfToMarkdownDirective";
import { UPDATE_SCRIPT_DIRECTIVE } from "./updateScriptDirective";

export interface ActionableBuiltInMention {
    mention: `@${string}` | `/${string}`;
    label: string;
}

export interface ActionableMentionContext {
    scriptsEnabled: boolean;
    isRunnableVaultScriptMention(mention: string): boolean;
}

function getAllBuiltInMentions(): ActionableBuiltInMention[] {
    return [
        { mention: "@todo", label: "Todo" },
        ...getSupportedAgentActors().map((actor) => ({
            mention: actor.directive,
            label: actor.label,
        })),
        { mention: CREATE_SCRIPT_DIRECTIVE, label: "Create script" },
        { mention: UPDATE_SCRIPT_DIRECTIVE, label: "Update script" },
        { mention: PDF_TO_MARKDOWN_DIRECTIVE, label: "PDF to Markdown" },
    ];
}

export const RESERVED_BUILT_IN_MENTION_NAMES = new Set(
    getAllBuiltInMentions().map((item) => item.mention.slice(1).toLowerCase()),
);

function isScriptBuiltInMention(item: ActionableBuiltInMention): boolean {
    return item.mention.startsWith("/");
}

export function getActionableBuiltInMentions(
    scriptsEnabled: boolean,
): ActionableBuiltInMention[] {
    return getAllBuiltInMentions()
        .filter((item) => scriptsEnabled || !isScriptBuiltInMention(item));
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

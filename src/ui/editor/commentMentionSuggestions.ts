import type { VaultScriptRegistration } from "../../../shared/vaultScriptPolicy.js";
import { getSupportedAgentActors } from "../../core/agents/agentActorRegistry";
import { CREATE_SCRIPT_DIRECTIVE } from "../../core/text/createScriptDirective";
import type { TextEditResult } from "./commentEditorFormatting";

export interface OpenMentionQuery {
    start: number;
    end: number;
    query: string;
    trigger: "@" | "/";
}

export type SideNoteMentionSuggestion =
    | {
        kind: "built-in";
        mention: "@todo" | `@${string}` | typeof CREATE_SCRIPT_DIRECTIVE;
        label: string;
    }
    | {
        kind: "script";
        mention: `/${string}`;
        label: string;
        scriptPath: string;
    };

export interface MentionSuggestionPresentation {
    title: string;
}

export function getMentionSuggestionPlaceholder(agentsFeatureAvailable: boolean): string {
    return agentsFeatureAvailable
        ? "Mention an agent, todo, /create-script, or a vault script"
        : "Mention todo or a vault script";
}

export function getMentionSuggestionPresentation(
    suggestion: SideNoteMentionSuggestion,
): MentionSuggestionPresentation {
    return {
        title: suggestion.mention,
    };
}

export function findOpenMentionQuery(
    value: string,
    selectionStart: number,
    selectionEnd: number,
): OpenMentionQuery | null {
    if (selectionStart !== selectionEnd) {
        return null;
    }

    const prefix = value.slice(0, selectionStart);
    const match = /(^|[^\w/])([/@])([A-Za-z0-9_.-]*)$/u.exec(prefix);
    if (!match) {
        return null;
    }
    const trigger = match[2] as "@" | "/";

    const start = selectionStart - (match[3]?.length ?? 0) - 1;
    return {
        start,
        end: selectionStart,
        query: match[3] ?? "",
        trigger,
    };
}

export function replaceOpenMentionQuery(
    value: string,
    query: OpenMentionQuery,
    mention: string,
): TextEditResult {
    const normalizedMention = mention.startsWith("@") || mention.startsWith("/")
        ? mention
        : `/${mention}`;
    const suffix = value.slice(query.end);
    const space = suffix.startsWith(" ") ? "" : " ";
    const cursor = query.start + normalizedMention.length + 1;
    return {
        value: `${value.slice(0, query.start)}${normalizedMention}${space}${suffix}`,
        selectionStart: cursor,
        selectionEnd: cursor,
    };
}

export function buildMentionSuggestions(
    scripts: readonly VaultScriptRegistration[],
    rawQuery: string,
    agentsFeatureAvailable: boolean,
): SideNoteMentionSuggestion[] {
    const normalizedRawQuery = rawQuery.trim();
    const query = normalizedRawQuery.replace(/^[@/]/u, "").toLowerCase();
    const shouldIncludeScripts = !normalizedRawQuery.startsWith("@");
    const shouldIncludeAtBuiltIns = !normalizedRawQuery.startsWith("/");
    const shouldIncludeSlashBuiltIns = !normalizedRawQuery.startsWith("@");
    const shouldFilterBuiltInsByQuery = query.length > 0;
    const todoBuiltIn: SideNoteMentionSuggestion = {
        kind: "built-in",
        mention: "@todo",
        label: "Todo",
    };
    const agentBuiltIns: SideNoteMentionSuggestion[] = getSupportedAgentActors().map((actor) => ({
            kind: "built-in" as const,
            mention: actor.directive,
            label: actor.label,
        }));
    const createScriptBuiltIn: SideNoteMentionSuggestion = {
        kind: "built-in",
        mention: CREATE_SCRIPT_DIRECTIVE,
        label: "Create script",
    };
    const atBuiltIns = [
        todoBuiltIn,
        ...(agentsFeatureAvailable ? agentBuiltIns : []),
    ];
    const slashBuiltIns = agentsFeatureAvailable ? [createScriptBuiltIn] : [];
    const allBuiltIns = [todoBuiltIn, ...agentBuiltIns, createScriptBuiltIn];
    const reservedMentionNames = new Set(
        allBuiltIns.map((suggestion) => suggestion.mention.slice(1).toLowerCase()),
    );
    const builtInCandidates = [
        ...(shouldIncludeAtBuiltIns ? atBuiltIns : []),
        ...(shouldIncludeSlashBuiltIns ? slashBuiltIns : []),
    ];
    const scriptCandidates = shouldIncludeScripts
        ? scripts
            .filter((script) => !reservedMentionNames.has(script.normalizedMentionName))
            .map((script) => {
                const mention: `/${string}` = `/${script.mentionName}`;
                return {
                    kind: "script" as const,
                    mention,
                    label: script.fileName,
                    scriptPath: script.path,
                };
            })
        : [];
    const candidates: SideNoteMentionSuggestion[] = [
        ...builtInCandidates,
        ...scriptCandidates,
    ];
    const score = (candidate: SideNoteMentionSuggestion): number => {
        const mention = candidate.mention;
        if (candidate.kind === "built-in" && !shouldFilterBuiltInsByQuery) {
            return 0;
        }
        const name = mention.slice(1).toLowerCase();
        if (!query || name === query) {
            return 0;
        }
        if (name.startsWith(query)) {
            return 1;
        }
        return name.includes(query) ? 2 : Number.POSITIVE_INFINITY;
    };

    return candidates
        .map((candidate, index) => ({
            candidate,
            index,
            score: score(candidate),
        }))
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => left.score - right.score || left.index - right.index)
        .map((item) => item.candidate);
}

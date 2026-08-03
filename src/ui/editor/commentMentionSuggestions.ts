import type { VaultScriptRegistration } from "../../../shared/vaultScriptPolicy.js";
import { getSupportedAgentActors } from "../../core/agents/agentActorRegistry";
import type { TextEditResult } from "./commentEditorFormatting";

export interface OpenMentionQuery {
    start: number;
    end: number;
    query: string;
}

export type SideNoteMentionSuggestion =
    | {
        kind: "built-in";
        mention: "@todo" | `@${string}`;
        label: string;
    }
    | {
        kind: "script";
        mention: `@${string}`;
        label: string;
        scriptPath: string;
    };

export function findOpenMentionQuery(
    value: string,
    selectionStart: number,
    selectionEnd: number,
): OpenMentionQuery | null {
    if (selectionStart !== selectionEnd) {
        return null;
    }

    const prefix = value.slice(0, selectionStart);
    const match = /(^|[^\w])@([A-Za-z0-9_.-]*)$/u.exec(prefix);
    if (!match) {
        return null;
    }

    const start = selectionStart - (match[2]?.length ?? 0) - 1;
    return {
        start,
        end: selectionStart,
        query: match[2] ?? "",
    };
}

export function replaceOpenMentionQuery(
    value: string,
    query: OpenMentionQuery,
    mention: string,
): TextEditResult {
    const normalizedMention = mention.startsWith("@") ? mention : `@${mention}`;
    const cursor = query.start + normalizedMention.length;
    return {
        value: `${value.slice(0, query.start)}${normalizedMention}${value.slice(query.end)}`,
        selectionStart: cursor,
        selectionEnd: cursor,
    };
}

export function buildMentionSuggestions(
    scripts: readonly VaultScriptRegistration[],
    rawQuery: string,
): SideNoteMentionSuggestion[] {
    const query = rawQuery.trim().replace(/^@/u, "").toLowerCase();
    const builtIns: SideNoteMentionSuggestion[] = [
        {
            kind: "built-in",
            mention: "@todo",
            label: "Todo",
        },
        ...getSupportedAgentActors().map((actor) => ({
            kind: "built-in" as const,
            mention: actor.directive,
            label: actor.label,
        })),
    ];
    const candidates: SideNoteMentionSuggestion[] = builtIns.concat(
        scripts.map((script) => ({
            kind: "script" as const,
            mention: `@${script.mentionName}`,
            label: script.fileName,
            scriptPath: script.path,
        })),
    );
    const score = (mention: string): number => {
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
            score: score(candidate.mention),
        }))
        .filter((item) => Number.isFinite(item.score))
        .sort((left, right) => left.score - right.score || left.index - right.index)
        .map((item) => item.candidate);
}

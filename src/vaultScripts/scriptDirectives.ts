import type { VaultScriptRegistration } from "../../shared/vaultScriptPolicy.js";
import { parseAgentDirectives } from "../core/text/agentDirectives";
import type { VaultScriptRegistry } from "./vaultScriptRegistry";

export type ScriptDirectiveResolution =
    | { kind: "none" }
    | { kind: "script"; script: VaultScriptRegistration }
    | {
        kind: "rejected";
        mentionName: string;
        mentionNames: string[];
        message: string;
    };

const MENTION_PATTERN = /(^|[^\w/])\/([A-Za-z0-9_.-]+)/gu;

export function resolveScriptDirective(
    text: string,
    registry: VaultScriptRegistry,
): ScriptDirectiveResolution {
    const runnable = new Map<string, VaultScriptRegistration>();
    const ambiguous = new Set<string>();
    MENTION_PATTERN.lastIndex = 0;
    for (let match = MENTION_PATTERN.exec(text); match; match = MENTION_PATTERN.exec(text)) {
        const mentionName = (match[2] ?? "").toLowerCase();
        const script = registry.resolve(mentionName);
        if (script) {
            runnable.set(script.normalizedMentionName, script);
        }
        if (registry.isAmbiguous(mentionName)) {
            ambiguous.add(mentionName);
        }
    }

    if (ambiguous.size > 0) {
        const mentionNames = Array.from(ambiguous).sort((left, right) => left.localeCompare(right));
        const mentionName = mentionNames[0] ?? "script";
        return {
            kind: "rejected",
            mentionName,
            mentionNames,
            message: `Script /${mentionName} matches more than one vault file.`,
        };
    }

    const scripts = Array.from(runnable.values()).sort((left, right) =>
        left.normalizedMentionName.localeCompare(right.normalizedMentionName)
    );
    if (scripts.length === 0) {
        return { kind: "none" };
    }
    if (scripts.length > 1) {
        return {
            kind: "rejected",
            mentionName: scripts[0]?.mentionName ?? "script",
            mentionNames: scripts.map((script) => script.normalizedMentionName),
            message: "Use only one vault script per side note.",
        };
    }

    const script = scripts[0];
    if (!script) {
        return { kind: "none" };
    }
    const agentResolution = parseAgentDirectives(text);
    if (agentResolution.matchedTargets.length > 0) {
        return {
            kind: "rejected",
            mentionName: script.mentionName,
            mentionNames: [
                script.normalizedMentionName,
                ...agentResolution.matchedTargets,
            ].sort((left, right) => left.localeCompare(right)),
            message: "Use a vault script or an agent, not both.",
        };
    }

    return { kind: "script", script };
}

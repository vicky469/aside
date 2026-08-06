import {
    collectVaultScriptRegistrations,
    parseVaultScriptPath,
    VaultScriptRegistration,
} from "../../shared/vaultScriptPolicy";
import { getSupportedAgentActors } from "../core/agents/agentActorRegistry";

function normalizeMention(mention: string): string {
    return mention.trim().toLowerCase().replace(/^[@/]/, "");
}

function normalizeAgentDirective(directive: string): string {
    return directive.trim().toLowerCase().replace(/^@/, "");
}

const RESERVED_MENTION_NAMES = new Set([
    "todo",
    ...getSupportedAgentActors().map((actor) => normalizeAgentDirective(actor.directive)),
]);

export class VaultScriptRegistry {
    private paths = new Set<string>();
    private runnableScripts: VaultScriptRegistration[] = [];
    private ambiguousMentionNames: string[] = [];

    seed(paths: readonly string[]): void {
        this.paths = new Set();
        for (const path of paths) {
            const canonicalPath = this.canonicalize(path);
            if (canonicalPath) {
                this.paths.add(canonicalPath);
            }
        }
        this.rebuild();
    }

    upsert(path: string): void {
        const canonicalPath = this.canonicalize(path);
        if (canonicalPath) {
            this.paths.add(canonicalPath);
        }
        this.rebuild();
    }

    rename(previousPath: string, nextPath: string): void {
        const canonicalPreviousPath = this.canonicalize(previousPath);
        if (canonicalPreviousPath) {
            this.paths.delete(canonicalPreviousPath);
        }
        const canonicalNextPath = this.canonicalize(nextPath);
        if (canonicalNextPath) {
            this.paths.add(canonicalNextPath);
        }
        this.rebuild();
    }

    remove(path: string): void {
        const canonicalPath = this.canonicalize(path);
        if (canonicalPath) {
            this.paths.delete(canonicalPath);
        }
        this.rebuild();
    }

    getRunnableScripts(): VaultScriptRegistration[] {
        return this.runnableScripts.map((registration) => ({ ...registration }));
    }

    getAmbiguousMentionNames(): string[] {
        return [...this.ambiguousMentionNames];
    }

    resolve(mention: string): VaultScriptRegistration | null {
        const normalizedMention = normalizeMention(mention);
        const registration = this.runnableScripts.find(
            (candidate) => candidate.normalizedMentionName === normalizedMention,
        );
        return registration ? { ...registration } : null;
    }

    isAmbiguous(mention: string): boolean {
        return this.ambiguousMentionNames.includes(normalizeMention(mention));
    }

    private rebuild(): void {
        const collection = collectVaultScriptRegistrations(this.paths);
        this.runnableScripts = collection.runnable.filter(
            (registration) => !RESERVED_MENTION_NAMES.has(registration.normalizedMentionName),
        );
        this.ambiguousMentionNames = collection.ambiguousMentionNames.filter(
            (mentionName) => !RESERVED_MENTION_NAMES.has(mentionName),
        );
    }

    private canonicalize(path: string): string | null {
        return parseVaultScriptPath(path)?.path ?? null;
    }
}

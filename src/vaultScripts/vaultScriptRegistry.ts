import {
    collectVaultScriptRegistrations,
    VaultScriptRegistration,
} from "../../shared/vaultScriptPolicy";

export class VaultScriptRegistry {
    private paths = new Set<string>();
    private runnableScripts: VaultScriptRegistration[] = [];
    private ambiguousMentionNames: string[] = [];

    seed(paths: readonly string[]): void {
        this.paths = new Set(paths);
        this.rebuild();
    }

    upsert(path: string): void {
        this.paths.add(path);
        this.rebuild();
    }

    rename(previousPath: string, nextPath: string): void {
        this.paths.delete(previousPath);
        this.paths.add(nextPath);
        this.rebuild();
    }

    remove(path: string): void {
        this.paths.delete(path);
        this.rebuild();
    }

    getRunnableScripts(): VaultScriptRegistration[] {
        return this.runnableScripts.map((registration) => ({ ...registration }));
    }

    getAmbiguousMentionNames(): string[] {
        return [...this.ambiguousMentionNames];
    }

    resolve(mention: string): VaultScriptRegistration | null {
        const normalizedMention = this.normalizeMention(mention);
        const registration = this.runnableScripts.find(
            (candidate) => candidate.normalizedMentionName === normalizedMention,
        );
        return registration ? { ...registration } : null;
    }

    isAmbiguous(mention: string): boolean {
        return this.ambiguousMentionNames.includes(this.normalizeMention(mention));
    }

    private rebuild(): void {
        const collection = collectVaultScriptRegistrations(this.paths);
        this.runnableScripts = collection.runnable;
        this.ambiguousMentionNames = collection.ambiguousMentionNames;
    }

    private normalizeMention(mention: string): string {
        return mention.trim().replace(/^@/, "").toLowerCase();
    }
}

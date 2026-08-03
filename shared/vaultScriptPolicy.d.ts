export const VAULT_SCRIPT_FOLDER_PATH: "🛠️ scripts";
export const VAULT_SCRIPT_EXTENSIONS: readonly [".mjs", ".js", ".cjs"];

export interface VaultScriptRegistration {
    path: string;
    fileName: string;
    mentionName: string;
    normalizedMentionName: string;
}

export interface VaultScriptRegistrationCollection {
    runnable: VaultScriptRegistration[];
    ambiguousMentionNames: string[];
}

export function parseVaultScriptPath(value: unknown): VaultScriptRegistration | null;

export function collectVaultScriptRegistrations(
    paths: Iterable<unknown>,
): VaultScriptRegistrationCollection;

import {
    normalizeRemoteRuntimeBearerToken,
    type SideNote2LocalSecrets,
} from "../core/agents/agentRuntimePreferences";

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeLocalSecrets(value: unknown): SideNote2LocalSecrets {
    if (!isRecord(value)) {
        return {};
    }

    const remoteRuntimeBearerToken = normalizeRemoteRuntimeBearerToken(value.remoteRuntimeBearerToken);
    return remoteRuntimeBearerToken
        ? { remoteRuntimeBearerToken }
        : {};
}

export function buildLocalSecretStorageKey(pluginId: string, vaultName: string | null | undefined): string {
    const normalizedPluginId = pluginId.trim() || "side-note2";
    const normalizedVaultName = typeof vaultName === "string" && vaultName.trim()
        ? vaultName.trim()
        : "unknown-vault";
    return `sidenote2.local-secrets.v1.${normalizedPluginId}.${normalizedVaultName}`;
}

export class LocalSecretStore {
    constructor(
        private readonly storageKey: string,
        private readonly storage: StorageLike | null,
    ) {}

    public readSecrets(): SideNote2LocalSecrets {
        if (!this.storage) {
            return {};
        }

        const rawValue = this.storage.getItem(this.storageKey);
        if (!rawValue) {
            return {};
        }

        try {
            return normalizeLocalSecrets(JSON.parse(rawValue));
        } catch {
            return {};
        }
    }

    public writeSecrets(nextSecrets: SideNote2LocalSecrets): void {
        if (!this.storage) {
            return;
        }

        const normalizedSecrets = normalizeLocalSecrets(nextSecrets);
        if (!normalizedSecrets.remoteRuntimeBearerToken) {
            this.storage.removeItem(this.storageKey);
            return;
        }

        this.storage.setItem(this.storageKey, JSON.stringify(normalizedSecrets));
    }
}

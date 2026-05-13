import {
    normalizeRemoteRuntimeBearerToken,
    type AsideLocalSecrets,
} from "../core/agents/agentRuntimePreferences";

interface StorageLike {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeLocalSecrets(value: unknown): AsideLocalSecrets {
    if (!isRecord(value)) {
        return {};
    }

    const remoteRuntimeBearerToken = normalizeRemoteRuntimeBearerToken(value.remoteRuntimeBearerToken);
    return remoteRuntimeBearerToken
        ? { remoteRuntimeBearerToken }
        : {};
}

export function buildLocalSecretStorageKey(
    pluginId: string,
    vaultName: string | null | undefined,
    options: { namespace?: string } = {},
): string {
    const namespace = options.namespace?.trim() || "aside";
    const normalizedPluginId = pluginId.trim() || "aside";
    const normalizedVaultName = typeof vaultName === "string" && vaultName.trim()
        ? vaultName.trim()
        : "unknown-vault";
    return `${namespace}.local-secrets.v1.${normalizedPluginId}.${normalizedVaultName}`;
}

export class LocalSecretStore {
    constructor(
        private readonly storageKey: string,
        private readonly legacyStorageKeys: string[],
        private readonly storage: StorageLike | null,
    ) {}

    public readSecrets(): AsideLocalSecrets {
        if (!this.storage) {
            return {};
        }

        const rawValue = this.storage.getItem(this.storageKey)
            ?? this.legacyStorageKeys
                .map((key) => this.storage?.getItem(key) ?? null)
                .find((value): value is string => value !== null);
        if (!rawValue) {
            return {};
        }

        try {
            const secrets = normalizeLocalSecrets(JSON.parse(rawValue));
            if (secrets.remoteRuntimeBearerToken && !this.storage.getItem(this.storageKey)) {
                this.storage.setItem(this.storageKey, JSON.stringify(secrets));
            }
            return secrets;
        } catch {
            return {};
        }
    }

    public writeSecrets(nextSecrets: AsideLocalSecrets): void {
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

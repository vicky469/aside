import {
    FeatureFlag,
    normalizeFeatureFlags,
    type FeatureFlags,
} from "./featureFlags";

export const PUBLISH_FEATURE_FLAG_STORAGE_KEY = "aside.feature.publish";

export interface FeatureFlagStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
}

export type FeatureFlagStorageSyncOperation = "read" | "persist" | "write";

export interface PublishFeatureFlagStorageSyncOptions {
    storage: FeatureFlagStorage | null;
    getFeatureFlags(): unknown;
    setFeatureFlags(featureFlags: FeatureFlags): void;
    persist(): Promise<void>;
    onError?(operation: FeatureFlagStorageSyncOperation, error: unknown): void;
}

export interface PublishFeatureFlagStorageSyncResult {
    featureFlags: FeatureFlags;
    persisted: boolean;
    mirrored: boolean;
}

function reportError(
    options: PublishFeatureFlagStorageSyncOptions,
    operation: FeatureFlagStorageSyncOperation,
    error: unknown,
): void {
    try {
        options.onError?.(operation, error);
    } catch {
        // Feature-flag diagnostics must not block plugin startup.
    }
}

export async function syncPublishFeatureFlagStorage(
    options: PublishFeatureFlagStorageSyncOptions,
): Promise<PublishFeatureFlagStorageSyncResult> {
    const previousFlags = normalizeFeatureFlags(options.getFeatureFlags());
    if (!options.storage) {
        return {
            featureFlags: previousFlags,
            persisted: false,
            mirrored: false,
        };
    }

    let storedValue: string | null;
    try {
        storedValue = options.storage.getItem(PUBLISH_FEATURE_FLAG_STORAGE_KEY);
    } catch (error) {
        reportError(options, "read", error);
        return {
            featureFlags: previousFlags,
            persisted: false,
            mirrored: false,
        };
    }

    const requestedValue = storedValue === "true"
        ? true
        : storedValue === "false"
            ? false
            : null;
    let canonicalFlags = previousFlags;
    let persisted = false;

    if (
        requestedValue !== null
        && requestedValue !== previousFlags[FeatureFlag.publish]
    ) {
        const requestedFlags = {
            ...previousFlags,
            [FeatureFlag.publish]: requestedValue,
        };
        options.setFeatureFlags(requestedFlags);
        try {
            await options.persist();
            canonicalFlags = requestedFlags;
            persisted = true;
        } catch (error) {
            options.setFeatureFlags(previousFlags);
            reportError(options, "persist", error);
        }
    }

    let mirrored = false;
    try {
        options.storage.setItem(
            PUBLISH_FEATURE_FLAG_STORAGE_KEY,
            String(canonicalFlags[FeatureFlag.publish]),
        );
        mirrored = true;
    } catch (error) {
        reportError(options, "write", error);
    }

    return {
        featureFlags: canonicalFlags,
        persisted,
        mirrored,
    };
}

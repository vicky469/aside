import * as assert from "node:assert/strict";
import test from "node:test";
import { buildLocalSecretStorageKey, LocalSecretStore } from "../src/settings/localSecretStore";

class MemoryStorage {
    private readonly values = new Map<string, string>();

    public getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }

    public setItem(key: string, value: string): void {
        this.values.set(key, value);
    }

    public removeItem(key: string): void {
        this.values.delete(key);
    }
}

test("buildLocalSecretStorageKey scopes device-local secrets by plugin and vault", () => {
    assert.equal(
        buildLocalSecretStorageKey("side-note2", "My Vault"),
        "sidenote2.local-secrets.v1.side-note2.My Vault",
    );
});

test("LocalSecretStore writes and reads the remote runtime bearer token", () => {
    const storage = new MemoryStorage();
    const store = new LocalSecretStore("key", storage);

    store.writeSecrets({
        remoteRuntimeBearerToken: "  secret-token  ",
    });

    assert.deepEqual(store.readSecrets(), {
        remoteRuntimeBearerToken: "secret-token",
    });
});

test("LocalSecretStore removes empty tokens instead of keeping blank payloads", () => {
    const storage = new MemoryStorage();
    const store = new LocalSecretStore("key", storage);

    store.writeSecrets({
        remoteRuntimeBearerToken: "secret-token",
    });
    store.writeSecrets({
        remoteRuntimeBearerToken: "   ",
    });

    assert.deepEqual(store.readSecrets(), {});
});

import * as assert from "node:assert/strict";
import test from "node:test";
import { VAULT_SCRIPT_FOLDER_PATH } from "../shared/vaultScriptPolicy.js";
import {
    ensureVaultScriptFolder,
    type VaultScriptFolderPathKind,
} from "../src/vaultScripts/vaultScriptFolderProvisioner";

const CONFLICT_MESSAGE = "Couldn’t create 🛠️ scripts/ because a file already uses that path.";
const FAILURE_MESSAGE = "Couldn’t create 🛠️ scripts/. Check that the vault is writable and try again.";

function createHarness(options: {
    pathKinds: VaultScriptFolderPathKind[];
    createFolder?: () => Promise<void>;
}) {
    const pathKinds = [...options.pathKinds];
    const pathsRead: string[] = [];
    const pathsCreated: string[] = [];

    return {
        pathsRead,
        pathsCreated,
        run: () => ensureVaultScriptFolder({
            getPathKind: (path) => {
                pathsRead.push(path);
                const next = pathKinds.shift();
                assert.notEqual(next, undefined, "unexpected path-kind read");
                return next as VaultScriptFolderPathKind;
            },
            createFolder: async (path) => {
                pathsCreated.push(path);
                await options.createFolder?.();
            },
        }),
    };
}

test("existing script folder succeeds without creating it", async () => {
    const harness = createHarness({ pathKinds: ["folder"] });

    assert.deepEqual(await harness.run(), { ok: true });
    assert.deepEqual(harness.pathsRead, [VAULT_SCRIPT_FOLDER_PATH]);
    assert.deepEqual(harness.pathsCreated, []);
});

test("missing script folder is created exactly once", async () => {
    const harness = createHarness({ pathKinds: ["missing"] });

    assert.deepEqual(await harness.run(), { ok: true });
    assert.deepEqual(harness.pathsCreated, [VAULT_SCRIPT_FOLDER_PATH]);
});

test("occupied script folder path returns the persistent conflict message", async () => {
    const harness = createHarness({ pathKinds: ["occupied"] });

    assert.deepEqual(await harness.run(), { ok: false, message: CONFLICT_MESSAGE });
    assert.deepEqual(harness.pathsCreated, []);
});

test("concurrent script folder creation is treated as success", async () => {
    const harness = createHarness({
        pathKinds: ["missing", "folder"],
        createFolder: async () => {
            throw new Error("another creator won the race");
        },
    });

    assert.deepEqual(await harness.run(), { ok: true });
    assert.deepEqual(harness.pathsCreated, [VAULT_SCRIPT_FOLDER_PATH]);
});

test("failed script folder creation that remains missing returns a generic message", async () => {
    const rawError = "private adapter failure detail";
    const harness = createHarness({
        pathKinds: ["missing", "missing"],
        createFolder: async () => {
            throw new Error(rawError);
        },
    });

    const result = await harness.run();

    assert.deepEqual(result, { ok: false, message: FAILURE_MESSAGE });
    assert.equal(JSON.stringify(result).includes(rawError), false);
});

test("failed script folder creation that becomes occupied returns the conflict message", async () => {
    const rawError = "private race failure detail";
    const harness = createHarness({
        pathKinds: ["missing", "occupied"],
        createFolder: async () => {
            throw new Error(rawError);
        },
    });

    const result = await harness.run();

    assert.deepEqual(result, { ok: false, message: CONFLICT_MESSAGE });
    assert.equal(JSON.stringify(result).includes(rawError), false);
});

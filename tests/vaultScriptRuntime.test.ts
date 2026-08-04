import * as assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
    runVaultScript,
    type VaultScriptRuntimeModules,
} from "../src/vaultScripts/vaultScriptRuntime";

interface CapturedInvocation {
    file: string;
    args: string[];
    options: {
        cwd: string;
        timeout: number;
        maxBuffer: number;
        windowsHide: boolean;
    };
}

interface RuntimeHarness {
    modules: VaultScriptRuntimeModules;
    invocations: CapturedInvocation[];
}

function createRuntimeHarness(options: {
    realpaths?: Readonly<Record<string, string>>;
    result?: { error: Error | null; stdout: string; stderr: string };
} = {}): RuntimeHarness {
    const invocations: CapturedInvocation[] = [];
    const result = options.result ?? { error: null, stdout: "cleaned\n", stderr: "" };
    const realpaths = options.realpaths ?? {};

    return {
        invocations,
        modules: {
            execPath: "/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper.app/Contents/MacOS/Obsidian Helper",
            childProcess: {
                execFile: (
                    file: string,
                    args: string[],
                    execOptions: CapturedInvocation["options"],
                    callback: (error: Error | null, stdout: string, stderr: string) => void,
                ) => {
                    invocations.push({ file, args, options: execOptions });
                    callback(result.error, result.stdout, result.stderr);
                },
            },
            fsPromises: {
                realpath: async (target: string) => realpaths[target] ?? target,
            },
            path: path.posix,
        },
    };
}

test("runVaultScript invokes the embedded Node executable with contained absolute paths", async () => {
    const harness = createRuntimeHarness();

    const result = await runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Folder/Note.md",
    });

    assert.deepEqual(result, { stdout: "cleaned\n", stderr: "" });
    assert.deepEqual(harness.invocations, [{
        file: "/Applications/Obsidian.app/Contents/Frameworks/Obsidian Helper.app/Contents/MacOS/Obsidian Helper",
        args: ["/vault/🛠️ scripts/clean.mjs", "/vault/Folder/Note.md"],
        options: {
            cwd: "/vault",
            timeout: 60_000,
            maxBuffer: 64 * 1024,
            windowsHide: true,
        },
    }]);
});

test("runVaultScript rejects paths that are not registered direct vault scripts", async () => {
    for (const scriptPath of [
        "scripts/clean.mjs",
        "🛠️ scripts/nested/clean.mjs",
        "🛠️ scripts/clean.ts",
        "🛠️ scripts/clean.test.mjs",
        "🛠️ scripts/.hidden.mjs",
    ]) {
        const harness = createRuntimeHarness();

        await assert.rejects(
            runVaultScript(harness.modules, {
                vaultRootPath: "/vault",
                scriptPath,
                notePath: "Note.md",
            }),
            /registered direct child/u,
            scriptPath,
        );
        assert.deepEqual(harness.invocations, [], scriptPath);
    }
});

test("runVaultScript rejects non-markdown note targets before resolving files", async () => {
    const harness = createRuntimeHarness();

    await assert.rejects(
        runVaultScript(harness.modules, {
            vaultRootPath: "/vault",
            scriptPath: "🛠️ scripts/clean.mjs",
            notePath: "Folder/Note.pdf",
        }),
        /markdown note target/u,
    );
    assert.deepEqual(harness.invocations, []);
});

test("runVaultScript rejects script and note realpath escapes", async () => {
    const escapeRealpaths: Array<Readonly<Record<string, string>>> = [
        { "/vault/🛠️ scripts/clean.mjs": "/outside/clean.mjs" },
        { "/vault/Folder/Note.md": "/outside/Note.md" },
    ];
    for (const realpaths of escapeRealpaths) {
        const harness = createRuntimeHarness({ realpaths });

        await assert.rejects(
            runVaultScript(harness.modules, {
                vaultRootPath: "/vault",
                scriptPath: "🛠️ scripts/clean.mjs",
                notePath: "Folder/Note.md",
            }),
            /escapes the active vault/u,
        );
        assert.deepEqual(harness.invocations, []);
    }
});

test("runVaultScript requires the real script to retain its direct user-facing path", async () => {
    const harness = createRuntimeHarness({
        realpaths: {
            "/vault/🛠️ scripts/clean.mjs": "/vault/🛠️ scripts/actual.mjs",
        },
    });

    await assert.rejects(
        runVaultScript(harness.modules, {
            vaultRootPath: "/vault",
            scriptPath: "🛠️ scripts/clean.mjs",
            notePath: "Note.md",
        }),
        /direct user-facing path/u,
    );
    assert.deepEqual(harness.invocations, []);
});

test("runVaultScript uses the real vault root for resolution and execution", async () => {
    const harness = createRuntimeHarness({
        realpaths: {
            "/vault-link": "/real/vault",
        },
    });

    await runVaultScript(harness.modules, {
        vaultRootPath: "/vault-link",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    });

    assert.deepEqual(harness.invocations[0], {
        file: harness.modules.execPath,
        args: ["/real/vault/🛠️ scripts/clean.mjs", "/real/vault/Note.md"],
        options: {
            cwd: "/real/vault",
            timeout: 60_000,
            maxBuffer: 64 * 1024,
            windowsHide: true,
        },
    });
});

test("runVaultScript propagates non-zero failures with captured stdout and stderr", async () => {
    const processError: Error & { code: number; stdout?: string; stderr?: string } = Object.assign(
        new Error("Command failed"),
        { code: 2 },
    );
    const harness = createRuntimeHarness({
        result: { error: processError, stdout: "partial output", stderr: "bad input" },
    });

    await assert.rejects(
        runVaultScript(harness.modules, {
            vaultRootPath: "/vault",
            scriptPath: "🛠️ scripts/clean.mjs",
            notePath: "Note.md",
        }),
        (error: unknown) => {
            const failure = error as Error & { code?: number; stdout?: string; stderr?: string };
            assert.equal(failure, processError);
            assert.equal(failure.code, 2);
            assert.equal(failure.stdout, "partial output");
            assert.equal(failure.stderr, "bad input");
            return true;
        },
    );
});

test("runVaultScript propagates output overflow failures with captured output", async () => {
    const overflowError: Error & { code: string; stdout?: string; stderr?: string } = Object.assign(
        new Error("stdout maxBuffer length exceeded"),
        { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
    );
    const harness = createRuntimeHarness({
        result: { error: overflowError, stdout: "truncated", stderr: "" },
    });

    await assert.rejects(
        runVaultScript(harness.modules, {
            vaultRootPath: "/vault",
            scriptPath: "🛠️ scripts/clean.mjs",
            notePath: "Note.md",
        }),
        (error: unknown) => {
            const failure = error as Error & { code?: string; stdout?: string; stderr?: string };
            assert.equal(failure.code, "ERR_CHILD_PROCESS_STDIO_MAXBUFFER");
            assert.equal(failure.stdout, "truncated");
            assert.equal(failure.stderr, "");
            return true;
        },
    );
});

test("runVaultScript preserves an empty successful result", async () => {
    const harness = createRuntimeHarness({
        result: { error: null, stdout: "", stderr: "" },
    });

    assert.deepEqual(await runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    }), { stdout: "", stderr: "" });
});

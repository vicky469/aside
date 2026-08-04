import * as assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
    disposeVaultScriptRuntimeProcesses,
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
        env: Record<string, string | undefined>;
    };
}

interface RuntimeHarness {
    modules: VaultScriptRuntimeModules;
    invocations: CapturedInvocation[];
}

function createRuntimeHarness(options: {
    pathApi?: VaultScriptRuntimeModules["path"];
    processEnv?: Readonly<Record<string, string | undefined>>;
    realpaths?: Readonly<Record<string, string>>;
    result?: { error: Error | null; stdout: string; stderr: string };
} = {}): RuntimeHarness {
    const invocations: CapturedInvocation[] = [];
    const result = options.result ?? { error: null, stdout: "cleaned\n", stderr: "" };
    const realpaths = options.realpaths ?? {};

    return {
        invocations,
        modules: {
            nodeExecutable: "node",
            processEnv: options.processEnv ?? {
                PATH: "/usr/bin",
                ASIDE_TEST: "kept",
                ELECTRON_RUN_AS_NODE: "0",
            },
            childProcess: {
                execFile: (
                    file: string,
                    args: string[],
                    execOptions: CapturedInvocation["options"],
                    callback: (error: Error | null, stdout: string, stderr: string) => void,
                ) => {
                    invocations.push({ file, args, options: execOptions });
                    callback(result.error, result.stdout, result.stderr);
                    return { kill: () => true };
                },
            },
            fsPromises: {
                realpath: async (target: string) => realpaths[target] ?? target,
            },
            path: options.pathApi ?? path.posix,
        },
    };
}

test("runVaultScript invokes external Node with contained absolute paths", async () => {
    const harness = createRuntimeHarness();

    const result = await runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Folder/Note.md",
    });

    assert.deepEqual(result, { stdout: "cleaned\n", stderr: "" });
    assert.deepEqual(harness.invocations, [{
        file: "node",
        args: ["/vault/🛠️ scripts/clean.mjs", "/vault/Folder/Note.md"],
        options: {
            cwd: "/vault",
            timeout: 60_000,
            maxBuffer: 64 * 1024,
            windowsHide: true,
            env: {
                PATH: "/usr/bin",
                ASIDE_TEST: "kept",
                ELECTRON_RUN_AS_NODE: "0",
            },
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
        file: harness.modules.nodeExecutable,
        args: ["/real/vault/🛠️ scripts/clean.mjs", "/real/vault/Note.md"],
        options: {
            cwd: "/real/vault",
            timeout: 60_000,
            maxBuffer: 64 * 1024,
            windowsHide: true,
            env: {
                PATH: "/usr/bin",
                ASIDE_TEST: "kept",
                ELECTRON_RUN_AS_NODE: "0",
            },
        },
    });
});

test("runVaultScript preserves the injected environment without mutating it", async () => {
    const processEnv = {
        PATH: "/custom/bin",
        CUSTOM_SETTING: "present",
        ELECTRON_RUN_AS_NODE: "disabled",
    } as const;
    const harness = createRuntimeHarness({ processEnv });

    await runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    });

    assert.deepEqual(harness.invocations[0]?.options.env, {
        PATH: "/custom/bin",
        CUSTOM_SETTING: "present",
        ELECTRON_RUN_AS_NODE: "disabled",
    });
    assert.equal(processEnv.ELECTRON_RUN_AS_NODE, "disabled");
});

test("runVaultScript contains valid Windows drive-letter and UNC paths", async () => {
    const cases = [
        {
            vaultRootPath: "C:\\vault",
            expectedScriptPath: "C:\\vault\\🛠️ scripts\\clean.mjs",
            expectedNotePath: "C:\\vault\\Folder\\Note.md",
        },
        {
            vaultRootPath: "\\\\server\\share\\vault",
            expectedScriptPath: "\\\\server\\share\\vault\\🛠️ scripts\\clean.mjs",
            expectedNotePath: "\\\\server\\share\\vault\\Folder\\Note.md",
        },
    ];

    for (const testCase of cases) {
        const harness = createRuntimeHarness({ pathApi: path.win32 });

        await runVaultScript(harness.modules, {
            vaultRootPath: testCase.vaultRootPath,
            scriptPath: "🛠️ scripts/clean.mjs",
            notePath: "Folder/Note.md",
        });

        assert.deepEqual(harness.invocations[0]?.args, [
            testCase.expectedScriptPath,
            testCase.expectedNotePath,
        ]);
        assert.equal(harness.invocations[0]?.options.cwd, testCase.vaultRootPath);
    }
});

test("runVaultScript rejects Windows drive-letter and UNC realpath escapes", async () => {
    const cases: Array<{
        vaultRootPath: string;
        realpaths: Readonly<Record<string, string>>;
    }> = [
        {
            vaultRootPath: "C:\\vault",
            realpaths: {
                "C:\\vault\\🛠️ scripts\\clean.mjs": "D:\\outside\\clean.mjs",
            },
        },
        {
            vaultRootPath: "\\\\server\\share\\vault",
            realpaths: {
                "\\\\server\\share\\vault\\Folder\\Note.md": "\\\\other\\share\\Note.md",
            },
        },
    ];

    for (const testCase of cases) {
        const harness = createRuntimeHarness({
            pathApi: path.win32,
            realpaths: testCase.realpaths,
        });

        await assert.rejects(
            runVaultScript(harness.modules, {
                vaultRootPath: testCase.vaultRootPath,
                scriptPath: "🛠️ scripts/clean.mjs",
                notePath: "Folder/Note.md",
            }),
            /escapes the active vault/u,
        );
        assert.deepEqual(harness.invocations, []);
    }
});

test("runVaultScript rejects Windows script aliases at different drive-letter and UNC direct paths", async () => {
    const cases: Array<{
        vaultRootPath: string;
        realpaths: Readonly<Record<string, string>>;
    }> = [
        {
            vaultRootPath: "C:\\vault",
            realpaths: {
                "C:\\vault\\🛠️ scripts\\clean.mjs": "C:\\vault\\🛠️ scripts\\actual.mjs",
            },
        },
        {
            vaultRootPath: "\\\\server\\share\\vault",
            realpaths: {
                "\\\\server\\share\\vault\\🛠️ scripts\\clean.mjs": "\\\\server\\share\\vault\\🛠️ scripts\\actual.mjs",
            },
        },
    ];

    for (const testCase of cases) {
        const harness = createRuntimeHarness({
            pathApi: path.win32,
            realpaths: testCase.realpaths,
        });

        await assert.rejects(
            runVaultScript(harness.modules, {
                vaultRootPath: testCase.vaultRootPath,
                scriptPath: "🛠️ scripts/clean.mjs",
                notePath: "Note.md",
            }),
            /direct user-facing path/u,
        );
        assert.deepEqual(harness.invocations, []);
    }
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

test("disposeVaultScriptRuntimeProcesses terminates active external Node children", async () => {
    let killedWith: string | number | undefined;
    let callback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
    const harness = createRuntimeHarness();
    harness.modules.childProcess.execFile = (_file, _args, _options, nextCallback) => {
        callback = nextCallback;
        return {
            kill: (signal?: string | number) => {
                killedWith = signal;
                return true;
            },
        };
    };

    const execution = runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    disposeVaultScriptRuntimeProcesses();
    assert.equal(killedWith, "SIGTERM");
    callback?.(Object.assign(new Error("terminated"), { code: "SIGTERM" }), "", "");
    await assert.rejects(execution, /terminated/u);
});

import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
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
    isScriptLaunchAllowed?: () => boolean;
    pathApi?: VaultScriptRuntimeModules["path"];
    platform?: string;
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
            isScriptLaunchAllowed: () => options.isScriptLaunchAllowed?.() ?? true,
            nodeExecutable: "node",
            platform: options.platform ?? process.platform,
            processEnv: options.processEnv ?? {
                PATH: "/usr/bin",
                ASIDE_TEST: "kept",
                ELECTRON_RUN_AS_NODE: "0",
            },
            scheduleTimeout: (callback, delayMs) => {
                const timeout = globalThis.setTimeout(callback, delayMs);
                return { cancel: () => globalThis.clearTimeout(timeout) };
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
    let pausedStreams = 0;
    let callback: ((error: Error | null, stdout: string, stderr: string) => void) | undefined;
    const harness = createRuntimeHarness();
    harness.modules.childProcess.execFile = (_file, _args, _options, nextCallback) => {
        callback = nextCallback;
        return {
            kill: (signal?: string | number) => {
                killedWith = signal;
                return true;
            },
            stdout: {
                on: () => {},
                off: () => {},
                pause: () => { pausedStreams += 1; },
            },
            stderr: {
                on: () => {},
                off: () => {},
                pause: () => { pausedStreams += 1; },
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
    assert.equal(pausedStreams, 0);
    callback?.(Object.assign(new Error("terminated"), { code: "SIGTERM" }), "", "");
    await assert.rejects(execution, /terminated/u);
});

test("Windows disposal terminates the complete vault-script process tree", async () => {
    let scriptCallback:
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
    const taskkillInvocations: Array<{ file: string; args: string[] }> = [];
    const directKills: Array<string | number | undefined> = [];
    const harness = createRuntimeHarness({ pathApi: path.win32, platform: "win32" });
    harness.modules.childProcess.execFile = (file, args, _options, callback) => {
        if (file === harness.modules.nodeExecutable) {
            scriptCallback = callback;
            return {
                pid: 4242,
                kill: (signal?: string | number) => {
                    directKills.push(signal);
                    return true;
                },
            } as ReturnType<VaultScriptRuntimeModules["childProcess"]["execFile"]> & {
                pid: number;
            };
        }

        taskkillInvocations.push({ file, args });
        callback(null, "", "");
        return { kill: () => true };
    };

    const execution = runVaultScript(harness.modules, {
        vaultRootPath: "C:\\vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    disposeVaultScriptRuntimeProcesses();
    scriptCallback?.(Object.assign(new Error("terminated"), { code: "SIGTERM" }), "", "");
    await assert.rejects(execution, /terminated/u);
    assert.deepEqual(taskkillInvocations, [{
        file: "taskkill",
        args: ["/PID", "4242", "/T", "/F"],
    }]);
    assert.deepEqual(directKills, []);
});

test("Windows timeout terminates the complete vault-script process tree", async (context) => {
    context.mock.timers.enable({ apis: ["setTimeout"] });
    let scriptCallback:
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
    let scriptTimeout: number | undefined;
    const taskkillInvocations: Array<{ file: string; args: string[] }> = [];
    const harness = createRuntimeHarness({ pathApi: path.win32, platform: "win32" });
    harness.modules.childProcess.execFile = (file, args, options, callback) => {
        if (file === harness.modules.nodeExecutable) {
            scriptCallback = callback;
            scriptTimeout = options.timeout;
            return { pid: 5252, kill: () => true };
        }

        taskkillInvocations.push({ file, args });
        callback(null, "", "");
        return { kill: () => true };
    };

    try {
        const execution = runVaultScript(harness.modules, {
            vaultRootPath: "C:\\vault",
            scriptPath: "🛠️ scripts/clean.mjs",
            notePath: "Note.md",
        });
        await new Promise<void>((resolve) => setImmediate(resolve));

        assert.equal(scriptTimeout, 0);
        context.mock.timers.tick(60_000);
        assert.deepEqual(taskkillInvocations, [{
            file: "taskkill",
            args: ["/PID", "5252", "/T", "/F"],
        }]);

        scriptCallback?.(Object.assign(new Error("terminated"), { code: "SIGTERM" }), "", "");
        await assert.rejects(execution, (error: unknown) => {
            assert.equal((error as Error & { code?: string }).code, "ETIMEDOUT");
            return true;
        });
    } finally {
        context.mock.timers.reset();
    }
});

test("Windows output overflow terminates the complete vault-script process tree", async () => {
    let scriptCallback:
        | ((error: Error | null, stdout: string, stderr: string) => void)
        | undefined;
    let scriptMaxBuffer: number | undefined;
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    let stdoutPauses = 0;
    let stderrPauses = 0;
    Object.assign(stdout, { pause: () => { stdoutPauses += 1; } });
    Object.assign(stderr, { pause: () => { stderrPauses += 1; } });
    const taskkillInvocations: Array<{ file: string; args: string[] }> = [];
    const harness = createRuntimeHarness({ pathApi: path.win32, platform: "win32" });
    harness.modules.childProcess.execFile = (file, args, options, callback) => {
        if (file === harness.modules.nodeExecutable) {
            scriptCallback = callback;
            scriptMaxBuffer = options.maxBuffer;
            return {
                pid: 6262,
                kill: () => true,
                stdout,
                stderr,
            } as ReturnType<VaultScriptRuntimeModules["childProcess"]["execFile"]> & {
                stdout: EventEmitter;
                stderr: EventEmitter;
            };
        }

        taskkillInvocations.push({ file, args });
        callback(null, "", "");
        return { kill: () => true };
    };

    const execution = runVaultScript(harness.modules, {
        vaultRootPath: "C:\\vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    stdout.emit("data", Buffer.alloc(64 * 1024 + 1));
    assert.equal(scriptMaxBuffer, Number.MAX_SAFE_INTEGER);
    assert.deepEqual(taskkillInvocations, [{
        file: "taskkill",
        args: ["/PID", "6262", "/T", "/F"],
    }]);
    assert.equal(stdoutPauses, 1);
    assert.equal(stderrPauses, 1);

    scriptCallback?.(Object.assign(new Error("terminated"), { code: "SIGTERM" }), "partial", "");
    await assert.rejects(execution, (error: unknown) => {
        assert.equal(
            (error as Error & { code?: string }).code,
            "ERR_CHILD_PROCESS_STDIO_MAXBUFFER",
        );
        return true;
    });
});

test("runtime disposal prevents a child from spawning after pending path resolution", async () => {
    let releaseFirstRealpath = () => {};
    let realpathCalls = 0;
    const harness = createRuntimeHarness();
    harness.modules.fsPromises.realpath = async (target) => {
        realpathCalls += 1;
        if (realpathCalls === 1) {
            await new Promise<void>((resolve) => {
                releaseFirstRealpath = resolve;
            });
        }
        return target;
    };

    const execution = runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    disposeVaultScriptRuntimeProcesses();
    releaseFirstRealpath();

    await assert.rejects(execution, /unloaded/iu);
    assert.deepEqual(harness.invocations, []);
});

test("final registration check prevents launch after registry changes during path resolution", async () => {
    let launchAllowed = true;
    let releaseFirstRealpath = () => {};
    let realpathCalls = 0;
    const harness = createRuntimeHarness({
        isScriptLaunchAllowed: () => launchAllowed,
    });
    harness.modules.fsPromises.realpath = async (target) => {
        realpathCalls += 1;
        if (realpathCalls === 1) {
            await new Promise<void>((resolve) => {
                releaseFirstRealpath = resolve;
            });
        }
        return target;
    };

    const execution = runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    launchAllowed = false;
    releaseFirstRealpath();

    await assert.rejects(execution, /no longer registered/iu);
    assert.deepEqual(harness.invocations, []);
});

test("final registration check prevents launch when the plugin already unloaded", async () => {
    const harness = createRuntimeHarness({ isScriptLaunchAllowed: () => false });

    await assert.rejects(runVaultScript(harness.modules, {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Note.md",
    }), /no longer registered/iu);
    assert.deepEqual(harness.invocations, []);
});

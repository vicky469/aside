import { parseVaultScriptPath } from "../../shared/vaultScriptPolicy.js";

export const VAULT_SCRIPT_TIMEOUT_MS = 60_000;
export const VAULT_SCRIPT_MAX_BUFFER_BYTES = 64 * 1024;

export interface VaultScriptRuntimeInvocation {
    vaultRootPath: string;
    scriptPath: string;
    notePath: string;
}

export interface VaultScriptRuntimeResult {
    stdout: string;
    stderr: string;
}

export type VaultScriptRuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface VaultScriptRuntimeChildProcess {
    pid?: number;
    kill(signal?: string | number): boolean;
    stderr?: {
        on(event: "data", listener: (chunk: string | Uint8Array) => void): void;
        off(event: "data", listener: (chunk: string | Uint8Array) => void): void;
        pause(): void;
    } | null;
    stdout?: {
        on(event: "data", listener: (chunk: string | Uint8Array) => void): void;
        off(event: "data", listener: (chunk: string | Uint8Array) => void): void;
        pause(): void;
    } | null;
}

export interface VaultScriptRuntimeModules {
    isScriptLaunchAllowed(scriptPath: string): boolean;
    nodeExecutable: string;
    platform: string;
    processEnv: VaultScriptRuntimeEnvironment;
    scheduleTimeout(callback: () => void, delayMs: number): { cancel(): void };
    childProcess: {
        execFile(
            file: string,
            args: string[],
            options: {
                cwd: string;
                timeout: number;
                maxBuffer: number;
                windowsHide: boolean;
                env: Record<string, string | undefined>;
            },
            callback: (error: Error | null, stdout: string, stderr: string) => void,
        ): VaultScriptRuntimeChildProcess;
    };
    fsPromises: {
        realpath(path: string): Promise<string>;
    };
    path: {
        isAbsolute(path: string): boolean;
        relative(from: string, to: string): string;
        resolve(...paths: string[]): string;
        sep: string;
    };
}

interface ActiveVaultScriptProcess {
    cancelTimeout(): void;
    terminateTree(): void;
}

const activeVaultScriptProcesses = new Set<ActiveVaultScriptProcess>();
let vaultScriptRuntimeGeneration = 0;

function terminateVaultScriptProcessTree(
    modules: VaultScriptRuntimeModules,
    childProcess: VaultScriptRuntimeChildProcess,
    cwd: string,
): void {
    const terminateDirectChild = () => {
        try {
            childProcess.kill("SIGTERM");
        } catch {
            // The process may have exited before cancellation reached it.
        }
    };

    if (modules.platform !== "win32" || !childProcess.pid) {
        terminateDirectChild();
        return;
    }

    try {
        modules.childProcess.execFile(
            "taskkill",
            ["/PID", String(childProcess.pid), "/T", "/F"],
            {
                cwd,
                timeout: 5_000,
                maxBuffer: VAULT_SCRIPT_MAX_BUFFER_BYTES,
                windowsHide: true,
                env: { ...modules.processEnv },
            },
            (error) => {
                if (error) terminateDirectChild();
            },
        );
    } catch {
        terminateDirectChild();
    }
}

function getChunkByteLength(chunk: string | Uint8Array): number {
    return typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.byteLength;
}

function boundCapturedOutput(output: string): string {
    if (Buffer.byteLength(output) <= VAULT_SCRIPT_MAX_BUFFER_BYTES) return output;
    let byteLength = 0;
    let end = 0;
    for (const character of output) {
        const characterByteLength = Buffer.byteLength(character);
        if (byteLength + characterByteLength > VAULT_SCRIPT_MAX_BUFFER_BYTES) break;
        byteLength += characterByteLength;
        end += character.length;
    }
    return output.slice(0, end);
}

export function disposeVaultScriptRuntimeProcesses(): void {
    vaultScriptRuntimeGeneration += 1;
    const processes = Array.from(activeVaultScriptProcesses);
    activeVaultScriptProcesses.clear();
    for (const activeProcess of processes) {
        activeProcess.cancelTimeout();
        activeProcess.terminateTree();
    }
}

function assertContained(
    modules: VaultScriptRuntimeModules,
    root: string,
    target: string,
): void {
    const relative = modules.path.relative(root, target);
    if (
        !relative
        || relative === ".."
        || relative.startsWith(`..${modules.path.sep}`)
        || modules.path.isAbsolute(relative)
    ) {
        throw new Error("Vault script target escapes the active vault.");
    }
}

export async function runVaultScript(
    modules: VaultScriptRuntimeModules,
    invocation: VaultScriptRuntimeInvocation,
): Promise<VaultScriptRuntimeResult> {
    const runtimeGeneration = vaultScriptRuntimeGeneration;
    const registration = parseVaultScriptPath(invocation.scriptPath);
    if (!registration) {
        throw new Error("Script is not a registered direct child of the vault's 🛠️ scripts/ folder.");
    }
    if (!/\.md$/iu.test(invocation.notePath)) {
        throw new Error("Vault scripts require a markdown note target.");
    }

    const realVaultRoot = await modules.fsPromises.realpath(invocation.vaultRootPath);
    const realScriptPath = await modules.fsPromises.realpath(
        modules.path.resolve(realVaultRoot, ...registration.path.split("/")),
    );
    const realNotePath = await modules.fsPromises.realpath(
        modules.path.resolve(realVaultRoot, ...invocation.notePath.split("/")),
    );

    assertContained(modules, realVaultRoot, realScriptPath);
    assertContained(modules, realVaultRoot, realNotePath);
    const expectedRelativeScriptPath = registration.path
        .split("/")
        .join(modules.path.sep);
    if (modules.path.relative(realVaultRoot, realScriptPath) !== expectedRelativeScriptPath) {
        throw new Error("Registered vault script resolves outside its direct user-facing path.");
    }
    if (runtimeGeneration !== vaultScriptRuntimeGeneration) {
        throw new Error("Vault script execution was cancelled because Aside unloaded.");
    }
    if (!modules.isScriptLaunchAllowed(invocation.scriptPath)) {
        throw new Error("Vault script is no longer registered for launch.");
    }

    return await new Promise<VaultScriptRuntimeResult>((resolve, reject) => {
        let childProcess: VaultScriptRuntimeChildProcess | null = null;
        let activeProcess: ActiveVaultScriptProcess | null = null;
        let windowsTimeout: { cancel(): void } | null = null;
        let pendingWindowsError: (Error & { code?: string }) | null = null;
        let stdoutBytes = 0;
        let stderrBytes = 0;
        let settled = false;
        const handleWindowsOutput = (streamName: "stdout" | "stderr") =>
            (chunk: string | Uint8Array) => {
                if (pendingWindowsError) return;
                if (streamName === "stdout") stdoutBytes += getChunkByteLength(chunk);
                else stderrBytes += getChunkByteLength(chunk);
                const length = streamName === "stdout" ? stdoutBytes : stderrBytes;
                if (length <= VAULT_SCRIPT_MAX_BUFFER_BYTES) return;

                pendingWindowsError = Object.assign(
                    new Error(`${streamName} maxBuffer length exceeded`),
                    { code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER" },
                );
                activeProcess?.terminateTree();
            };
        const onWindowsStdout = handleWindowsOutput("stdout");
        const onWindowsStderr = handleWindowsOutput("stderr");
        childProcess = modules.childProcess.execFile(
            modules.nodeExecutable,
            [realScriptPath, realNotePath],
            {
                cwd: realVaultRoot,
                timeout: modules.platform === "win32" ? 0 : VAULT_SCRIPT_TIMEOUT_MS,
                maxBuffer: modules.platform === "win32"
                    ? Number.MAX_SAFE_INTEGER
                    : VAULT_SCRIPT_MAX_BUFFER_BYTES,
                windowsHide: true,
                env: { ...modules.processEnv },
            },
            (error, stdout, stderr) => {
                settled = true;
                if (windowsTimeout) {
                    windowsTimeout.cancel();
                    windowsTimeout = null;
                }
                if (activeProcess) {
                    activeVaultScriptProcesses.delete(activeProcess);
                }
                childProcess?.stdout?.off("data", onWindowsStdout);
                childProcess?.stderr?.off("data", onWindowsStderr);
                if (pendingWindowsError) {
                    reject(Object.assign(pendingWindowsError, {
                        stdout: boundCapturedOutput(stdout),
                        stderr: boundCapturedOutput(stderr),
                    }));
                    return;
                }
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                    return;
                }
                resolve({ stdout, stderr });
            },
        );
        if (!settled) {
            let terminationRequested = false;
            activeProcess = {
                cancelTimeout: () => {
                    if (!windowsTimeout) return;
                    windowsTimeout.cancel();
                    windowsTimeout = null;
                },
                terminateTree: () => {
                    if (!childProcess || terminationRequested) return;
                    terminationRequested = true;
                    activeProcess?.cancelTimeout();
                    if (modules.platform === "win32") {
                        childProcess.stdout?.pause();
                        childProcess.stderr?.pause();
                    }
                    terminateVaultScriptProcessTree(modules, childProcess, realVaultRoot);
                },
            };
            activeVaultScriptProcesses.add(activeProcess);
            if (modules.platform === "win32") {
                childProcess.stdout?.on("data", onWindowsStdout);
                childProcess.stderr?.on("data", onWindowsStderr);
                windowsTimeout = modules.scheduleTimeout(
                    () => {
                        pendingWindowsError = Object.assign(
                            new Error(`Vault script timed out after ${VAULT_SCRIPT_TIMEOUT_MS} ms`),
                            { code: "ETIMEDOUT" },
                        );
                        activeProcess?.terminateTree();
                    },
                    VAULT_SCRIPT_TIMEOUT_MS,
                );
            }
        }
    });
}

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

export interface VaultScriptRuntimeModules {
    execPath: string;
    processEnv: VaultScriptRuntimeEnvironment;
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
        ): unknown;
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

    return await new Promise<VaultScriptRuntimeResult>((resolve, reject) => {
        modules.childProcess.execFile(
            modules.execPath,
            [realScriptPath, realNotePath],
            {
                cwd: realVaultRoot,
                timeout: VAULT_SCRIPT_TIMEOUT_MS,
                maxBuffer: VAULT_SCRIPT_MAX_BUFFER_BYTES,
                windowsHide: true,
                env: {
                    ...modules.processEnv,
                    ELECTRON_RUN_AS_NODE: "1",
                },
            },
            (error, stdout, stderr) => {
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                    return;
                }
                resolve({ stdout, stderr });
            },
        );
    });
}

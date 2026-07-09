type ExecEnv = Record<string, string | undefined>;

type TrackedChildProcess = {
	stdin?: { end(): void } | null;
	on(event: string, listener: (...args: unknown[]) => void): void;
	kill(signal?: string | number): boolean;
};

export interface WranglerRuntimeModules {
	childProcess: {
		execFile: (
			file: string,
			args: string[],
			options: {
				cwd?: string;
				env?: ExecEnv;
				maxBuffer?: number;
			},
			callback: (error: Error | null, stdout: string, stderr: string) => void,
		) => TrackedChildProcess;
	};
}

export interface WranglerPagesDeployOptions {
	stagingDirPath: string;
	projectName: string;
	publishBaseUrl?: string;
	cwd?: string;
	env?: ExecEnv;
}

export interface WranglerPagesDeployCommand {
	command: string;
	args: string[];
}

export type WranglerPagesDeployResult =
	| {
		ok: true;
		projectName: string;
		stdout: string;
		stderr: string;
	}
	| {
		ok: false;
		projectName: string;
		notice: string;
		stdout: string;
		stderr: string;
	};

const WRANGLER_COMMAND = "wrangler";
const DEFAULT_PAGES_DOMAIN_SUFFIX = "pages.dev";
let resolvedWranglerExecEnvPromise: Promise<ExecEnv> | null = null;
const resolvedWranglerPagesProjectNameByHostname = new Map<string, string>();

function extractLastNonEmptyLine(value: string): string {
	return value
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.filter(Boolean)
		.at(-1) ?? "";
}

function getShellCandidates(baseEnv: ExecEnv): string[] {
	const shells = [baseEnv.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
	const candidates: string[] = [];
	for (const shell of shells) {
		if (typeof shell !== "string" || !shell.trim()) {
			continue;
		}

		if (!candidates.includes(shell)) {
			candidates.push(shell);
		}
	}

	return candidates;
}

function execFileAsync(
	modules: WranglerRuntimeModules,
	file: string,
	args: string[],
	options: {
		cwd?: string;
		env?: ExecEnv;
	},
): Promise<{ stdout: string; stderr: string }> {
	return new Promise((resolve, reject) => {
		const childProcess = modules.childProcess.execFile(
			file,
			args,
			{
				cwd: options.cwd,
				env: options.env,
				maxBuffer: 8 * 1024 * 1024,
			},
			(error, stdout, stderr) => {
				if (error) {
					reject(Object.assign(error, { stdout, stderr }));
					return;
				}

				resolve({ stdout, stderr });
			},
		);
		childProcess.stdin?.end();
	});
}

export function resetResolvedWranglerExecutionEnvForTests(): void {
	resolvedWranglerExecEnvPromise = null;
	resolvedWranglerPagesProjectNameByHostname.clear();
}

export async function resolveWranglerExecutionEnv(
	modules: WranglerRuntimeModules,
	baseEnv: ExecEnv = {},
): Promise<ExecEnv> {
	if (resolvedWranglerExecEnvPromise) {
		return resolvedWranglerExecEnvPromise;
	}

	resolvedWranglerExecEnvPromise = (async () => {
		for (const shell of getShellCandidates(baseEnv)) {
			try {
				const result = await execFileAsync(
					modules,
					shell,
					["-lic", "printf '%s\\n' \"$PATH\""],
					{
						cwd: baseEnv.HOME ?? "/",
						env: baseEnv,
					},
				);
				const loginShellPath = extractLastNonEmptyLine(result.stdout);
				if (loginShellPath) {
					return {
						...baseEnv,
						PATH: loginShellPath,
					};
				}
			} catch {
				continue;
			}
		}

		return baseEnv;
	})();

	return resolvedWranglerExecEnvPromise;
}

export function buildWranglerPagesDeployArgs(options: {
	stagingDirPath: string;
	projectName: string;
}): string[] {
	return [
		"pages",
		"deploy",
		options.stagingDirPath,
		"--project-name",
		options.projectName,
	];
}

export function buildWranglerPagesProjectListArgs(): string[] {
	return [
		"pages",
		"project",
		"list",
		"--json",
	];
}

export function buildWranglerPagesDeployCommand(options: WranglerPagesDeployOptions): WranglerPagesDeployCommand {
	return {
		command: WRANGLER_COMMAND,
		args: buildWranglerPagesDeployArgs({
			stagingDirPath: options.stagingDirPath,
			projectName: options.projectName,
		}),
	};
}

function getPublishHostname(publishBaseUrl: string | undefined): string | null {
	if (!publishBaseUrl) {
		return null;
	}

	try {
		const hostname = new URL(publishBaseUrl).hostname.toLowerCase();
		return hostname || null;
	} catch {
		return null;
	}
}

function isDefaultPagesHostname(hostname: string): boolean {
	return hostname.endsWith(`.${DEFAULT_PAGES_DOMAIN_SUFFIX}`);
}

function getRecordStringValue(record: Record<string, unknown>, keys: string[]): string {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.trim()) {
			return value.trim();
		}
	}
	return "";
}

function getRecordDomainValues(record: Record<string, unknown>): string[] {
	const domains = record.domains ?? record.projectDomains ?? record["Project Domains"];
	if (Array.isArray(domains)) {
		return domains
			.filter((domain): domain is string => typeof domain === "string")
			.map((domain) => domain.trim())
			.filter(Boolean);
	}
	if (typeof domains === "string") {
		return domains
			.split(",")
			.map((domain) => domain.trim())
			.filter(Boolean);
	}
	return [];
}

export function findWranglerPagesProjectNameByPublishBaseUrl(
	publishBaseUrl: string,
	projects: unknown,
): string | null {
	const hostname = getPublishHostname(publishBaseUrl);
	if (!hostname || isDefaultPagesHostname(hostname) || !Array.isArray(projects)) {
		return null;
	}

	for (const project of projects) {
		if (!project || typeof project !== "object") {
			continue;
		}

		const record = project as Record<string, unknown>;
		const projectName = getRecordStringValue(record, [
			"name",
			"projectName",
			"Project Name",
		]);
		if (!projectName) {
			continue;
		}

		const domains = getRecordDomainValues(record).map((domain) => domain.toLowerCase());
		if (domains.includes(hostname)) {
			return projectName;
		}
	}

	return null;
}

async function resolveWranglerPagesDeployProjectName(
	modules: WranglerRuntimeModules,
	options: WranglerPagesDeployOptions,
	env: ExecEnv,
): Promise<string> {
	const hostname = getPublishHostname(options.publishBaseUrl);
	if (!hostname || isDefaultPagesHostname(hostname)) {
		return options.projectName;
	}

	const cached = resolvedWranglerPagesProjectNameByHostname.get(hostname);
	if (cached) {
		return cached;
	}

	try {
		const result = await execFileAsync(
			modules,
			WRANGLER_COMMAND,
			buildWranglerPagesProjectListArgs(),
			{
				cwd: options.cwd,
				env,
			},
		);
		const projects = JSON.parse(result.stdout) as unknown;
		const projectName = findWranglerPagesProjectNameByPublishBaseUrl(options.publishBaseUrl ?? "", projects);
		if (projectName) {
			resolvedWranglerPagesProjectNameByHostname.set(hostname, projectName);
			return projectName;
		}
	} catch {
		// Fall back to the configured project name so the deploy path can surface
		// Wrangler's normal authentication or project-not-found message.
	}

	return options.projectName;
}

function getErrorCode(error: Error): string | null {
	const candidate = error as Error & { code?: unknown };
	return typeof candidate.code === "string" ? candidate.code : null;
}

export function summarizeWranglerFailure(error: Error, stdout: string, stderr: string): string {
	const combinedOutput = `${stderr}\n${stdout}\n${error.message}`.toLowerCase();
	if (getErrorCode(error) === "ENOENT") {
		return "Wrangler was not found. Install Wrangler and make sure `wrangler` is available on PATH.";
	}

	if (/\b(authentication|not logged in|login required|unauthorized|not authenticated)\b/u.test(combinedOutput)) {
		return "Wrangler is not logged in. Run `wrangler login`, then try publishing again.";
	}

	if (/\b(project not found|could not find project|pages project.*not found)\b/u.test(combinedOutput)) {
		return "Cloudflare Pages target was not found. Check your Cloudflare Pages project configuration.";
	}

	const firstLine = `${stderr}\n${stdout}\n${error.message}`
		.split(/\r?\n/u)
		.map((line) => line.trim())
		.find(Boolean);
	return firstLine
		? `Wrangler deploy failed: ${firstLine.slice(0, 240)}`
		: "Wrangler deploy failed. Check Aside logs for details.";
}

export function runWranglerPagesDeploy(
	modules: WranglerRuntimeModules,
	options: WranglerPagesDeployOptions,
): Promise<WranglerPagesDeployResult> {
	return new Promise((resolve) => {
		void (async () => {
			const env = await resolveWranglerExecutionEnv(modules, options.env);
			const projectName = await resolveWranglerPagesDeployProjectName(modules, options, env);
			const command = buildWranglerPagesDeployCommand({
				...options,
				projectName,
			});
			const childProcess = modules.childProcess.execFile(
				command.command,
				command.args,
				{
					cwd: options.cwd,
					env,
					maxBuffer: 8 * 1024 * 1024,
				},
				(error, stdout, stderr) => {
					if (error) {
						resolve({
							ok: false,
							projectName,
							notice: summarizeWranglerFailure(error, stdout, stderr),
							stdout,
							stderr,
						});
						return;
					}

					resolve({
						ok: true,
						projectName,
						stdout,
						stderr,
					});
				},
			);
			childProcess.stdin?.end();
		})();
	});
}

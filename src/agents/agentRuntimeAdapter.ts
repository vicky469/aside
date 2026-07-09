import {
    formatUnavailableAgentRunToolName,
    getAgentRunToolBaseName,
    normalizeAgentRunSkillMetadata,
    normalizeAgentRunToolErrors,
    normalizeAgentRunToolNames,
    normalizeAgentRunUrls,
    type AgentRunMetadata,
    type AgentRunSkillMetadata,
    type AgentRunToolErrorMetadata,
    type AgentRunRuntime,
} from "../core/agents/agentRuns";
import { getAgentActorById } from "../core/agents/agentActorRegistry";
import * as sideNotePromptPolicy from "../../shared/sideNotePromptPolicy.js";
import type { AsideAgentTarget } from "../core/config/agentTargets";

interface ExecFileResult {
    stdout: string;
    stderr: string;
}

type ExecEnv = Record<string, string | undefined>;
type ChildProcessSignal = string;
type FileEncoding = "utf8";
type ChildProcessStream = {
    on(event: "data", listener: (chunk: Buffer | string) => void): void;
};
type ChildProcessStdin = {
    write(chunk: string | Uint8Array): boolean;
    end(): void;
};
type TrackedChildProcess = {
    stdin?: ChildProcessStdin | null;
    stdout?: ChildProcessStream | null;
    stderr?: ChildProcessStream | null;
    on(event: "close", listener: (code: number | null, signal: ChildProcessSignal | null) => void): void;
    on(event: "error", listener: (error: Error) => void): void;
    kill(signal?: ChildProcessSignal | number): boolean;
};

interface NodeModules {
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
        spawn: (
            file: string,
            args: string[],
            options: {
                cwd?: string;
                env?: ExecEnv;
                stdio?: ["ignore" | "pipe", "pipe", "pipe"];
            },
        ) => TrackedChildProcess;
    };
    fsPromises: {
        mkdtemp(prefix: string): Promise<string>;
        readFile(path: string, encoding: FileEncoding): Promise<string>;
        rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
    };
    os: {
        tmpdir(): string;
    };
    path: {
        join(...paths: string[]): string;
    };
}

export interface AgentRuntimeInvocation {
    target: AsideAgentTarget;
    prompt: string;
    cwd: string;
    vaultRootPath?: string | null;
    onPartialText?: (partialText: string) => void;
    onProgressText?: (progressText: string) => void;
    onRunMetadata?: (metadata: AgentRunMetadata) => void;
    abortSignal?: AbortSignal;
}

export interface AgentRuntimeResult extends AgentRunMetadata {
    runtime: AgentRunRuntime;
    replyText: string;
}

export type AgentRuntimeDiagnostics = {
    status: "checking" | "available" | "missing" | "unsupported" | "unavailable";
    message: string;
};
export type CodexRuntimeDiagnostics = AgentRuntimeDiagnostics;
export type ClaudeRuntimeDiagnostics = AgentRuntimeDiagnostics;

export class AgentRuntimeCancelledError extends Error {
    constructor(message: string = "Agent execution cancelled.") {
        super(message);
        this.name = "AgentRuntimeCancelledError";
    }
}

export function isAgentRuntimeCancelledError(error: unknown): error is AgentRuntimeCancelledError {
    return error instanceof AgentRuntimeCancelledError
        || (error instanceof Error && error.name === "AgentRuntimeCancelledError");
}

let resolvedAgentExecEnvPromise: Promise<ExecEnv> | null = null;
const activeAgentRuntimeProcesses = new Set<TrackedChildProcess>();

function getNodeRequire(): ((moduleName: string) => unknown) | null {
    if (typeof window === "undefined") {
        return null;
    }

    const electronRequire = (window as Window & {
        require?: (moduleName: string) => unknown;
    }).require;
    return typeof electronRequire === "function"
        ? electronRequire
        : null;
}

function getNodeModules(): NodeModules | null {
    const nodeRequire = getNodeRequire();
    if (!nodeRequire) {
        return null;
    }

    try {
        return {
            childProcess: nodeRequire("node:child_process") as NodeModules["childProcess"],
            fsPromises: nodeRequire("node:fs/promises") as NodeModules["fsPromises"],
            os: nodeRequire("node:os") as NodeModules["os"],
            path: nodeRequire("node:path") as NodeModules["path"],
        };
    } catch {
        return null;
    }
}

function execFileAsync(
    modules: NodeModules,
    file: string,
    args: string[],
    options: {
        cwd: string;
        env?: ExecEnv;
    },
): Promise<ExecFileResult> {
    return new Promise((resolve, reject) => {
        let childProcess: TrackedChildProcess | null = null;
        const cleanup = () => {
            if (childProcess) {
                activeAgentRuntimeProcesses.delete(childProcess);
            }
        };

        childProcess = modules.childProcess.execFile(
            file,
            args,
            {
                cwd: options.cwd,
                env: options.env,
                maxBuffer: 8 * 1024 * 1024,
            },
            (error, stdout, stderr) => {
                cleanup();
                if (error) {
                    reject(Object.assign(error, { stdout, stderr }));
                    return;
                }

                resolve({ stdout, stderr });
            },
        );
        activeAgentRuntimeProcesses.add(childProcess);
        childProcess.stdin?.end();
    });
}

export function buildSideNotePrompt(options: {
    promptText: string;
    vaultRootPath?: string | null;
}): string {
    return sideNotePromptPolicy.buildSideNotePrompt({
        promptText: options.promptText,
        rootLabel: "vault root",
        rootPath: options.vaultRootPath ?? null,
    });
}

function normalizeNarrationSegment(value: string): string {
    return value
        .replace(/[’]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function isLikelyProcessNarrationSegment(value: string): boolean {
    const normalized = normalizeNarrationSegment(value);
    if (!normalized) {
        return false;
    }

    const startsLikeProcessNarration = /^(i'm|i am|i've|i have|next i'm|next i am|using|loading|searching|reading|looking|found|i found|i located|i loaded|i read|i searched|i am using|i am reading|i am searching)\b/u
        .test(normalized);
    if (!startsLikeProcessNarration) {
        return false;
    }

    return /\b(skill|workflow|workspace|thread|comment block|aside|obsidian|draft|tool|file|search|searching|locat|read|load|append|reply text|context|process|prompt|agent)\b/u
        .test(normalized);
}

function findLeadingSegmentBoundary(value: string): number {
    for (let index = 0; index < value.length; index += 1) {
        const character = value[index];
        if (character === "\n") {
            return index + 1;
        }

        if (!(character === "." || character === "!" || character === "?")) {
            continue;
        }

        const nextCharacter = value[index + 1] ?? "";
        const nextNextCharacter = value[index + 2] ?? "";
        if (!nextCharacter) {
            return index + 1;
        }

        if (/\s/u.test(nextCharacter)) {
            return index + 1;
        }

        if (/\p{Lu}/u.test(nextCharacter)) {
            return index + 1;
        }

        if ((nextCharacter === "\"" || nextCharacter === "'" || nextCharacter === "`" || nextCharacter === ")")
            && (!nextNextCharacter || /\s/u.test(nextNextCharacter))) {
            return index + 1;
        }
    }

    return -1;
}

export function sanitizeAgentReplyText(value: string): string {
    let remaining = value.trimStart();

    while (remaining.length > 0) {
        const boundary = findLeadingSegmentBoundary(remaining);
        if (boundary === -1) {
            return isLikelyProcessNarrationSegment(remaining) ? "" : remaining.trim();
        }

        const segment = remaining.slice(0, boundary);
        if (!isLikelyProcessNarrationSegment(segment)) {
            break;
        }

        remaining = remaining.slice(boundary).trimStart();
    }

    return remaining.trim();
}

function getBaseProcessEnv(): ExecEnv {
    return ((typeof process !== "undefined" ? process.env : {}) as ExecEnv);
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

function extractLastNonEmptyLine(value: string): string {
    const lines = value
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.at(-1) ?? "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function getNestedValue(value: unknown, path: string[]): unknown {
    let current: unknown = value;
    for (const part of path) {
        if (!isRecord(current)) {
            return undefined;
        }

        current = current[part];
    }

    return current;
}

function firstStringAtPaths(value: unknown, paths: string[][]): string | null {
    for (const path of paths) {
        const candidate = getNestedValue(value, path);
        if (typeof candidate === "string" && candidate.length > 0) {
            return candidate;
        }
    }

    return null;
}

function joinTextContentItems(value: unknown): string | null {
    if (!Array.isArray(value)) {
        return null;
    }

    const fragments = value
        .map((item) => {
            if (!isRecord(item)) {
                return null;
            }

            if (item.type === "text" && typeof item.text === "string") {
                return item.text;
            }

            return firstStringAtPaths(item, [
                ["text"],
                ["content"],
            ]);
        })
        .filter((fragment): fragment is string => typeof fragment === "string" && fragment.length > 0);

    return fragments.length ? fragments.join("") : null;
}

function parseJsonLine(line: string): unknown {
    const trimmedLine = line.trim();
    if (!trimmedLine) {
        return null;
    }

    try {
        return JSON.parse(trimmedLine);
    } catch {
        return null;
    }
}

function normalizeRuntimeDiagnosticText(value: string): string | null {
    const normalized = value.replace(/\r\n?/gu, "\n").trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length <= 4000) {
        return normalized;
    }

    return `${normalized.slice(0, 3997).trimEnd()}...`;
}

function pushUniqueDiagnostic(messages: string[], value: string | null): void {
    if (!value || messages.includes(value)) {
        return;
    }

    messages.push(value);
}

function joinRuntimeDiagnostics(messages: Array<string | null | undefined>): string | null {
    const uniqueMessages: string[] = [];
    for (const message of messages) {
        pushUniqueDiagnostic(uniqueMessages, normalizeRuntimeDiagnosticText(message ?? ""));
    }

    return uniqueMessages.length ? uniqueMessages.join("\n") : null;
}

export function extractCodexErrorTextFromJsonEvent(event: unknown): string | null {
    if (!isRecord(event)) {
        return null;
    }

    const eventKey = firstStringAtPaths(event, [
        ["method"],
        ["msg"],
        ["event_type"],
        ["type"],
    ]);
    const status = firstStringAtPaths(event, [
        ["status"],
        ["params", "status"],
        ["payload", "status"],
        ["result", "status"],
    ]);
    const errorValue = getNestedValue(event, ["error"])
        ?? getNestedValue(event, ["params", "error"])
        ?? getNestedValue(event, ["payload", "error"])
        ?? getNestedValue(event, ["result", "error"]);
    const hasErrorSignal = !!eventKey && /\b(error|failed|failure|fatal|panic|unavailable|denied)\b/iu.test(eventKey)
        || !!status && /^(error|failed|failure|fatal|unavailable|denied)$/iu.test(status)
        || (errorValue !== undefined && errorValue !== null && errorValue !== false);
    if (!hasErrorSignal) {
        return null;
    }

    const message = firstStringAtPaths(event, [
        ["message"],
        ["error"],
        ["details"],
        ["detail"],
        ["params", "message"],
        ["params", "error"],
        ["params", "error", "message"],
        ["params", "error", "details"],
        ["params", "error", "detail"],
        ["payload", "message"],
        ["payload", "error"],
        ["payload", "error", "message"],
        ["payload", "error", "details"],
        ["payload", "error", "detail"],
        ["result", "message"],
        ["result", "error"],
        ["result", "error", "message"],
        ["data", "message"],
    ]) ?? stringifyToolErrorPayload(errorValue);

    return normalizeRuntimeDiagnosticText(message ?? "");
}

export function extractCodexTextDeltaFromJsonEvent(event: unknown): string | null {
    const eventKey = firstStringAtPaths(event, [
        ["method"],
        ["msg"],
        ["event_type"],
        ["type"],
    ]);
    if (!(eventKey === "item/agentMessage/delta" || eventKey === "agent_message_content_delta" || eventKey === "agent_message_delta")) {
        return null;
    }

    return firstStringAtPaths(event, [
        ["params", "delta"],
        ["params", "text"],
        ["delta"],
        ["text"],
        ["params", "message", "text"],
        ["message", "text"],
        ["params", "content", "text"],
        ["content", "text"],
    ]) ?? joinTextContentItems(getNestedValue(event, ["params", "contentItems"]))
        ?? joinTextContentItems(getNestedValue(event, ["contentItems"]));
}

function normalizeProgressText(value: string): string | null {
    const normalized = value.replace(/\s+/gu, " ").trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length <= 140) {
        return normalized;
    }

    return `${normalized.slice(0, 137).trimEnd()}...`;
}

function extractPlanProgressText(params: unknown): string | null {
    const explanation = firstStringAtPaths(params, [["explanation"]]);
    if (explanation) {
        return normalizeProgressText(explanation);
    }

    const plan = getNestedValue(params, ["plan"]);
    if (!Array.isArray(plan)) {
        return null;
    }

    for (const step of plan) {
        if (isRecord(step) && step.status === "inProgress" && typeof step.step === "string") {
            return normalizeProgressText(step.step);
        }
    }

    for (const step of plan) {
        if (isRecord(step) && typeof step.step === "string") {
            return normalizeProgressText(step.step);
        }
    }

    return null;
}

function getCodexProgressItem(event: unknown): unknown {
    return getNestedValue(event, ["params", "item"])
        ?? getNestedValue(event, ["item"])
        ?? getNestedValue(event, ["payload", "item"])
        ?? getNestedValue(event, ["payload"]);
}

function extractCodexCommandProgressText(event: unknown, eventKey: string): string | null {
    const command = firstStringAtPaths(event, [
        ["params", "cmd"],
        ["params", "command"],
        ["params", "item", "cmd"],
        ["params", "item", "command"],
        ["item", "cmd"],
        ["item", "command"],
        ["payload", "cmd"],
        ["payload", "command"],
        ["cmd"],
        ["command"],
    ]);
    if (!command) {
        return null;
    }

    const item = getCodexProgressItem(event);
    const itemType = isRecord(item) && typeof item.type === "string" ? item.type : "";
    const looksLikeCommand = /command|exec|cmd|shell/iu.test(eventKey)
        || /command|exec|cmd|shell/iu.test(itemType);
    if (!looksLikeCommand) {
        return null;
    }

    return normalizeProgressText(`Running command: ${command}`);
}

function extractCodexToolProgressText(event: unknown, eventKey: string): string | null {
    const item = getCodexProgressItem(event);
    const toolName = isRecord(item)
        ? getCodexThreadItemToolName(item)
        : firstStringAtPaths(event, [
            ["params", "tool"],
            ["params", "name"],
            ["tool"],
            ["name"],
        ]);
    if (!toolName || toolName === "shell") {
        return null;
    }

    const itemType = isRecord(item) && typeof item.type === "string" ? item.type : "";
    const looksLikeTool = /tool|mcp|web|search|file/i.test(eventKey)
        || /tool|mcp|web|search|file/i.test(itemType);
    if (!looksLikeTool) {
        return null;
    }

    return normalizeProgressText(`Using ${toolName}`);
}

export function extractCodexProgressTextDeltaFromJsonEvent(event: unknown): string | null {
    const eventKey = firstStringAtPaths(event, [
        ["method"],
        ["msg"],
        ["event_type"],
        ["type"],
    ]);
    if (eventKey !== "item/reasoning/summaryTextDelta") {
        return null;
    }

    return firstStringAtPaths(event, [
        ["params", "delta"],
        ["delta"],
    ]) ?? null;
}

export function extractCodexProgressTextFromJsonEvent(event: unknown): string | null {
    const eventKey = firstStringAtPaths(event, [
        ["method"],
        ["msg"],
        ["event_type"],
        ["type"],
    ]);
    if (!eventKey) {
        return null;
    }

    switch (eventKey) {
        case "item/reasoning/summaryTextDelta":
            return normalizeProgressText(extractCodexProgressTextDeltaFromJsonEvent(event) ?? "");
        case "turn/plan/updated":
            return extractPlanProgressText(getNestedValue(event, ["params"]));
        default:
            return extractCodexCommandProgressText(event, eventKey)
                ?? extractCodexToolProgressText(event, eventKey);
    }
}

function collectUrlStrings(value: unknown, urls: Set<string>, depth: number = 0): void {
    if (depth > 5 || value == null) {
        return;
    }

    if (typeof value === "string") {
        const matches = value.match(/https?:\/\/[^\s"'<>]+/gu) ?? [];
        for (const match of matches) {
            for (const url of normalizeAgentRunUrls([match])) {
                urls.add(url);
            }
        }
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            collectUrlStrings(item, urls, depth + 1);
        }
        return;
    }

    if (!isRecord(value)) {
        return;
    }

    for (const item of Object.values(value)) {
        collectUrlStrings(item, urls, depth + 1);
    }
}

function pushSkillMetadataCandidate(value: unknown, candidates: unknown[]): void {
    if (typeof value === "string") {
        candidates.push({ name: value });
        return;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            pushSkillMetadataCandidate(item, candidates);
        }
        return;
    }

    if (isRecord(value)) {
        candidates.push(value);
    }
}

function extractExplicitSkillMetadata(value: unknown): AgentRunSkillMetadata[] {
    const candidates: unknown[] = [];
    for (const path of [
        ["usedSkills"],
        ["skills"],
        ["skill"],
        ["metadata", "usedSkills"],
        ["metadata", "skills"],
        ["metadata", "skill"],
        ["params", "usedSkills"],
        ["params", "skills"],
        ["params", "skill"],
        ["params", "item", "usedSkills"],
        ["params", "item", "skills"],
        ["params", "item", "skill"],
        ["item", "usedSkills"],
        ["item", "skills"],
        ["item", "skill"],
        ["payload", "usedSkills"],
        ["payload", "skills"],
        ["payload", "skill"],
    ]) {
        const candidate = getNestedValue(value, path);
        if (candidate !== undefined) {
            pushSkillMetadataCandidate(candidate, candidates);
        }
    }

    return normalizeAgentRunSkillMetadata(candidates);
}

function getCodexThreadItemToolName(item: Record<string, unknown>): string | null {
    if (typeof item.tool === "string") {
        return item.tool;
    }

    if (typeof item.name === "string") {
        return item.name;
    }

    if (typeof item.command === "string") {
        return "shell";
    }

    switch (item.type) {
        case "webSearch":
            return "web-search";
        case "fileChange":
            return "file-change";
        default:
            return null;
    }
}

export function extractCodexRunMetadataFromThreadItem(item: unknown): Pick<AgentRunMetadata, "usedSkills" | "usedTools" | "usedUrls"> {
    if (!isRecord(item)) {
        return {
            usedTools: [],
            usedUrls: [],
        };
    }

    const usedSkills = extractExplicitSkillMetadata(item);
    if (typeof item.type !== "string") {
        return {
            ...(usedSkills.length ? { usedSkills } : {}),
            usedTools: [],
            usedUrls: [],
        };
    }

    const usedTools = normalizeAgentRunToolNames([
        getCodexThreadItemToolName(item),
    ].filter((tool): tool is string => !!tool));
    const urlSet = new Set<string>();
    collectUrlStrings(item, urlSet);

    return {
        ...(usedSkills.length ? { usedSkills } : {}),
        usedTools,
        usedUrls: Array.from(urlSet),
    };
}

export async function resolveAgentExecutionEnv(
    modules: NodeModules,
    baseEnv: ExecEnv = getBaseProcessEnv(),
): Promise<ExecEnv> {
    if (resolvedAgentExecEnvPromise) {
        return resolvedAgentExecEnvPromise;
    }

    resolvedAgentExecEnvPromise = (async () => {
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

    return resolvedAgentExecEnvPromise;
}

export function resetResolvedAgentExecutionEnvForTests(): void {
    resolvedAgentExecEnvPromise = null;
}

function isExecErrorWithCode(error: unknown, code: string): boolean {
    return !!error
        && typeof error === "object"
        && "code" in error
        && (error as { code?: unknown }).code === code;
}

export async function getCodexRuntimeDiagnostics(
    modulesOverride?: NodeModules | null,
    baseEnv: ExecEnv = getBaseProcessEnv(),
): Promise<CodexRuntimeDiagnostics> {
    const modules = modulesOverride ?? getNodeModules();
    if (!modules) {
        return {
            status: "unsupported",
            message: "Built-in @codex requires desktop Obsidian.",
        };
    }

    try {
        const env = await resolveAgentExecutionEnv(modules, baseEnv);
        await execFileAsync(
            modules,
            "codex",
            ["--help"],
            {
                cwd: env.HOME ?? "/",
                env,
            },
        );
        return {
            status: "available",
            message: "Codex is available.",
        };
    } catch (error) {
        if (isExecErrorWithCode(error, "ENOENT")) {
            return {
                status: "missing",
                message: "Codex was not found on PATH.",
            };
        }

        return {
            status: "unavailable",
            message: "Codex could not be launched from this Obsidian environment.",
        };
    }
}

export async function getClaudeRuntimeDiagnostics(
    modulesOverride?: NodeModules | null,
    baseEnv: ExecEnv = getBaseProcessEnv(),
): Promise<ClaudeRuntimeDiagnostics> {
    const modules = modulesOverride ?? getNodeModules();
    if (!modules) {
        return {
            status: "unsupported",
            message: "Built-in @claude requires desktop Obsidian.",
        };
    }

    try {
        const env = await resolveAgentExecutionEnv(modules, baseEnv);
        await execFileAsync(
            modules,
            "claude",
            ["--help"],
            {
                cwd: env.HOME ?? "/",
                env,
            },
        );
        return {
            status: "available",
            message: "Claude CLI is available.",
        };
    } catch (error) {
        if (isExecErrorWithCode(error, "ENOENT")) {
            return {
                status: "missing",
                message: "Claude CLI was not found on PATH.",
            };
        }

        return {
            status: "unavailable",
            message: "Claude CLI is not authenticated or could not start.",
        };
    }
}

export function disposeAgentRuntimeProcesses(): void {
    for (const childProcess of activeAgentRuntimeProcesses) {
        try {
            childProcess.kill("SIGTERM");
        } catch {
            continue;
        }
    }
    activeAgentRuntimeProcesses.clear();
}

async function spawnInteractiveAgentRuntimeProcess(
    modules: NodeModules,
    file: string,
    args: string[],
    options: {
        cwd: string;
        env?: ExecEnv;
    },
): Promise<TrackedChildProcess> {
    const resolvedEnv = await resolveAgentExecutionEnv(modules, {
        ...getBaseProcessEnv(),
        ...options.env,
    });
    const childProcess = modules.childProcess.spawn(
        file,
        args,
        {
            cwd: options.cwd,
            env: resolvedEnv,
            stdio: ["pipe", "pipe", "pipe"],
        },
    );
    activeAgentRuntimeProcesses.add(childProcess);
    return childProcess;
}

export function createWorkspaceWriteSandboxPolicy(cwd: string, extraWritableRoots: string[] = []) {
    const writableRoots = [cwd, ...extraWritableRoots]
        .filter((value, index, values): value is string => typeof value === "string" && value.length > 0 && values.indexOf(value) === index);
    return {
        type: "workspaceWrite" as const,
        writableRoots,
        readOnlyAccess: {
            type: "fullAccess" as const,
        },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
    };
}

function getClaudeEventType(event: unknown): string | null {
    return firstStringAtPaths(event, [
        ["type"],
        ["event_type"],
    ]);
}

function isClaudeAssistantSnapshot(event: unknown): boolean {
    return getClaudeEventType(event) === "assistant";
}

function getClaudeContentBlocks(event: unknown): Record<string, unknown>[] {
    const content = getNestedValue(event, ["message", "content"]) ?? getNestedValue(event, ["content"]);
    if (!Array.isArray(content)) {
        return [];
    }

    return content.filter((item): item is Record<string, unknown> => isRecord(item));
}

function normalizeClaudeToolName(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.replace(/\s+/gu, " ").trim();
    if (!normalized) {
        return null;
    }

    return /^(bash|shell)$/iu.test(normalized) ? "shell" : normalized;
}

function getFirstClaudeToolName(event: unknown): string | null {
    for (const block of getClaudeContentBlocks(event)) {
        if (block.type !== "tool_use") {
            continue;
        }

        const toolName = normalizeClaudeToolName(block.name);
        if (toolName) {
            return toolName;
        }
    }

    return null;
}

function getClaudeToolUseId(block: Record<string, unknown>): string | null {
    return firstStringAtPaths(block, [
        ["id"],
        ["tool_use_id"],
    ]);
}

function getClaudeToolResultToolUseId(block: Record<string, unknown>): string | null {
    return firstStringAtPaths(block, [
        ["tool_use_id"],
        ["id"],
    ]);
}

function getClaudeToolResultName(block: Record<string, unknown>): string | null {
    return normalizeClaudeToolName(firstStringAtPaths(block, [
        ["name"],
        ["tool_name"],
        ["tool"],
        ["metadata", "name"],
        ["metadata", "tool_name"],
    ]));
}

function stringifyToolErrorPayload(value: unknown): string | null {
    if (typeof value === "string") {
        const normalized = value.replace(/\r\n?/gu, "\n").trim();
        return normalized || null;
    }

    const joinedText = joinTextContentItems(value);
    if (joinedText) {
        return joinedText.replace(/\r\n?/gu, "\n").trim() || null;
    }

    if (value == null) {
        return null;
    }

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return "[unserializable payload]";
    }
}

function getClaudeToolResultPayload(block: Record<string, unknown>): string | null {
    const errorPayload = typeof block.error === "boolean"
        ? null
        : stringifyToolErrorPayload(block.error);
    return stringifyToolErrorPayload(block.content)
        ?? errorPayload
        ?? stringifyToolErrorPayload(block.message)
        ?? stringifyToolErrorPayload(block);
}

function isClaudeToolResultFailure(block: Record<string, unknown>, payload: string | null): boolean {
    if (block.is_error === true || block.error === true) {
        return true;
    }

    const status = firstStringAtPaths(block, [
        ["status"],
        ["result", "status"],
    ]);
    if (status && /^(error|failed|failure|unavailable)$/iu.test(status)) {
        return true;
    }

    return !!payload
        && /\b(unavailable|not available|failed|failure|error|denied|disabled|not enabled|cannot|can't)\b/iu.test(payload);
}

type ClaudeToolErrorCandidate = {
    toolUseId?: string;
    name?: string;
    payload: string;
};

function extractClaudeToolErrorCandidatesFromJsonEvent(event: unknown): ClaudeToolErrorCandidate[] {
    const candidates: ClaudeToolErrorCandidate[] = [];
    for (const block of getClaudeContentBlocks(event)) {
        if (block.type !== "tool_result") {
            continue;
        }

        const payload = getClaudeToolResultPayload(block);
        if (!isClaudeToolResultFailure(block, payload) || !payload) {
            continue;
        }

        const toolUseId = getClaudeToolResultToolUseId(block) ?? undefined;
        const name = getClaudeToolResultName(block) ?? undefined;
        candidates.push({
            ...(toolUseId ? { toolUseId } : {}),
            ...(name ? { name } : {}),
            payload,
        });
    }

    return candidates;
}

export function extractClaudeTextDeltaFromJsonEvent(event: unknown): string | null {
    const eventType = getClaudeEventType(event);
    if (eventType === "content_block_delta") {
        return firstStringAtPaths(event, [
            ["delta", "text"],
            ["text"],
        ]);
    }

    if (eventType !== "assistant") {
        return null;
    }

    return joinTextContentItems(getNestedValue(event, ["message", "content"]))
        ?? joinTextContentItems(getNestedValue(event, ["content"]));
}

export function extractClaudeReplyTextFromJsonEvent(event: unknown): string | null {
    if (getClaudeEventType(event) !== "result") {
        return null;
    }

    const subtype = firstStringAtPaths(event, [["subtype"]]);
    if (subtype && subtype !== "success") {
        return null;
    }

    return firstStringAtPaths(event, [
        ["result"],
        ["message", "content"],
        ["content"],
    ]);
}

export function extractClaudeRunMetadataFromJsonEvent(event: unknown): Pick<AgentRunMetadata, "usedSkills" | "usedTools" | "usedUrls" | "usedToolErrors"> {
    const toolBlocks = getClaudeContentBlocks(event)
        .filter((block) => block.type === "tool_use");
    const toolNames = toolBlocks
        .map((block) => normalizeClaudeToolName(block.name))
        .filter((tool): tool is string => !!tool);
    const urlSet = new Set<string>();
    for (const block of toolBlocks) {
        collectUrlStrings(block.input ?? block, urlSet);
    }

    const usedSkills = normalizeAgentRunSkillMetadata(
        toolBlocks
            .filter((block) => normalizeClaudeToolName(block.name) === "Skill")
            .map((block) => {
                const input = block.input as Record<string, unknown> | undefined;
                const skillName = typeof input?.skill === "string" ? input.skill : undefined;
                return skillName ? { name: skillName } : null;
            })
            .filter((s): s is AgentRunSkillMetadata => s !== null),
    );
    const usedToolErrors = normalizeAgentRunToolErrors(
        extractClaudeToolErrorCandidatesFromJsonEvent(event)
            .filter((candidate) => candidate.name)
            .map((candidate) => ({
                name: candidate.name,
                payload: candidate.payload,
            })),
    );
    return {
        ...(usedSkills.length ? { usedSkills } : {}),
        usedTools: normalizeAgentRunToolNames([
            ...toolNames,
            ...usedToolErrors.map((error) => formatUnavailableAgentRunToolName(error.name)),
        ]),
        usedUrls: Array.from(urlSet),
        ...(usedToolErrors.length ? { usedToolErrors } : {}),
    };
}

export function extractClaudeProgressTextFromJsonEvent(event: unknown): string | null {
    const eventType = getClaudeEventType(event);
    if (eventType === "system" && firstStringAtPaths(event, [["subtype"]]) === "init") {
        return "Starting Claude";
    }

    const toolName = getFirstClaudeToolName(event);
    if (!toolName) {
        return null;
    }

    return toolName === "shell"
        ? "Running command"
        : normalizeProgressText(`Using ${toolName}`);
}

async function runCodexDirect(
    modules: NodeModules,
    invocation: AgentRuntimeInvocation,
): Promise<AgentRuntimeResult> {
    if (invocation.abortSignal?.aborted) {
        throw new AgentRuntimeCancelledError();
    }

    const tempDir = await modules.fsPromises.mkdtemp(modules.path.join(modules.os.tmpdir(), "aside-codex-"));
    const outputLastMessagePath = modules.path.join(tempDir, "last-message.txt");
    let childProcess: TrackedChildProcess;

    try {
        childProcess = await spawnInteractiveAgentRuntimeProcess(
            modules,
            "codex",
            buildCodexCliArgs({
                cwd: invocation.cwd,
                vaultRootPath: invocation.vaultRootPath,
                outputLastMessagePath,
            }),
            {
                cwd: invocation.cwd,
            },
        );
    } catch (error) {
        await modules.fsPromises.rm(tempDir, { recursive: true, force: true });
        throw error;
    }

    return await new Promise<AgentRuntimeResult>((resolve, reject) => {
        let settled = false;
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let streamedText = "";
        const stdoutDiagnosticLines: string[] = [];
        const codexErrorMessages: string[] = [];
        const usedSkills = new Map<string, AgentRunSkillMetadata>();
        const usedTools = new Set<string>();
        const usedUrls = new Set<string>();
        let abortHandler: (() => void) | null = null;

        const cleanup = () => {
            activeAgentRuntimeProcesses.delete(childProcess);
            if (invocation.abortSignal && abortHandler) {
                invocation.abortSignal.removeEventListener("abort", abortHandler);
                abortHandler = null;
            }
            void modules.fsPromises.rm(tempDir, { recursive: true, force: true });
        };

        const finalizeError = (error: unknown) => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            try {
                childProcess.kill("SIGTERM");
            } catch {
                // ignore best-effort cleanup failures
            }
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        const finalizeSuccess = (replyText: string) => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            try {
                childProcess.stdin?.end();
            } catch {
                // ignore best-effort shutdown failures
            }
            resolve({
                runtime: "direct-cli",
                replyText,
                usedSkills: Array.from(usedSkills.values()),
                usedTools: Array.from(usedTools),
                usedUrls: Array.from(usedUrls),
            });
        };

        const readOutputLastMessage = async (): Promise<string | null> => {
            try {
                return await modules.fsPromises.readFile(outputLastMessagePath, "utf8");
            } catch {
                return null;
            }
        };

        const publishRunMetadata = (item: unknown): void => {
            const metadata = extractCodexRunMetadataFromThreadItem(item);
            let changed = false;
            for (const skill of metadata.usedSkills ?? []) {
                const key = [skill.name, skill.mode ?? "", skill.source ?? ""].join("\u0000");
                if (!usedSkills.has(key)) {
                    usedSkills.set(key, skill);
                    changed = true;
                }
            }
            for (const tool of metadata.usedTools ?? []) {
                if (!usedTools.has(tool)) {
                    usedTools.add(tool);
                    changed = true;
                }
            }
            for (const url of metadata.usedUrls ?? []) {
                if (!usedUrls.has(url)) {
                    usedUrls.add(url);
                    changed = true;
                }
            }

            if (changed) {
                invocation.onRunMetadata?.({
                    usedSkills: Array.from(usedSkills.values()),
                    usedTools: Array.from(usedTools),
                    usedUrls: Array.from(usedUrls),
                });
            }
        };

        const handleStdoutMessage = (message: unknown) => {
            pushUniqueDiagnostic(codexErrorMessages, extractCodexErrorTextFromJsonEvent(message));

            publishRunMetadata(getNestedValue(message, ["params", "item"]));
            publishRunMetadata(getNestedValue(message, ["item"]));
            publishRunMetadata(getNestedValue(message, ["payload"]));
            publishRunMetadata(message);

            const progressText = extractCodexProgressTextFromJsonEvent(message);
            if (progressText) {
                invocation.onProgressText?.(progressText);
            }

            const delta = extractCodexTextDeltaFromJsonEvent(message);
            if (delta) {
                streamedText += delta;
                invocation.onPartialText?.(sanitizeAgentReplyText(streamedText));
            }
        };

        const handleStdoutLine = (line: string) => {
            const parsed = parseJsonLine(line);
            if (parsed !== null) {
                handleStdoutMessage(parsed);
                return;
            }

            pushUniqueDiagnostic(stdoutDiagnosticLines, normalizeRuntimeDiagnosticText(line));
        };

        const flushStdoutBuffer = () => {
            handleStdoutLine(stdoutBuffer);
            stdoutBuffer = "";
        };

        childProcess.stdout?.on("data", (chunk) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            stdoutBuffer += text;
            while (true) {
                const newlineIndex = stdoutBuffer.indexOf("\n");
                if (newlineIndex === -1) {
                    break;
                }

                const line = stdoutBuffer.slice(0, newlineIndex);
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                handleStdoutLine(line);
            }
        });

        childProcess.stderr?.on("data", (chunk) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            stderrBuffer += text;
        });

        childProcess.on("error", (error) => {
            finalizeError(error);
        });

        childProcess.on("close", (code, signal) => {
            flushStdoutBuffer();
            if (settled) {
                return;
            }

            void (async () => {
                const outputLastMessage = await readOutputLastMessage();
                const replyText = sanitizeAgentReplyText(outputLastMessage ?? streamedText);
                if (code === 0 && replyText) {
                    finalizeSuccess(replyText);
                    return;
                }

                if (code === 0) {
                    finalizeError(new Error("Codex returned an empty response."));
                    return;
                }

                const stderrMessage = normalizeRuntimeDiagnosticText(stderrBuffer);
                const diagnosticMessage = joinRuntimeDiagnostics([
                    stderrMessage,
                    ...codexErrorMessages,
                    ...stdoutDiagnosticLines,
                ]);
                finalizeError(new Error(
                    diagnosticMessage || `spawn codex exec exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`,
                ));
            })();
        });

        if (invocation.abortSignal) {
            abortHandler = () => {
                finalizeError(new AgentRuntimeCancelledError());
            };
            invocation.abortSignal.addEventListener("abort", abortHandler, { once: true });
            if (invocation.abortSignal.aborted) {
                abortHandler();
                return;
            }
        }

        try {
            const stdin = childProcess.stdin;
            if (!stdin) {
                throw new Error("Codex CLI did not expose stdin.");
            }
            stdin.write(buildSideNotePrompt({
                promptText: invocation.prompt,
                vaultRootPath: invocation.vaultRootPath,
            }));
            stdin.end();
        } catch (error) {
            finalizeError(error);
        }
    });
}

export function buildCodexCliArgs(options: {
    cwd: string;
    vaultRootPath?: string | null;
    outputLastMessagePath?: string | null;
}): string[] {
    const args = [
        "exec",
        "--json",
        "--ephemeral",
        "--skip-git-repo-check",
        "-C",
        options.cwd,
        "-s",
        "workspace-write",
    ];
    if (options.outputLastMessagePath) {
        args.push("--output-last-message", options.outputLastMessagePath);
    }
    if (options.vaultRootPath && options.vaultRootPath !== options.cwd) {
        args.push("--add-dir", options.vaultRootPath);
    }
    args.push("-");
    return args;
}

const CLAUDE_APPEND_SYSTEM_PROMPT = [
    "You generate end-user reply text for an Aside note thread.",
    "Return only the final note reply. Answer directly.",
    "Do not narrate routine process, context-loading, prompts, or AGENTS instructions.",
    "If a tool, search, file operation, or capability fails and affects the answer, say so briefly.",
].join(" ");

export function buildClaudeCliArgs(): string[] {
    return [
        "-p",
        "--verbose",
        "--output-format",
        "stream-json",
        "--include-partial-messages",
        "--no-session-persistence",
        "--allowedTools",
        "WebSearch,Bash,Read,Write,Edit,Glob,Grep",
        "--append-system-prompt",
        CLAUDE_APPEND_SYSTEM_PROMPT,
    ];
}

async function runClaudeDirect(
    modules: NodeModules,
    invocation: AgentRuntimeInvocation,
): Promise<AgentRuntimeResult> {
    if (invocation.abortSignal?.aborted) {
        throw new AgentRuntimeCancelledError();
    }

    const childProcess = await spawnInteractiveAgentRuntimeProcess(
        modules,
        "claude",
        buildClaudeCliArgs(),
        {
            cwd: invocation.cwd,
        },
    );

    return await new Promise<AgentRuntimeResult>((resolve, reject) => {
        let settled = false;
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let streamedText = "";
        let finalText: string | null = null;
        const usedSkills = new Map<string, AgentRunSkillMetadata>();
        const usedTools = new Set<string>();
        const usedUrls = new Set<string>();
        const usedToolErrors = new Map<string, AgentRunToolErrorMetadata>();
        const claudeToolNamesById = new Map<string, string>();
        let abortHandler: (() => void) | null = null;

        const cleanup = () => {
            activeAgentRuntimeProcesses.delete(childProcess);
            if (invocation.abortSignal && abortHandler) {
                invocation.abortSignal.removeEventListener("abort", abortHandler);
                abortHandler = null;
            }
        };

        const finalizeError = (error: unknown) => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            try {
                childProcess.kill("SIGTERM");
            } catch {
                // ignore best-effort cleanup failures
            }
            reject(error instanceof Error ? error : new Error(String(error)));
        };

        const finalizeSuccess = (replyText: string) => {
            if (settled) {
                return;
            }

            settled = true;
            cleanup();
            try {
                childProcess.stdin?.end();
            } catch {
                // ignore best-effort shutdown failures
            }
            resolve({
                runtime: "direct-cli",
                replyText,
                usedSkills: Array.from(usedSkills.values()),
                usedTools: Array.from(usedTools),
                usedUrls: Array.from(usedUrls),
                usedToolErrors: Array.from(usedToolErrors.values()),
            });
        };

        const publishMetadata = (event: unknown): void => {
            for (const block of getClaudeContentBlocks(event)) {
                if (block.type !== "tool_use") {
                    continue;
                }

                const toolUseId = getClaudeToolUseId(block);
                const toolName = normalizeClaudeToolName(block.name);
                if (toolUseId && toolName) {
                    claudeToolNamesById.set(toolUseId, toolName);
                }
            }

            const metadata = extractClaudeRunMetadataFromJsonEvent(event);
            let changed = false;
            for (const skill of metadata.usedSkills ?? []) {
                const key = [skill.name, skill.mode ?? "", skill.source ?? ""].join("\u0000");
                if (!usedSkills.has(key)) {
                    usedSkills.set(key, skill);
                    changed = true;
                }
            }
            const recordToolError = (error: AgentRunToolErrorMetadata): void => {
                const key = [error.name, error.payload].join("\u0000");
                if (!usedToolErrors.has(key)) {
                    usedToolErrors.set(key, error);
                    changed = true;
                }

                const unavailableToolName = formatUnavailableAgentRunToolName(error.name);
                const plainToolName = getAgentRunToolBaseName(error.name);
                if (usedTools.delete(plainToolName)) {
                    changed = true;
                }
                if (!usedTools.has(unavailableToolName)) {
                    usedTools.add(unavailableToolName);
                    changed = true;
                }
            };
            for (const tool of metadata.usedTools ?? []) {
                const baseToolName = getAgentRunToolBaseName(tool);
                const hasToolError = Array.from(usedToolErrors.values())
                    .some((error) => error.name === baseToolName);
                const toolLabel = hasToolError
                    ? formatUnavailableAgentRunToolName(baseToolName)
                    : tool;
                if (!usedTools.has(toolLabel)) {
                    usedTools.add(toolLabel);
                    changed = true;
                }
            }
            for (const url of metadata.usedUrls ?? []) {
                if (!usedUrls.has(url)) {
                    usedUrls.add(url);
                    changed = true;
                }
            }
            for (const error of metadata.usedToolErrors ?? []) {
                recordToolError(error);
            }
            for (const candidate of extractClaudeToolErrorCandidatesFromJsonEvent(event)) {
                const name = candidate.name
                    ?? (candidate.toolUseId ? claudeToolNamesById.get(candidate.toolUseId) : undefined);
                if (!name) {
                    continue;
                }

                for (const error of normalizeAgentRunToolErrors([{
                    name,
                    payload: candidate.payload,
                }])) {
                    recordToolError(error);
                }
            }

            if (changed) {
                invocation.onRunMetadata?.({
                    usedSkills: Array.from(usedSkills.values()),
                    usedTools: Array.from(usedTools),
                    usedUrls: Array.from(usedUrls),
                    usedToolErrors: Array.from(usedToolErrors.values()),
                });
            }
        };

        const handleStdoutEvent = (event: unknown): void => {
            publishMetadata(event);

            const progressText = extractClaudeProgressTextFromJsonEvent(event);
            if (progressText) {
                invocation.onProgressText?.(progressText);
            }

            const replyText = extractClaudeReplyTextFromJsonEvent(event);
            if (replyText) {
                finalText = replyText;
            }

            const textDelta = extractClaudeTextDeltaFromJsonEvent(event);
            if (!textDelta) {
                return;
            }

            streamedText = isClaudeAssistantSnapshot(event)
                ? textDelta
                : `${streamedText}${textDelta}`;
            invocation.onPartialText?.(sanitizeAgentReplyText(streamedText));
        };

        const flushStdoutBuffer = () => {
            if (!stdoutBuffer.trim()) {
                stdoutBuffer = "";
                return;
            }

            const parsed = parseJsonLine(stdoutBuffer);
            stdoutBuffer = "";
            if (parsed !== null) {
                handleStdoutEvent(parsed);
            }
        };

        childProcess.stdout?.on("data", (chunk) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            stdoutBuffer += text;
            while (true) {
                const newlineIndex = stdoutBuffer.indexOf("\n");
                if (newlineIndex === -1) {
                    break;
                }

                const line = stdoutBuffer.slice(0, newlineIndex);
                stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
                const parsed = parseJsonLine(line);
                if (parsed !== null) {
                    handleStdoutEvent(parsed);
                }
            }
        });

        childProcess.stderr?.on("data", (chunk) => {
            const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
            stderrBuffer += text;
        });

        childProcess.on("error", (error) => {
            finalizeError(error);
        });

        childProcess.on("close", (code, signal) => {
            flushStdoutBuffer();
            if (settled) {
                return;
            }

            const replyText = sanitizeAgentReplyText(finalText ?? streamedText);
            if (code === 0 && replyText) {
                finalizeSuccess(replyText);
                return;
            }

            if (code === 0) {
                finalizeError(new Error("Claude returned an empty response."));
                return;
            }

            const stderrMessage = stderrBuffer.trim();
            finalizeError(new Error(
                stderrMessage || `spawn claude exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`,
            ));
        });

        if (invocation.abortSignal) {
            abortHandler = () => {
                finalizeError(new AgentRuntimeCancelledError());
            };
            invocation.abortSignal.addEventListener("abort", abortHandler, { once: true });
            if (invocation.abortSignal.aborted) {
                abortHandler();
                return;
            }
        }

        try {
            const stdin = childProcess.stdin;
            if (!stdin) {
                throw new Error("Claude CLI did not expose stdin.");
            }
            stdin.write(buildSideNotePrompt({
                promptText: invocation.prompt,
                vaultRootPath: invocation.vaultRootPath,
            }));
            stdin.end();
        } catch (error) {
            finalizeError(error);
        }
    });
}

export async function runAgentRuntime(invocation: AgentRuntimeInvocation): Promise<AgentRuntimeResult> {
    const modules = getNodeModules();
    if (!modules) {
        throw new Error("Local agent execution is unavailable in this Obsidian environment.");
    }

    const actor = getAgentActorById(invocation.target);
    if (!actor.supported || actor.runtimeStrategy === "unsupported") {
        throw new Error(actor.unsupportedNotice ?? `${actor.label} is not supported in this build.`);
    }

    switch (actor.runtimeStrategy) {
        case "codex-cli":
            return runCodexDirect(modules, invocation);
        case "claude-cli":
            return runClaudeDirect(modules, invocation);
        default:
            throw new Error(`${actor.label} does not have an executable runtime strategy.`);
    }
}

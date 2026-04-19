import type { AgentRunRuntime } from "../core/agents/agentRuns";
import { getAgentActorById } from "../core/agents/agentActorRegistry";
import type { SideNote2AgentTarget } from "../core/config/agentTargets";

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
    target: SideNote2AgentTarget;
    prompt: string;
    cwd: string;
    onPartialText?: (partialText: string) => void;
    onProgressText?: (progressText: string) => void;
    abortSignal?: AbortSignal;
}

export interface AgentRuntimeResult {
    runtime: AgentRunRuntime;
    replyText: string;
}

export type CodexRuntimeDiagnostics = {
    status: "checking" | "available" | "missing" | "unsupported" | "unavailable";
    message: string;
};

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

type JsonRpcRequestMessage = {
    id: string;
    method: string;
    params?: unknown;
    jsonrpc?: "2.0";
};

type JsonRpcNotificationMessage = {
    method: string;
    params?: unknown;
    jsonrpc?: "2.0";
};

type JsonRpcResponseMessage = {
    id: string;
    result?: unknown;
    error?: unknown;
    jsonrpc?: "2.0";
};

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

function buildSideNotePrompt(promptText: string): string {
    return [
        "You are responding to a SideNote2 thread in Obsidian.",
        "Answer the user's request directly.",
        "Only inspect or modify workspace files when the request actually needs that context.",
        "If the request asks for file changes, make them directly in the workspace before replying.",
        "Return only the reply text that should be appended back into the SideNote2 thread.",
        "Keep the side-note reply compact and easy to scan.",
        "Use plain paragraphs or one simple list; avoid headings, long multi-section layouts, and excess blank lines.",
        "Keep the reply at or under 250 words.",
        "If the best useful answer would exceed 250 words, create or update a short linked wiki note with the full detail and return a concise side note that points to it.",
        "Do not mention skills, prompts, searches, files, tools, AGENTS instructions, or your process.",
        "Do not narrate what you are doing.",
        "Do not include thinking steps or tool logs.",
        "Do not mention reading notes, locating threads, loading context, or using the workspace.",
        "",
        promptText,
    ].join("\n");
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

    return /\b(skill|workflow|workspace|thread|comment block|sidenote2|obsidian|draft|tool|file|search|searching|locat|read|load|append|reply text|context|process|prompt|agent)\b/u
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
            return normalizeProgressText(firstStringAtPaths(event, [
                ["params", "delta"],
                ["delta"],
            ]) ?? "");
        case "turn/plan/updated":
            return extractPlanProgressText(getNestedValue(event, ["params"]));
        default:
            return null;
    }
}

function extractCodexProgressTextFromThreadItem(item: unknown): string | null {
    if (!isRecord(item) || typeof item.type !== "string") {
        return null;
    }

    switch (item.type) {
        case "commandExecution": {
            const command = typeof item.command === "string" ? item.command : "";
            return normalizeProgressText(command ? `Running ${command}` : "Running command");
        }
        case "fileChange": {
            const changeCount = Array.isArray(item.changes) ? item.changes.length : 0;
            return changeCount > 1 ? `Updating ${changeCount} files` : "Updating file";
        }
        case "mcpToolCall": {
            const tool = typeof item.tool === "string" ? item.tool : "tool";
            return normalizeProgressText(`Calling ${tool}`);
        }
        case "dynamicToolCall": {
            const tool = typeof item.tool === "string" ? item.tool : "tool";
            return normalizeProgressText(`Using ${tool}`);
        }
        case "webSearch": {
            const query = typeof item.query === "string" ? item.query : "";
            return normalizeProgressText(query ? `Searching ${query}` : "Searching");
        }
        default:
            return null;
    }
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

function isJsonRpcResponseMessage(value: unknown): value is JsonRpcResponseMessage {
    return isRecord(value)
        && typeof value.id === "string"
        && ("result" in value || "error" in value);
}

function isJsonRpcNotificationMessage(value: unknown): value is JsonRpcNotificationMessage {
    return isRecord(value)
        && typeof value.method === "string"
        && !("id" in value);
}

function extractJsonRpcErrorMessage(value: unknown): string | null {
    if (typeof value === "string" && value.trim()) {
        return value.trim();
    }

    if (!isRecord(value)) {
        return null;
    }

    return firstStringAtPaths(value, [
        ["message"],
        ["error", "message"],
        ["data", "message"],
    ]);
}

function createWorkspaceWriteSandboxPolicy(cwd: string) {
    return {
        type: "workspaceWrite" as const,
        writableRoots: [cwd],
        readOnlyAccess: {
            type: "fullAccess" as const,
        },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
    };
}

function extractAgentMessageText(value: unknown): {
    id: string | null;
    text: string | null;
} | null {
    if (!isRecord(value) || value.type !== "agentMessage") {
        return null;
    }

    return {
        id: typeof value.id === "string" ? value.id : null,
        text: typeof value.text === "string" ? value.text : null,
    };
}

function extractCodexEventContext(value: unknown): {
    threadId: string | null;
    turnId: string | null;
    itemId: string | null;
} {
    if (!isRecord(value)) {
        return {
            threadId: null,
            turnId: null,
            itemId: null,
        };
    }

    return {
        threadId: typeof value.threadId === "string" ? value.threadId : null,
        turnId: typeof value.turnId === "string"
            ? value.turnId
            : firstStringAtPaths(value, [["turn", "id"]]),
        itemId: typeof value.itemId === "string" ? value.itemId : null,
    };
}

function matchesCodexThreadTurnContext(
    activeThreadId: string | null,
    activeTurnId: string | null,
    value: unknown,
): boolean {
    const context = extractCodexEventContext(value);
    return !(
        (activeThreadId && context.threadId && context.threadId !== activeThreadId)
        || (activeTurnId && context.turnId && context.turnId !== activeTurnId)
    );
}

function matchesCodexAgentMessageContext(
    activeThreadId: string | null,
    activeTurnId: string | null,
    activeAgentMessageItemId: string | null,
    value: unknown,
): boolean {
    const context = extractCodexEventContext(value);
    return !(
        (activeThreadId && context.threadId && context.threadId !== activeThreadId)
        || (activeTurnId && context.turnId && context.turnId !== activeTurnId)
        || (activeAgentMessageItemId && context.itemId && context.itemId !== activeAgentMessageItemId)
    );
}

async function runCodexDirect(
    modules: NodeModules,
    invocation: AgentRuntimeInvocation,
): Promise<AgentRuntimeResult> {
    if (invocation.abortSignal?.aborted) {
        throw new AgentRuntimeCancelledError();
    }

    const childProcess = await spawnInteractiveAgentRuntimeProcess(
        modules,
        "codex",
        ["app-server", "--listen", "stdio://"],
        {
            cwd: invocation.cwd,
        },
    );

    return await new Promise<AgentRuntimeResult>((resolve, reject) => {
        let settled = false;
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let requestCounter = 0;
        let activeThreadId: string | null = null;
        let activeTurnId: string | null = null;
        let activeAgentMessageItemId: string | null = null;
        let streamedText = "";
        let finalText: string | null = null;
        const reasoningSummaryBuffers = new Map<string, string>();
        let abortHandler: (() => void) | null = null;
        const pendingResponses = new Map<string, {
            resolve: (value: unknown) => void;
            reject: (error: Error) => void;
        }>();

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
            for (const pending of pendingResponses.values()) {
                pending.reject(error instanceof Error ? error : new Error(String(error)));
            }
            pendingResponses.clear();
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
            for (const pending of pendingResponses.values()) {
                pending.reject(new Error("Codex finished before the pending request resolved."));
            }
            pendingResponses.clear();
            try {
                childProcess.stdin?.end();
            } catch {
                // ignore best-effort shutdown failures
            }
            resolve({
                runtime: "direct-cli",
                replyText,
            });
        };

        const sendMessage = (message: JsonRpcRequestMessage | JsonRpcNotificationMessage) => {
            const stdin = childProcess.stdin;
            if (!stdin) {
                throw new Error("Codex app-server did not expose stdin.");
            }

            stdin.write(`${JSON.stringify(message)}\n`);
        };

        const sendRequest = <T>(method: string, params?: unknown): Promise<T> => {
            const id = `sidenote2-${++requestCounter}`;
            return new Promise<T>((resolveRequest, rejectRequest) => {
                pendingResponses.set(id, {
                    resolve: resolveRequest as (value: unknown) => void,
                    reject: rejectRequest,
                });

                try {
                    sendMessage({
                        id,
                        method,
                        params,
                    });
                } catch (error) {
                    pendingResponses.delete(id);
                    rejectRequest(error instanceof Error ? error : new Error(String(error)));
                }
            });
        };

        const maybeFinalizeFromTurnCompletion = (status: string | null, errorMessage: string | null) => {
            if (!status) {
                return;
            }

            if (status !== "completed") {
                finalizeError(new Error(errorMessage ?? `Codex turn ended with status ${status}.`));
                return;
            }

            const replyText = sanitizeAgentReplyText(finalText ?? streamedText);
            if (!replyText) {
                finalizeError(new Error("Codex returned an empty response."));
                return;
            }

            finalizeSuccess(replyText);
        };

        const handleItemMessage = (item: unknown): void => {
            const agentMessage = extractAgentMessageText(item);
            if (!agentMessage) {
                return;
            }

            if (agentMessage.id) {
                activeAgentMessageItemId = agentMessage.id;
            }
            if (agentMessage.text && agentMessage.text.trim()) {
                finalText = agentMessage.text;
            }
        };

        const handleNotification = (message: JsonRpcNotificationMessage) => {
            const params = message.params;
            switch (message.method) {
                case "error": {
                    const errorMessage = extractJsonRpcErrorMessage(params);
                    finalizeError(new Error(errorMessage ?? "Codex app-server reported an error."));
                    return;
                }
                case "item/started": {
                    if (!matchesCodexThreadTurnContext(activeThreadId, activeTurnId, params)) {
                        return;
                    }

                    const item = isRecord(params) ? params.item : undefined;
                    handleItemMessage(item);
                    const progressText = extractCodexProgressTextFromThreadItem(item);
                    if (progressText) {
                        invocation.onProgressText?.(progressText);
                    }
                    return;
                }
                case "item/agentMessage/delta": {
                    const delta = extractCodexTextDeltaFromJsonEvent(message);
                    if (!delta || !matchesCodexAgentMessageContext(activeThreadId, activeTurnId, activeAgentMessageItemId, params)) {
                        return;
                    }

                    streamedText += delta;
                    invocation.onPartialText?.(sanitizeAgentReplyText(streamedText));
                    return;
                }
                case "item/reasoning/summaryTextDelta": {
                    if (!matchesCodexThreadTurnContext(activeThreadId, activeTurnId, params)) {
                        return;
                    }

                    const delta = extractCodexProgressTextFromJsonEvent(message);
                    if (!delta) {
                        return;
                    }

                    const itemId = firstStringAtPaths(params, [["itemId"]]) ?? "reasoning";
                    const summaryIndexValue = getNestedValue(params, ["summaryIndex"]);
                    const summaryIndex = typeof summaryIndexValue === "string" || typeof summaryIndexValue === "number"
                        ? String(summaryIndexValue)
                        : "0";
                    const bufferKey = `${itemId}:${summaryIndex}`;
                    const nextText = `${reasoningSummaryBuffers.get(bufferKey) ?? ""}${delta}`;
                    reasoningSummaryBuffers.set(bufferKey, nextText);
                    const progressText = normalizeProgressText(nextText);
                    if (progressText) {
                        invocation.onProgressText?.(progressText);
                    }
                    return;
                }
                case "turn/plan/updated": {
                    if (!matchesCodexThreadTurnContext(activeThreadId, activeTurnId, params)) {
                        return;
                    }

                    const progressText = extractCodexProgressTextFromJsonEvent(message);
                    if (progressText) {
                        invocation.onProgressText?.(progressText);
                    }
                    return;
                }
                case "item/completed": {
                    if (!matchesCodexThreadTurnContext(activeThreadId, activeTurnId, params)) {
                        return;
                    }

                    handleItemMessage(isRecord(params) ? params.item : undefined);
                    return;
                }
                case "turn/completed": {
                    if (!matchesCodexThreadTurnContext(activeThreadId, activeTurnId, params)) {
                        return;
                    }

                    maybeFinalizeFromTurnCompletion(
                        firstStringAtPaths(params, [["turn", "status"]]),
                        extractJsonRpcErrorMessage(getNestedValue(params, ["turn", "error"])),
                    );
                    return;
                }
                default:
                    return;
            }
        };

        const handleStdoutMessage = (message: unknown) => {
            if (isJsonRpcResponseMessage(message)) {
                const pending = pendingResponses.get(message.id);
                if (!pending) {
                    return;
                }

                pendingResponses.delete(message.id);
                if ("error" in message && message.error !== undefined) {
                    pending.reject(new Error(extractJsonRpcErrorMessage(message.error) ?? "Codex request failed."));
                    return;
                }

                pending.resolve(message.result);
                return;
            }

            if (isJsonRpcNotificationMessage(message)) {
                handleNotification(message);
            }
        };

        const flushStdoutBuffer = () => {
            if (!stdoutBuffer.trim()) {
                stdoutBuffer = "";
                return;
            }

            const parsed = parseJsonLine(stdoutBuffer);
            stdoutBuffer = "";
            if (parsed !== null) {
                handleStdoutMessage(parsed);
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
                    handleStdoutMessage(parsed);
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

            const stderrMessage = stderrBuffer.trim();
            finalizeError(new Error(
                stderrMessage || `spawn codex exited with code ${code ?? "null"}${signal ? ` signal ${signal}` : ""}`,
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

        void (async () => {
            try {
                await sendRequest("initialize", {
                    clientInfo: {
                        name: "sidenote2",
                        title: "SideNote2",
                        version: "0.0.0",
                    },
                    capabilities: {
                        experimentalApi: true,
                        optOutNotificationMethods: [
                            "account/rateLimits/updated",
                            "command/exec/outputDelta",
                            "item/commandExecution/outputDelta",
                            "item/commandExecution/terminalInteraction",
                            "item/fileChange/outputDelta",
                            "item/plan/delta",
                            "item/reasoning/summaryPartAdded",
                            "item/reasoning/textDelta",
                            "mcpServer/startupStatus/updated",
                            "thread/started",
                            "thread/status/changed",
                            "thread/tokenUsage/updated",
                            "turn/diff/updated",
                        ],
                    },
                });
                sendMessage({
                    method: "initialized",
                });

                const threadStartResponse = await sendRequest<{ thread?: { id?: string } }>("thread/start", {
                    approvalPolicy: "on-request",
                    baseInstructions: "You generate end-user reply text for a SideNote2 note thread.",
                    cwd: invocation.cwd,
                    developerInstructions: "Return only the final note reply. Answer directly. Never mention skills, searches, notes, files, prompts, tools, AGENTS instructions, context-loading, or your process.",
                    ephemeral: true,
                    personality: "none",
                    sandbox: "workspace-write",
                });
                activeThreadId = typeof threadStartResponse?.thread?.id === "string"
                    ? threadStartResponse.thread.id
                    : null;
                if (!activeThreadId) {
                    throw new Error("Codex did not return a thread id.");
                }

                const turnStartResponse = await sendRequest<{ turn?: { id?: string } }>("turn/start", {
                    approvalPolicy: "on-request",
                    cwd: invocation.cwd,
                    input: [
                        {
                            type: "text",
                            text: buildSideNotePrompt(invocation.prompt),
                            text_elements: [],
                        },
                    ],
                    personality: "none",
                    sandboxPolicy: createWorkspaceWriteSandboxPolicy(invocation.cwd),
                    threadId: activeThreadId,
                });
                activeTurnId = typeof turnStartResponse?.turn?.id === "string"
                    ? turnStartResponse.turn.id
                    : null;
                if (!activeTurnId) {
                    throw new Error("Codex did not return a turn id.");
                }
            } catch (error) {
                finalizeError(error);
            }
        })();
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
        case "codex-app-server":
            return runCodexDirect(modules, invocation);
        default:
            throw new Error(`${actor.label} does not have an executable runtime strategy.`);
    }
}

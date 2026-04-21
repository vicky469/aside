import { randomUUID } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir as getOsHomeDir } from "node:os";
import path from "node:path";
import process from "node:process";
import { execFile, spawn } from "node:child_process";

function parseEnvText(text) {
    const env = {};
    for (const rawLine of text.split(/\r?\n/u)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) {
            continue;
        }

        const separatorIndex = line.indexOf("=");
        if (separatorIndex <= 0) {
            continue;
        }

        const key = line.slice(0, separatorIndex).trim();
        let value = line.slice(separatorIndex + 1).trim();
        if (
            (value.startsWith("\"") && value.endsWith("\""))
            || (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        env[key] = value.replace(/\\n/g, "\n");
    }

    return env;
}

export function loadEnvFile(filePath = path.join(process.cwd(), ".env")) {
    if (!existsSync(filePath)) {
        return {};
    }

    return parseEnvText(readFileSync(filePath, "utf8"));
}

function parseBoolean(value, fallback) {
    if (typeof value !== "string" || !value.trim()) {
        return fallback;
    }

    switch (value.trim().toLowerCase()) {
        case "1":
        case "true":
        case "yes":
        case "on":
            return true;
        case "0":
        case "false":
        case "no":
        case "off":
            return false;
        default:
            return fallback;
    }
}

function parseInteger(value, fallback) {
    if (typeof value !== "string" || !value.trim()) {
        return fallback;
    }

    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveOptionalPath(value, rootDir) {
    if (typeof value !== "string" || !value.trim()) {
        return null;
    }

    return path.resolve(rootDir, value.trim());
}

function assertExistingFile(filePath, label) {
    if (!existsSync(filePath)) {
        throw new Error(`${label} was not found: ${filePath}`);
    }
}

export function getBridgeTransportProtocol(config) {
    return config.tlsEnabled
        ? "https"
        : "http";
}

export function getBridgeDefaultBaseUrl(config) {
    return `${getBridgeTransportProtocol(config)}://${config.bindHost}:${config.port}`;
}

export function createBridgeConfig(options = {}) {
    const env = options.env ?? process.env;
    const rootDir = options.rootDir ?? process.cwd();
    const workspaceRootInput = typeof env.SIDENOTE2_DGX_WORKSPACE_ROOT === "string" && env.SIDENOTE2_DGX_WORKSPACE_ROOT.trim()
        ? env.SIDENOTE2_DGX_WORKSPACE_ROOT.trim()
        : ".dgx-workspace";
    const bridgeBearerToken = typeof env.SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN === "string"
        ? env.SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN.trim()
        : "";
    if (!bridgeBearerToken) {
        throw new Error("SIDENOTE2_DGX_BRIDGE_BEARER_TOKEN is required.");
    }

    const tlsKeyPath = resolveOptionalPath(env.SIDENOTE2_DGX_TLS_KEY_FILE, rootDir);
    const tlsCertPath = resolveOptionalPath(env.SIDENOTE2_DGX_TLS_CERT_FILE, rootDir);
    const tlsCaPath = resolveOptionalPath(env.SIDENOTE2_DGX_TLS_CA_FILE, rootDir);
    if ((tlsKeyPath && !tlsCertPath) || (!tlsKeyPath && tlsCertPath)) {
        throw new Error("SIDENOTE2_DGX_TLS_KEY_FILE and SIDENOTE2_DGX_TLS_CERT_FILE must be configured together.");
    }
    if (tlsKeyPath) {
        assertExistingFile(tlsKeyPath, "SIDENOTE2_DGX_TLS_KEY_FILE");
        assertExistingFile(tlsCertPath, "SIDENOTE2_DGX_TLS_CERT_FILE");
    }
    if (tlsCaPath) {
        assertExistingFile(tlsCaPath, "SIDENOTE2_DGX_TLS_CA_FILE");
    }

    return {
        bindHost: typeof env.SIDENOTE2_DGX_BIND_HOST === "string" && env.SIDENOTE2_DGX_BIND_HOST.trim()
            ? env.SIDENOTE2_DGX_BIND_HOST.trim()
            : "127.0.0.1",
        port: parseInteger(env.SIDENOTE2_DGX_PORT, 4215),
        publicBaseUrl: typeof env.SIDENOTE2_DGX_PUBLIC_BASE_URL === "string" && env.SIDENOTE2_DGX_PUBLIC_BASE_URL.trim()
            ? env.SIDENOTE2_DGX_PUBLIC_BASE_URL.trim()
            : null,
        tlsEnabled: !!(tlsKeyPath && tlsCertPath),
        tlsKeyPath,
        tlsCertPath,
        tlsCaPath,
        workspaceRoot: path.resolve(rootDir, workspaceRootInput),
        bridgeBearerToken,
        freeAllowanceEnabled: parseBoolean(env.SIDENOTE2_DGX_FREE_ALLOWANCE_ENABLED, false),
        freeAllowanceRunsPerDay: parseInteger(env.SIDENOTE2_DGX_FREE_ALLOWANCE_RUNS_PER_DAY, 0),
        codexBin: typeof env.SIDENOTE2_DGX_CODEX_BIN === "string" && env.SIDENOTE2_DGX_CODEX_BIN.trim()
            ? env.SIDENOTE2_DGX_CODEX_BIN.trim()
            : "codex",
        retentionMs: parseInteger(env.SIDENOTE2_DGX_RUN_RETENTION_MS, 15 * 60 * 1000),
        requestBodyLimitBytes: parseInteger(env.SIDENOTE2_DGX_REQUEST_BODY_LIMIT_BYTES, 512 * 1024),
        rootDir,
    };
}

function buildSideNotePrompt(promptText) {
    return [
        "You are responding to a SideNote2 thread in Obsidian.",
        "Answer the user's request directly.",
        "Only inspect or modify workspace files when the request actually needs that context.",
        "If the request asks for file changes, make them directly in the workspace before replying.",
        "Return only the reply text that should be appended back into the SideNote2 thread.",
        "Keep the side-note reply compact and easy to scan.",
        "Use plain paragraphs or one simple list; avoid headings, long multi-section layouts, and excess blank lines.",
        "Keep the reply at or under 250 words.",
        "If you include a diagram in a side note, render it as a compact ASCII diagram that fits comfortably in the sidebar.",
        "Do not use Mermaid or other large diagram syntax in side-note replies.",
        "If the best useful answer would exceed 250 words, create or update a short linked wiki note with the full detail and return a concise side note that points to it.",
        "Do not mention skills, prompts, searches, files, tools, AGENTS instructions, or your process.",
        "Do not narrate what you are doing.",
        "Do not include thinking steps or tool logs.",
        "Do not mention reading notes, locating threads, loading context, or using the workspace.",
        "",
        promptText,
    ].join("\n");
}

function normalizeNarrationSegment(value) {
    return value
        .replace(/[’]/g, "'")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

function isLikelyProcessNarrationSegment(value) {
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

function findLeadingSegmentBoundary(value) {
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

export function sanitizeAgentReplyText(value) {
    let remaining = String(value ?? "").trimStart();

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

function isRecord(value) {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function getNestedValue(value, pathParts) {
    let current = value;
    for (const part of pathParts) {
        if (!isRecord(current)) {
            return undefined;
        }
        current = current[part];
    }

    return current;
}

function firstStringAtPaths(value, paths) {
    for (const candidatePath of paths) {
        const candidate = getNestedValue(value, candidatePath);
        if (typeof candidate === "string" && candidate.length > 0) {
            return candidate;
        }
    }

    return null;
}

function joinTextContentItems(value) {
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
        .filter((fragment) => typeof fragment === "string" && fragment.length > 0);

    return fragments.length ? fragments.join("") : null;
}

function parseJsonLine(line) {
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

function extractCodexTextDeltaFromJsonEvent(event) {
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

function normalizeProgressText(value) {
    const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
    if (!normalized) {
        return null;
    }

    if (normalized.length <= 140) {
        return normalized;
    }

    return `${normalized.slice(0, 137).trimEnd()}...`;
}

function extractPlanProgressText(params) {
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

function extractCodexProgressTextFromJsonEvent(event) {
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

function extractCodexProgressTextFromThreadItem(item) {
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

function extractJsonRpcErrorMessage(value) {
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

function createWorkspaceWriteSandboxPolicy(cwd) {
    return {
        type: "workspaceWrite",
        writableRoots: [cwd],
        readOnlyAccess: {
            type: "fullAccess",
        },
        networkAccess: false,
        excludeTmpdirEnvVar: false,
        excludeSlashTmp: false,
    };
}

function extractAgentMessageText(value) {
    if (!isRecord(value) || value.type !== "agentMessage") {
        return null;
    }

    return {
        id: typeof value.id === "string" ? value.id : null,
        text: typeof value.text === "string" ? value.text : null,
    };
}

function extractCodexEventContext(value) {
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

function matchesCodexThreadTurnContext(activeThreadId, activeTurnId, value) {
    const context = extractCodexEventContext(value);
    return !(
        (activeThreadId && context.threadId && context.threadId !== activeThreadId)
        || (activeTurnId && context.turnId && context.turnId !== activeTurnId)
    );
}

function matchesCodexAgentMessageContext(activeThreadId, activeTurnId, activeAgentMessageItemId, value) {
    const context = extractCodexEventContext(value);
    return !(
        (activeThreadId && context.threadId && context.threadId !== activeThreadId)
        || (activeTurnId && context.turnId && context.turnId !== activeTurnId)
        || (activeAgentMessageItemId && context.itemId && context.itemId !== activeAgentMessageItemId)
    );
}

function isJsonRpcResponseMessage(value) {
    return isRecord(value)
        && typeof value.id === "string"
        && ("result" in value || "error" in value);
}

function isJsonRpcNotificationMessage(value) {
    return isRecord(value)
        && typeof value.method === "string"
        && !("id" in value);
}

export function getBaseProcessEnv(baseEnv = process.env) {
    const homeDir = typeof baseEnv.HOME === "string" && baseEnv.HOME.trim()
        ? baseEnv.HOME.trim()
        : getOsHomeDir();
    return {
        ...baseEnv,
        ...(homeDir ? { HOME: homeDir } : {}),
    };
}

function getShellCandidates(baseEnv) {
    const shells = [baseEnv.SHELL, "/bin/zsh", "/bin/bash", "/bin/sh"];
    const candidates = [];
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

function extractLastNonEmptyLine(value) {
    const lines = String(value ?? "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter(Boolean);
    return lines.at(-1) ?? "";
}

function execFileAsync(file, args, options) {
    return new Promise((resolve, reject) => {
        const childProcess = execFile(
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

let resolvedExecEnvPromise = null;

async function resolveExecutionEnv(baseEnv = getBaseProcessEnv()) {
    if (resolvedExecEnvPromise) {
        return resolvedExecEnvPromise;
    }

    resolvedExecEnvPromise = (async () => {
        for (const shell of getShellCandidates(baseEnv)) {
            try {
                const result = await execFileAsync(
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

    return resolvedExecEnvPromise;
}

export class BridgeRunCancelledError extends Error {
    constructor(message = "Agent execution cancelled.") {
        super(message);
        this.name = "BridgeRunCancelledError";
    }
}

function summarizeError(error) {
    if (error instanceof Error && error.message.trim()) {
        return error.message.trim();
    }

    return "Remote runtime failed.";
}

export async function runCodexAppServer(options) {
    if (options.signal?.aborted) {
        throw new BridgeRunCancelledError();
    }

    const resolvedEnv = await resolveExecutionEnv({
        ...getBaseProcessEnv(),
        ...(options.env ?? {}),
    });
    const childProcess = spawn(
        options.codexBin ?? "codex",
        ["app-server", "--listen", "stdio://"],
        {
            cwd: options.cwd,
            env: resolvedEnv,
            stdio: ["pipe", "pipe", "pipe"],
        },
    );

    return await new Promise((resolve, reject) => {
        let settled = false;
        let stdoutBuffer = "";
        let stderrBuffer = "";
        let requestCounter = 0;
        let activeThreadId = null;
        let activeTurnId = null;
        let activeAgentMessageItemId = null;
        let streamedText = "";
        let finalText = null;
        const reasoningSummaryBuffers = new Map();
        let abortHandler = null;
        const pendingResponses = new Map();

        const cleanup = () => {
            if (options.signal && abortHandler) {
                options.signal.removeEventListener("abort", abortHandler);
                abortHandler = null;
            }
        };

        const finalizeError = (error) => {
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

        const finalizeSuccess = (replyText) => {
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
                replyText,
            });
        };

        const sendMessage = (message) => {
            const stdin = childProcess.stdin;
            if (!stdin) {
                throw new Error("Codex app-server did not expose stdin.");
            }

            stdin.write(`${JSON.stringify(message)}\n`);
        };

        const sendRequest = (method, params) => {
            const id = `sidenote2-bridge-${++requestCounter}`;
            return new Promise((resolveRequest, rejectRequest) => {
                pendingResponses.set(id, {
                    resolve: resolveRequest,
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

        const maybeFinalizeFromTurnCompletion = (status, errorMessage) => {
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

        const handleItemMessage = (item) => {
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

        const handleNotification = (message) => {
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
                        options.onProgressText?.(progressText);
                    }
                    return;
                }
                case "item/agentMessage/delta": {
                    const delta = extractCodexTextDeltaFromJsonEvent(message);
                    if (!delta || !matchesCodexAgentMessageContext(activeThreadId, activeTurnId, activeAgentMessageItemId, params)) {
                        return;
                    }

                    streamedText += delta;
                    options.onOutputDelta?.(delta);
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
                        options.onProgressText?.(progressText);
                    }
                    return;
                }
                case "turn/plan/updated": {
                    if (!matchesCodexThreadTurnContext(activeThreadId, activeTurnId, params)) {
                        return;
                    }

                    const progressText = extractCodexProgressTextFromJsonEvent(message);
                    if (progressText) {
                        options.onProgressText?.(progressText);
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

        const handleStdoutMessage = (message) => {
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

            if (options.signal?.aborted) {
                finalizeError(new BridgeRunCancelledError());
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

        if (options.signal) {
            abortHandler = () => {
                finalizeError(new BridgeRunCancelledError());
            };
            options.signal.addEventListener("abort", abortHandler, { once: true });
            if (options.signal.aborted) {
                abortHandler();
                return;
            }
        }

        void (async () => {
            try {
                await sendRequest("initialize", {
                    clientInfo: {
                        name: "sidenote2-dgx-bridge",
                        title: "SideNote2 DGX Bridge",
                        version: options.clientVersion ?? "0.0.0",
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

                const threadStartResponse = await sendRequest("thread/start", {
                    approvalPolicy: "on-request",
                    baseInstructions: "You generate end-user reply text for a SideNote2 note thread.",
                    cwd: options.cwd,
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

                const turnStartResponse = await sendRequest("turn/start", {
                    approvalPolicy: "on-request",
                    cwd: options.cwd,
                    input: [
                        {
                            type: "text",
                            text: buildSideNotePrompt(options.promptText),
                            text_elements: [],
                        },
                    ],
                    personality: "none",
                    sandboxPolicy: createWorkspaceWriteSandboxPolicy(options.cwd),
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

function utcDayKey(nowValue) {
    return new Date(nowValue).toISOString().slice(0, 10);
}

function defaultLog(level, message, payload) {
    const parts = [`[sidenote2-dgx-bridge]`, level.toUpperCase(), message];
    if (payload && Object.keys(payload).length > 0) {
        parts.push(JSON.stringify(payload));
    }
    console.log(parts.join(" "));
}

function resolveEventSliceStartIndex(run, afterCursor = null) {
    const allEvents = run.events ?? [];
    return !afterCursor
        ? 0
        : (() => {
            const index = allEvents.findIndex((event) => event.cursor === afterCursor);
            return index === -1 ? 0 : index + 1;
        })();
}

function buildEnvelope(run, afterCursor = null) {
    const allEvents = run.events ?? [];
    const startIndex = resolveEventSliceStartIndex(run, afterCursor);

    return {
        status: run.status,
        cursor: run.lastCursor ?? null,
        runId: run.runId ?? null,
        events: allEvents.slice(startIndex).map((event) => event.payload),
        replyText: run.replyText ?? null,
        error: run.error ?? null,
    };
}

function hasEventsAfterCursor(run, afterCursor = null) {
    const allEvents = run.events ?? [];
    const startIndex = resolveEventSliceStartIndex(run, afterCursor);
    return startIndex < allEvents.length;
}

function notifyRunWaiters(run) {
    const waiters = Array.from(run.waiters ?? []);
    run.waiters?.clear();
    for (const waiter of waiters) {
        waiter();
    }
}

async function waitForRunUpdate(run, waitMs) {
    await new Promise((resolve) => {
        const timeoutId = setTimeout(() => {
            run.waiters?.delete(onSettled);
            resolve(undefined);
        }, waitMs);
        const onSettled = () => {
            clearTimeout(timeoutId);
            run.waiters?.delete(onSettled);
            resolve(undefined);
        };
        run.waiters?.add(onSettled);
    });
}

async function readJsonBody(request, maxBytes) {
    const chunks = [];
    let totalBytes = 0;
    for await (const chunk of request) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        totalBytes += buffer.length;
        if (totalBytes > maxBytes) {
            throw new Error(`Request body exceeds ${maxBytes} bytes.`);
        }
        chunks.push(buffer);
    }

    const rawBody = Buffer.concat(chunks).toString("utf8").trim();
    if (!rawBody) {
        return {};
    }

    try {
        return JSON.parse(rawBody);
    } catch {
        throw new Error("Request body must be valid JSON.");
    }
}

function sendJson(response, statusCode, payload, options = {}) {
    const omitBody = options.omitBody === true;
    const serializedPayload = JSON.stringify(payload);
    response.statusCode = statusCode;
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    response.setHeader("Access-Control-Max-Age", "600");
    response.setHeader("Content-Type", "application/json; charset=utf-8");
    response.setHeader("Content-Length", Buffer.byteLength(serializedPayload));
    response.end(omitBody ? undefined : serializedPayload);
}

function extractBearerToken(request) {
    const headerValue = request.headers.authorization;
    if (typeof headerValue !== "string") {
        return null;
    }

    const match = headerValue.match(/^Bearer\s+(.+)$/iu);
    return match?.[1]?.trim() ?? null;
}

function createFailedEnvelope(error, runId = null) {
    return {
        status: "failed",
        cursor: null,
        runId,
        events: [],
        replyText: null,
        error,
    };
}

export function createDgxRuntimeBridge(options) {
    const config = options.config;
    const executeRun = options.executeRun ?? runCodexAppServer;
    const now = options.now ?? (() => Date.now());
    const createId = options.createId ?? (() => randomUUID());
    const log = options.log ?? defaultLog;
    const runs = new Map();
    const allowanceBuckets = new Map();
    const maxPollWaitMs = 2_000;

    const recordRunStartAllowance = (identity) => {
        if (!config.freeAllowanceEnabled) {
            return { allowed: true, remaining: null };
        }

        const dailyLimit = Math.max(config.freeAllowanceRunsPerDay, 0);
        if (dailyLimit <= 0) {
            return {
                allowed: false,
                remaining: 0,
            };
        }

        const dayKey = utcDayKey(now());
        // TODO(dgx-allowance-identity): restore configurable allowance identity modes
        // if we later support per-user or per-account quotas. For now allowance is
        // always keyed to the bridge bearer token.
        const bucketKey = `bridge_token:${identity}:${dayKey}`;
        const usedCount = allowanceBuckets.get(bucketKey) ?? 0;
        if (usedCount >= dailyLimit) {
            return {
                allowed: false,
                remaining: 0,
            };
        }

        allowanceBuckets.set(bucketKey, usedCount + 1);
        return {
            allowed: true,
            remaining: dailyLimit - usedCount - 1,
        };
    };

    const appendEvent = (run, payload) => {
        const nextCursorId = `evt-${++run.nextCursorId}`;
        run.lastCursor = nextCursorId;
        run.updatedAt = now();
        run.events.push({
            cursor: nextCursorId,
            payload,
        });
        notifyRunWaiters(run);
    };

    const finalizeRun = (run, status, payload) => {
        if (run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
            return;
        }

        run.status = status;
        run.updatedAt = now();
        run.endedAt = run.updatedAt;
        if (status === "completed") {
            run.replyText = payload.replyText;
            appendEvent(run, {
                type: "completed",
                replyText: payload.replyText,
            });
            return;
        }

        if (status === "cancelled") {
            run.error = payload.message ?? "Cancelled.";
            appendEvent(run, {
                type: "cancelled",
                ...(payload.message ? { message: payload.message } : {}),
            });
            return;
        }

        run.error = payload.error;
        appendEvent(run, {
            type: "failed",
            error: payload.error,
        });
    };

    const startRunExecution = async (run) => {
        try {
            run.status = "running";
            appendEvent(run, {
                type: "progress",
                text: "Starting Codex",
            });

            const result = await executeRun({
                codexBin: config.codexBin,
                promptText: run.promptText,
                metadata: run.metadata,
                cwd: config.workspaceRoot,
                signal: run.abortController.signal,
                clientVersion: typeof run.metadata?.pluginVersion === "string"
                    ? run.metadata.pluginVersion
                    : "0.0.0",
                onProgressText: (text) => {
                    const normalizedText = normalizeProgressText(text);
                    if (!normalizedText || run.status === "cancelled") {
                        return;
                    }

                    appendEvent(run, {
                        type: "progress",
                        text: normalizedText,
                    });
                },
                onOutputDelta: (text) => {
                    if (!text || run.status === "cancelled") {
                        return;
                    }

                    appendEvent(run, {
                        type: "output_delta",
                        text,
                    });
                },
            });

            if (run.status === "cancelled") {
                return;
            }

            const replyText = sanitizeAgentReplyText(result.replyText ?? "");
            if (!replyText) {
                throw new Error("Codex returned an empty response.");
            }

            finalizeRun(run, "completed", { replyText });
        } catch (error) {
            if (run.status === "cancelled" || run.abortController.signal.aborted || error instanceof BridgeRunCancelledError) {
                finalizeRun(run, "cancelled", { message: "Cancelled." });
                return;
            }

            finalizeRun(run, "failed", {
                error: summarizeError(error),
            });
        }
    };

    const pruneTerminalRuns = () => {
        const cutoff = now() - config.retentionMs;
        for (const [runId, run] of runs.entries()) {
            if ((run.status === "completed" || run.status === "failed" || run.status === "cancelled")
                && (run.endedAt ?? run.updatedAt) < cutoff) {
                runs.delete(runId);
            }
        }
    };

    const pruneTimer = setInterval(pruneTerminalRuns, 60_000);
    pruneTimer.unref?.();

    const requestHandler = async (request, response) => {
        const method = request.method ?? "GET";
        const requestUrl = new URL(request.url ?? "/", `${getBridgeTransportProtocol(config)}://${request.headers.host ?? "127.0.0.1"}`);

        if (method === "OPTIONS") {
            response.statusCode = 204;
            response.setHeader("Access-Control-Allow-Origin", "*");
            response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS");
            response.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
            response.setHeader("Access-Control-Max-Age", "600");
            response.end();
            return;
        }

        if ((method === "GET" || method === "HEAD") && requestUrl.pathname === "/healthz") {
            sendJson(response, 200, {
                ok: true,
                status: "available",
                listenProtocol: getBridgeTransportProtocol(config),
                bindHost: config.bindHost,
                port: config.port,
                publicBaseUrl: config.publicBaseUrl,
            }, { omitBody: method === "HEAD" });
            return;
        }

        const bearerToken = extractBearerToken(request);
        if (bearerToken !== config.bridgeBearerToken) {
            sendJson(response, 401, createFailedEnvelope("Remote runtime authentication failed."));
            return;
        }

        if (method === "POST" && requestUrl.pathname === "/v1/sidenote2/runs") {
            let payload;
            try {
                payload = await readJsonBody(request, config.requestBodyLimitBytes);
            } catch (error) {
                sendJson(response, 400, createFailedEnvelope(summarizeError(error)));
                return;
            }

            const agent = typeof payload.agent === "string" ? payload.agent.trim() : "";
            const promptText = typeof payload.promptText === "string" ? payload.promptText : "";
            const metadata = isRecord(payload.metadata) ? payload.metadata : {};
            const runId = createId();

            if (agent !== "codex") {
                sendJson(response, 400, createFailedEnvelope("Only agent=codex is supported by this bridge.", runId));
                return;
            }

            if (!promptText.trim()) {
                sendJson(response, 400, createFailedEnvelope("promptText is required.", runId));
                return;
            }

            const allowance = recordRunStartAllowance(bearerToken);
            if (!allowance.allowed) {
                sendJson(response, 429, {
                    ...createFailedEnvelope("Remote runtime free allowance is exhausted for today.", runId),
                    runId,
                });
                return;
            }

            try {
                await mkdir(config.workspaceRoot, { recursive: true });
            } catch (error) {
                sendJson(response, 500, createFailedEnvelope(`Unable to prepare runtime workspace: ${summarizeError(error)}`, runId));
                return;
            }

            const run = {
                runId,
                status: "queued",
                promptText,
                metadata,
                replyText: null,
                error: null,
                createdAt: now(),
                updatedAt: now(),
                endedAt: null,
                events: [],
                lastCursor: null,
                nextCursorId: 0,
                waiters: new Set(),
                abortController: new AbortController(),
            };
            runs.set(runId, run);
            void startRunExecution(run);

            log("info", "run.started", {
                runId,
                capability: typeof metadata.capability === "string" ? metadata.capability : null,
                remainingAllowance: allowance.remaining,
            });

            sendJson(response, 200, buildEnvelope(run));
            return;
        }

        const runPathMatch = requestUrl.pathname.match(/^\/v1\/sidenote2\/runs\/([^/]+)(?:\/cancel)?$/u);
        const runId = runPathMatch?.[1] ? decodeURIComponent(runPathMatch[1]) : null;
        const run = runId ? runs.get(runId) ?? null : null;

        if (method === "GET" && run && requestUrl.pathname === `/v1/sidenote2/runs/${encodeURIComponent(runId)}`) {
            const afterCursor = requestUrl.searchParams.get("after");
            const requestedWaitMs = Math.max(0, Math.min(
                parseInteger(requestUrl.searchParams.get("waitMs"), 0),
                maxPollWaitMs,
            ));
            if (requestedWaitMs > 0
                && (run.status === "queued" || run.status === "running")
                && !hasEventsAfterCursor(run, afterCursor)) {
                await waitForRunUpdate(run, requestedWaitMs);
            }
            sendJson(response, 200, buildEnvelope(run, afterCursor));
            return;
        }

        if (method === "POST" && run && requestUrl.pathname === `/v1/sidenote2/runs/${encodeURIComponent(runId)}/cancel`) {
            if (!(run.status === "completed" || run.status === "failed" || run.status === "cancelled")) {
                run.abortController.abort();
                finalizeRun(run, "cancelled", { message: "Cancelled." });
                log("info", "run.cancelled", { runId });
            }

            const statusCode = run.status === "cancelled" ? 202 : 200;
            sendJson(response, statusCode, buildEnvelope(run));
            return;
        }

        if (runId && !run) {
            sendJson(response, 404, createFailedEnvelope("Run was not found."));
            return;
        }

        sendJson(response, 404, createFailedEnvelope("Endpoint not found."));
    };
    const server = config.tlsEnabled
        ? createHttpsServer({
            key: readFileSync(config.tlsKeyPath, "utf8"),
            cert: readFileSync(config.tlsCertPath, "utf8"),
            ...(config.tlsCaPath ? { ca: readFileSync(config.tlsCaPath, "utf8") } : {}),
        }, requestHandler)
        : createHttpServer(requestHandler);

    return {
        config,
        runs,
        server,
        async close() {
            clearInterval(pruneTimer);
            for (const run of runs.values()) {
                if (!(run.status === "completed" || run.status === "failed" || run.status === "cancelled")) {
                    run.abortController.abort();
                }
            }

            await new Promise((resolve, reject) => {
                server.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }
                    resolve(undefined);
                });
            });
        },
    };
}

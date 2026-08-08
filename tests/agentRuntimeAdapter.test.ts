import * as assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import type { AgentRunMetadata } from "../src/core/agents/agentRuns";
import {
    buildCodexCliArgs,
    buildClaudeCliArgs,
    buildGeminiCliArgs,
    extractClaudeProgressTextFromJsonEvent,
    extractClaudeReplyTextFromJsonEvent,
    extractClaudeRunMetadataFromJsonEvent,
    extractClaudeTextDeltaFromJsonEvent,
    extractCodexProgressTextDeltaFromJsonEvent,
    buildSideNotePrompt,
    createWorkspaceWriteSandboxPolicy,
    extractCodexErrorTextFromJsonEvent,
    extractCodexProgressTextFromJsonEvent,
    extractCodexRunMetadataFromThreadItem,
    extractCodexTextDeltaFromJsonEvent,
    extractGeminiErrorTextFromJsonEvent,
    extractGeminiProgressTextFromJsonEvent,
    extractGeminiResultStatusFromJsonEvent,
    extractGeminiRunMetadataFromJsonEvent,
    extractGeminiTextDeltaFromJsonEvent,
    getClaudeRuntimeDiagnostics,
    getCodexRuntimeDiagnostics,
    getGeminiRuntimeDiagnostics,
    resetResolvedAgentExecutionEnvForTests,
    resolveAgentExecutionEnv,
    runAgentRuntimeWithModules,
    sanitizeAgentReplyText,
} from "../src/agents/agentRuntimeAdapter";

type RuntimeModules = Parameters<typeof resolveAgentExecutionEnv>[0];

function createTrackedProcessStub() {
    return {
        stdin: {
            write() {
                return true;
            },
            end() {},
        },
        stdout: null,
        stderr: null,
        on() {},
        kill() {
            return true;
        },
    };
}

function createRuntimeModules(
    execFileImpl: RuntimeModules["childProcess"]["execFile"],
): RuntimeModules {
    return {
        childProcess: {
            execFile: execFileImpl,
            spawn() {
                throw new Error("not used");
            },
        },
        fsPromises: {
            async mkdtemp() {
                throw new Error("not used");
            },
            async readFile() {
                throw new Error("not used");
            },
            async rm() {
                throw new Error("not used");
            },
        },
        os: {
            tmpdir: () => "/tmp",
        },
        path: {
            join: (...parts: string[]) => parts.join("/"),
        },
    };
}

class RuntimeStreamStub extends EventEmitter {
    emitText(value: string): void {
        this.emit("data", Buffer.from(value));
    }
}

class RuntimeProcessStub extends EventEmitter {
    readonly stdout = new RuntimeStreamStub();
    readonly stderr = new RuntimeStreamStub();
    readonly stdinChunks: string[] = [];
    ended = false;
    killedWith: string | number | undefined;
    readonly stdin: {
        write: (chunk: string | Uint8Array) => boolean;
        end: () => void;
    } | null;

    constructor(options: { withStdin?: boolean } = {}) {
        super();
        this.stdin = options.withStdin === false ? null : {
            write: (chunk: string | Uint8Array) => {
                this.stdinChunks.push(String(chunk));
                return true;
            },
            end: () => {
                this.ended = true;
            },
        };
    }

    kill(signal?: string | number): boolean {
        this.killedWith = signal;
        return true;
    }
}

function createGeminiRuntimeHarness(options: {
    child?: RuntimeProcessStub;
    spawnError?: Error;
} = {}) {
    resetResolvedAgentExecutionEnvForTests();
    const child = options.child ?? new RuntimeProcessStub();
    let resolveSpawned!: (value: RuntimeProcessStub) => void;
    const spawned = new Promise<RuntimeProcessStub>((resolve) => {
        resolveSpawned = resolve;
    });
    const spawnCalls: Array<{ file: string; args: string[]; cwd?: string }> = [];
    const modules = createRuntimeModules((_file, _args, _execOptions, callback) => {
        callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
        return createTrackedProcessStub();
    });
    modules.childProcess.spawn = (file, args, spawnOptions) => {
        if (options.spawnError) {
            throw options.spawnError;
        }
        spawnCalls.push({ file, args, cwd: spawnOptions.cwd });
        queueMicrotask(() => resolveSpawned(child));
        return child;
    };
    return { child, modules, spawned, spawnCalls };
}

const GEMINI_TEST_INVOCATION = {
    target: "gemini" as const,
    prompt: "@gemini review this",
    cwd: "/vault/project",
    vaultRootPath: "/vault",
};

test("resolveAgentExecutionEnv prefers PATH from a login shell", async () => {
    resetResolvedAgentExecutionEnvForTests();

    let invoked = 0;
    const modules = createRuntimeModules((file, args, options, callback) => {
        invoked += 1;
        assert.equal(file, "/bin/zsh");
        assert.deepEqual(args, ["-lic", "printf '%s\\n' \"$PATH\""]);
        assert.equal(options.cwd, "/Users/test");
        callback(null, "shell banner\n/Users/test/.nvm/bin:/usr/bin\n", "");
        return createTrackedProcessStub();
    });

    const env = await resolveAgentExecutionEnv(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.equal(invoked, 1);
    assert.equal(env.PATH, "/Users/test/.nvm/bin:/usr/bin");
});

test("resolveAgentExecutionEnv falls back to the current environment when shell lookup fails", async () => {
    resetResolvedAgentExecutionEnvForTests();

    const modules = createRuntimeModules((file, _args, _options, callback) => {
        callback(Object.assign(new Error(`missing ${file}`), { code: "ENOENT" }), "", "");
        return createTrackedProcessStub();
    });

    const env = await resolveAgentExecutionEnv(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.deepEqual(env, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });
});

test("getCodexRuntimeDiagnostics reports Codex as available when the process can be launched", async () => {
    resetResolvedAgentExecutionEnvForTests();

    let helpChecked = false;
    const modules = createRuntimeModules((file, args, options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }

        helpChecked = true;
        assert.equal(file, "codex");
        assert.deepEqual(args, ["--help"]);
        assert.equal(options.cwd, "/Users/test");
        assert.equal(options.env?.PATH, "/Users/test/.nvm/bin:/usr/bin");
        callback(null, "codex help", "");
        return createTrackedProcessStub();
    });

    const diagnostics = await getCodexRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.equal(helpChecked, true);
    assert.deepEqual(diagnostics, {
        status: "available",
        message: "Codex is available.",
    });
});

test("getCodexRuntimeDiagnostics reports a missing codex binary clearly", async () => {
    resetResolvedAgentExecutionEnvForTests();

    const modules = createRuntimeModules((file, _args, _options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }

        callback(Object.assign(new Error("missing codex"), { code: "ENOENT" }), "", "");
        return createTrackedProcessStub();
    });

    const diagnostics = await getCodexRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.deepEqual(diagnostics, {
        status: "missing",
        message: "Codex was not found on PATH.",
    });
});

test("getClaudeRuntimeDiagnostics reports Claude as available when the process can be launched", async () => {
    resetResolvedAgentExecutionEnvForTests();

    let helpChecked = false;
    const modules = createRuntimeModules((file, args, options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }

        helpChecked = true;
        assert.equal(file, "claude");
        assert.deepEqual(args, ["--help"]);
        assert.equal(options.cwd, "/Users/test");
        assert.equal(options.env?.PATH, "/Users/test/.nvm/bin:/usr/bin");
        callback(null, "claude help", "");
        return createTrackedProcessStub();
    });

    const diagnostics = await getClaudeRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.equal(helpChecked, true);
    assert.deepEqual(diagnostics, {
        status: "available",
        message: "Claude CLI is available.",
    });
});

test("getClaudeRuntimeDiagnostics reports a missing claude binary clearly", async () => {
    resetResolvedAgentExecutionEnvForTests();

    const modules = createRuntimeModules((file, _args, _options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }

        callback(Object.assign(new Error("missing claude"), { code: "ENOENT" }), "", "");
        return createTrackedProcessStub();
    });

    const diagnostics = await getClaudeRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.deepEqual(diagnostics, {
        status: "missing",
        message: "Claude CLI was not found on PATH.",
    });
});

test("getGeminiRuntimeDiagnostics reports Gemini as available when the process can be launched", async () => {
    resetResolvedAgentExecutionEnvForTests();

    const modules = createRuntimeModules((file, args, options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }

        assert.equal(file, "gemini");
        assert.deepEqual(args, ["--help"]);
        assert.equal(options.cwd, "/Users/test");
        assert.equal(options.env?.PATH, "/Users/test/.nvm/bin:/usr/bin");
        callback(null, "gemini help", "");
        return createTrackedProcessStub();
    });

    const diagnostics = await getGeminiRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.deepEqual(diagnostics, {
        status: "available",
        message: "Gemini CLI is available.",
    });
});

test("getGeminiRuntimeDiagnostics reports a missing gemini binary clearly", async () => {
    resetResolvedAgentExecutionEnvForTests();

    const modules = createRuntimeModules((file, _args, _options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }

        callback(Object.assign(new Error("missing gemini"), { code: "ENOENT" }), "", "");
        return createTrackedProcessStub();
    });

    const diagnostics = await getGeminiRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.deepEqual(diagnostics, {
        status: "missing",
        message: "Gemini CLI was not found on PATH.",
    });
});

test("getGeminiRuntimeDiagnostics reports launch or authentication failures", async () => {
    resetResolvedAgentExecutionEnvForTests();

    const modules = createRuntimeModules((file, _args, _options, callback) => {
        if (file === "/bin/zsh") {
            callback(null, "/Users/test/.nvm/bin:/usr/bin\n", "");
            return createTrackedProcessStub();
        }

        callback(new Error("authentication failed"), "", "authentication failed");
        return createTrackedProcessStub();
    });

    const diagnostics = await getGeminiRuntimeDiagnostics(modules, {
        HOME: "/Users/test",
        PATH: "/usr/bin",
        SHELL: "/bin/zsh",
    });

    assert.deepEqual(diagnostics, {
        status: "unavailable",
        message: "Gemini CLI could not be launched or authenticated from this Obsidian environment.",
    });
});

test("buildClaudeCliArgs includes verbose for print stream-json output", () => {
    assert.deepEqual(
        buildClaudeCliArgs(),
        [
            "-p",
            "--verbose",
            "--output-format",
            "stream-json",
            "--include-partial-messages",
            "--no-session-persistence",
            "--allowedTools",
            "WebSearch,Bash,Read,Write,Edit,Glob,Grep",
            "--append-system-prompt",
            "You generate end-user reply text for an Aside note thread. Return only the final note reply. Answer directly. Do not narrate routine process, context-loading, prompts, or AGENTS instructions. If a tool, search, file operation, or capability fails and affects the answer, say so briefly.",
        ],
    );
});

test("buildCodexCliArgs uses one-shot exec instead of app-server", () => {
    const args = buildCodexCliArgs({
        cwd: "/vault/project",
        vaultRootPath: "/vault",
    });

    assert.equal(args.includes("app-server"), false);
    assert.equal(args.includes("--listen"), false);
    assert.equal(args.includes("-a"), false);
    assert.equal(args.includes("--ask-for-approval"), false);
    assert.deepEqual(args.slice(0, 2), ["exec", "--json"]);
    assert.equal(args.at(-1), "-");
    const addDirIndex = args.indexOf("--add-dir");
    assert.notEqual(addDirIndex, -1);
    assert.equal(args[addDirIndex + 1], "/vault");
});

test("buildGeminiCliArgs enables sandboxed headless streaming without overriding local ownership", () => {
    const args = buildGeminiCliArgs({
        cwd: "/vault/project",
        vaultRootPath: "/vault",
    });

    assert.deepEqual(args, [
        "--prompt",
        "",
        "--output-format",
        "stream-json",
        "--skip-trust",
        "--sandbox",
        "--approval-mode",
        "yolo",
        "--include-directories",
        "/vault",
    ]);
    for (const omittedOption of [
        "--model",
        "--extensions",
        "--allowed-mcp-server-names",
        "--resume",
        "--session-id",
    ]) {
        assert.equal(args.includes(omittedOption), false);
    }
});

test("buildGeminiCliArgs does not duplicate the working directory", () => {
    assert.deepEqual(buildGeminiCliArgs({
        cwd: "/vault",
        vaultRootPath: "/vault",
    }), [
        "--prompt",
        "",
        "--output-format",
        "stream-json",
        "--skip-trust",
        "--sandbox",
        "--approval-mode",
        "yolo",
    ]);
});

test("runAgentRuntimeWithModules streams Gemini replies, progress, metadata, and stdin prompt", async () => {
    const harness = createGeminiRuntimeHarness();
    const partials: string[] = [];
    const progress: string[] = [];
    const metadata: AgentRunMetadata[] = [];
    const runPromise = runAgentRuntimeWithModules(harness.modules, {
        ...GEMINI_TEST_INVOCATION,
        onPartialText: (value) => partials.push(value),
        onProgressText: (value) => progress.push(value),
        onRunMetadata: (value) => metadata.push(value),
    });
    const child = await harness.spawned;

    child.stdout.emitText('{"type":"init","session_id":"session-1"}\n{"type":"message","role":"assistant","content":"Hel');
    child.stdout.emitText('lo","delta":true}\n' + [
        {
            type: "tool_use",
            tool_name: "read_file",
            tool_id: "call-1",
            parameters: { file_path: "Raw/Source.md" },
        },
        {
            type: "tool_result",
            tool_id: "call-1",
            status: "success",
            output: "ok",
        },
        {
            type: "message",
            role: "assistant",
            content: " world",
            delta: true,
        },
        {
            type: "result",
            status: "success",
            stats: { tool_calls: 1 },
        },
    ].map((event) => JSON.stringify(event)).join("\n") + "\n");
    child.emit("close", 0, null);

    const result = await runPromise;
    assert.equal(result.runtime, "direct-cli");
    assert.equal(result.replyText, "Hello world");
    assert.deepEqual(partials, ["Hello", "Hello world"]);
    assert.equal(progress.includes("Starting Gemini"), true);
    assert.equal(progress.includes("Using read_file"), true);
    assert.deepEqual(result.usedTools, ["read_file"]);
    assert.deepEqual(result.usedFiles, ["Raw/Source.md"]);
    assert.equal(metadata.length > 0, true);
    assert.equal(harness.spawnCalls[0]?.file, "gemini");
    assert.deepEqual(harness.spawnCalls[0]?.args, buildGeminiCliArgs(GEMINI_TEST_INVOCATION));
    assert.equal(harness.spawnCalls[0]?.cwd, "/vault/project");
    assert.equal(child.stdinChunks.join(""), buildSideNotePrompt({
        promptText: "@gemini review this",
        vaultRootPath: "/vault",
    }));
    assert.equal(child.ended, true);
});

test("runAgentRuntimeWithModules ignores malformed and unknown Gemini stdout events", async () => {
    const harness = createGeminiRuntimeHarness();
    const runPromise = runAgentRuntimeWithModules(harness.modules, GEMINI_TEST_INVOCATION);
    const child = await harness.spawned;
    child.stdout.emitText([
        "not-json",
        JSON.stringify({ type: "future_event", value: "ignore" }),
        JSON.stringify({
            type: "message",
            role: "assistant",
            content: "Useful reply",
            delta: true,
        }),
        JSON.stringify({ type: "result", status: "success" }),
    ].join("\n") + "\n");
    child.emit("close", 0, null);

    assert.equal((await runPromise).replyText, "Useful reply");
});

test("runAgentRuntimeWithModules rejects an empty successful Gemini response", async () => {
    const harness = createGeminiRuntimeHarness();
    const runPromise = runAgentRuntimeWithModules(harness.modules, GEMINI_TEST_INVOCATION);
    const rejection = assert.rejects(runPromise, /Gemini returned an empty response\./);
    const child = await harness.spawned;
    child.stdout.emitText('{"type":"result","status":"success"}\n');
    child.emit("close", 0, null);
    await rejection;
});

test("runAgentRuntimeWithModules rejects a terminal Gemini error result", async () => {
    const harness = createGeminiRuntimeHarness();
    const runPromise = runAgentRuntimeWithModules(harness.modules, GEMINI_TEST_INVOCATION);
    const rejection = assert.rejects(runPromise, /Maximum session turns exceeded/);
    const child = await harness.spawned;
    child.stdout.emitText([
        JSON.stringify({
            type: "error",
            severity: "error",
            message: "Maximum session turns exceeded",
        }),
        JSON.stringify({ type: "result", status: "error" }),
    ].join("\n") + "\n");
    child.emit("close", 0, null);
    await rejection;
});

test("runAgentRuntimeWithModules reports Gemini nonzero stderr", async () => {
    const harness = createGeminiRuntimeHarness();
    const runPromise = runAgentRuntimeWithModules(harness.modules, GEMINI_TEST_INVOCATION);
    const rejection = assert.rejects(runPromise, /Authentication failed/);
    const child = await harness.spawned;
    child.stderr.emitText("Authentication failed");
    child.emit("close", 1, null);
    await rejection;
});

test("runAgentRuntimeWithModules rejects missing Gemini stdin and spawn failures", async () => {
    const stdinHarness = createGeminiRuntimeHarness({
        child: new RuntimeProcessStub({ withStdin: false }),
    });
    const stdinRun = runAgentRuntimeWithModules(stdinHarness.modules, GEMINI_TEST_INVOCATION);
    const stdinRejection = assert.rejects(stdinRun, /Gemini CLI did not expose stdin\./);
    await stdinHarness.spawned;
    await stdinRejection;

    const spawnHarness = createGeminiRuntimeHarness({
        spawnError: new Error("spawn failed"),
    });
    await assert.rejects(
        runAgentRuntimeWithModules(spawnHarness.modules, GEMINI_TEST_INVOCATION),
        /spawn failed/,
    );
});

test("runAgentRuntimeWithModules cancels Gemini before and during execution", async () => {
    const preAbortedController = new AbortController();
    preAbortedController.abort();
    const preAbortedHarness = createGeminiRuntimeHarness();
    await assert.rejects(
        runAgentRuntimeWithModules(preAbortedHarness.modules, {
            ...GEMINI_TEST_INVOCATION,
            abortSignal: preAbortedController.signal,
        }),
        { name: "AgentRuntimeCancelledError" },
    );
    assert.equal(preAbortedHarness.spawnCalls.length, 0);

    const cancelledController = new AbortController();
    const cancelledHarness = createGeminiRuntimeHarness();
    const cancelledRun = runAgentRuntimeWithModules(cancelledHarness.modules, {
        ...GEMINI_TEST_INVOCATION,
        abortSignal: cancelledController.signal,
    });
    const cancelledRejection = assert.rejects(cancelledRun, {
        name: "AgentRuntimeCancelledError",
    });
    const cancelledChild = await cancelledHarness.spawned;
    cancelledController.abort();
    await cancelledRejection;
    assert.equal(cancelledChild.killedWith, "SIGTERM");
});

test("extractCodexTextDeltaFromJsonEvent reads assistant deltas from exec json events", () => {
    assert.equal(
        extractCodexTextDeltaFromJsonEvent({
            method: "item/agentMessage/delta",
            params: {
                delta: "Hello",
            },
        }),
        "Hello",
    );
    assert.equal(
        extractCodexTextDeltaFromJsonEvent({
            msg: "agent_message_content_delta",
            delta: " world",
        }),
        " world",
    );
    assert.equal(
        extractCodexTextDeltaFromJsonEvent({
            method: "item/reasoning/summaryTextDelta",
            params: {
                delta: "ignore",
            },
        }),
        null,
    );
});

test("extractCodexRunMetadataFromThreadItem captures tool names, files, and sanitized urls", () => {
    assert.deepEqual(
        extractCodexRunMetadataFromThreadItem({
            type: "mcpToolCall",
            tool: "browser-use.browser_navigate",
            arguments: {
                url: "https://example.com/page?token=secret#debug",
                filePath: "Raw/Source Note.md",
            },
        }),
        {
            usedTools: ["browser-use.browser_navigate"],
            usedFiles: ["Raw/Source Note.md"],
            usedUrls: ["https://example.com/page"],
        },
    );
    assert.deepEqual(
        extractCodexRunMetadataFromThreadItem({
            type: "webSearch",
            query: "Aside plugin",
        }),
        {
            usedTools: ["web-search"],
            usedFiles: [],
            usedUrls: [],
        },
    );
    assert.deepEqual(
        extractCodexRunMetadataFromThreadItem({
            type: "commandExecution",
            command: "npm run build",
        }),
        {
            usedTools: [],
            usedFiles: [],
            usedUrls: [],
        },
    );
});

test("extractClaudeTextDeltaFromJsonEvent reads assistant partial message text", () => {
    assert.equal(
        extractClaudeTextDeltaFromJsonEvent({
            type: "assistant",
            message: {
                content: [{ type: "text", text: "Hello" }],
            },
        }),
        "Hello",
    );
    assert.equal(
        extractClaudeTextDeltaFromJsonEvent({
            type: "content_block_delta",
            delta: {
                type: "text_delta",
                text: " world",
            },
        }),
        " world",
    );
    assert.equal(
        extractClaudeTextDeltaFromJsonEvent({
            type: "system",
            subtype: "init",
        }),
        null,
    );
});

test("extractClaudeReplyTextFromJsonEvent reads final result text", () => {
    assert.equal(
        extractClaudeReplyTextFromJsonEvent({
            type: "result",
            subtype: "success",
            result: "Final reply",
        }),
        "Final reply",
    );
    assert.equal(
        extractClaudeReplyTextFromJsonEvent({
            type: "result",
            subtype: "error_max_turns",
            result: "ignore",
        }),
        null,
    );
});

test("extractClaudeRunMetadataFromJsonEvent captures tool names, files, and sanitized urls", () => {
    assert.deepEqual(
        extractClaudeRunMetadataFromJsonEvent({
            type: "assistant",
            message: {
                content: [{
                    type: "tool_use",
                    name: "WebFetch",
                    input: {
                        url: "https://example.com/page?token=secret#debug",
                        file_path: "docs/reference.md",
                    },
                }],
            },
        }),
        {
            usedTools: ["WebFetch"],
            usedFiles: ["docs/reference.md"],
            usedUrls: ["https://example.com/page"],
        },
    );
    assert.deepEqual(
        extractClaudeRunMetadataFromJsonEvent({
            type: "assistant",
            message: {
                content: [{
                    type: "tool_use",
                    name: "Bash",
                    input: {
                        command: "git status",
                    },
                }],
            },
        }),
        {
            usedTools: [],
            usedFiles: [],
            usedUrls: [],
        },
    );
});

test("extractClaudeRunMetadataFromJsonEvent captures named tool error payloads", () => {
    assert.deepEqual(
        extractClaudeRunMetadataFromJsonEvent({
            type: "assistant",
            message: {
                content: [{
                    type: "tool_result",
                    name: "WebSearch",
                    is_error: true,
                    content: "Web search is unavailable in this session.",
                }],
            },
        }),
        {
            usedTools: ["WebSearch (unavailable)"],
            usedFiles: [],
            usedUrls: [],
            usedToolErrors: [{
                name: "WebSearch",
                payload: "Web search is unavailable in this session.",
            }],
        },
    );
});

test("extractClaudeRunMetadataFromJsonEvent captures skill name from Skill tool_use block", () => {
    assert.deepEqual(
        extractClaudeRunMetadataFromJsonEvent({
            type: "assistant",
            message: {
                content: [{
                    type: "tool_use",
                    name: "Skill",
                    input: {
                        skill: "aside",
                        args: "write a reply",
                    },
                }],
            },
        }),
        {
            usedSkills: [{ name: "aside" }],
            usedTools: ["Skill"],
            usedFiles: [],
            usedUrls: [],
        },
    );
});

test("extractClaudeRunMetadataFromJsonEvent does not capture skills from system init event", () => {
    assert.deepEqual(
        extractClaudeRunMetadataFromJsonEvent({
            type: "system",
            subtype: "init",
            skills: [
                { name: "aside", mode: "write", source: "built-in" },
                { name: "brainstorming" },
                { name: "caveman" },
            ],
        }),
        {
            usedTools: [],
            usedFiles: [],
            usedUrls: [],
        },
    );
});

test("extractClaudeProgressTextFromJsonEvent reports concise tool progress", () => {
    assert.equal(
        extractClaudeProgressTextFromJsonEvent({
            type: "assistant",
            message: {
                content: [{
                    type: "tool_use",
                    name: "Read",
                    input: {
                        file_path: "Folder/Note.md",
                    },
                }],
            },
        }),
        "Using Read",
    );
    assert.equal(
        extractClaudeProgressTextFromJsonEvent({
            type: "system",
            subtype: "init",
        }),
        "Starting Claude",
    );
});

test("extractGeminiTextDeltaFromJsonEvent reads only assistant message chunks", () => {
    assert.equal(extractGeminiTextDeltaFromJsonEvent({
        type: "message",
        role: "assistant",
        content: "Hello",
        delta: true,
    }), "Hello");
    assert.equal(extractGeminiTextDeltaFromJsonEvent({
        type: "message",
        role: "user",
        content: "ignore",
    }), null);
    assert.equal(extractGeminiTextDeltaFromJsonEvent({
        type: "future_event",
        content: "ignore",
    }), null);
});

test("extractGeminiResultStatusFromJsonEvent reads terminal success and error", () => {
    assert.equal(extractGeminiResultStatusFromJsonEvent({
        type: "result",
        status: "success",
    }), "success");
    assert.equal(extractGeminiResultStatusFromJsonEvent({
        type: "result",
        status: "error",
    }), "error");
    assert.equal(extractGeminiResultStatusFromJsonEvent({
        type: "error",
        status: "error",
    }), null);
});

test("extractGeminiRunMetadataFromJsonEvent correlates tool results and sanitizes evidence", () => {
    const toolNamesById = new Map<string, string>();
    assert.deepEqual(extractGeminiRunMetadataFromJsonEvent({
        type: "tool_use",
        tool_name: "read_file",
        tool_id: "call-1",
        parameters: {
            file_path: "Raw/Source.md",
            url: "https://example.com/page?token=secret#debug",
        },
    }, toolNamesById), {
        usedTools: ["read_file"],
        usedFiles: ["Raw/Source.md"],
        usedUrls: ["https://example.com/page"],
    });
    assert.deepEqual(extractGeminiRunMetadataFromJsonEvent({
        type: "tool_result",
        tool_id: "call-1",
        status: "error",
        error: {
            type: "NOT_FOUND",
            message: "File missing",
        },
    }, toolNamesById), {
        usedTools: ["read_file (unavailable)"],
        usedFiles: [],
        usedUrls: [],
        usedToolErrors: [{
            name: "read_file",
            payload: "File missing",
        }],
    });
});

test("extractGeminiRunMetadataFromJsonEvent records explicit activated skills", () => {
    assert.deepEqual(extractGeminiRunMetadataFromJsonEvent({
        type: "tool_use",
        tool_name: "activate_skill",
        tool_id: "call-skill",
        parameters: {
            skill: "aside",
        },
    }), {
        usedSkills: [{ name: "aside" }],
        usedTools: ["activate_skill"],
        usedFiles: [],
        usedUrls: [],
    });
});

test("Gemini event helpers expose concise progress and bounded structured errors", () => {
    assert.equal(extractGeminiProgressTextFromJsonEvent({
        type: "init",
    }), "Starting Gemini");
    assert.equal(extractGeminiProgressTextFromJsonEvent({
        type: "tool_use",
        tool_name: "run_shell_command",
    }), "Running command");
    assert.equal(extractGeminiProgressTextFromJsonEvent({
        type: "tool_use",
        tool_name: "web_search",
    }), "Using web_search");
    assert.equal(extractGeminiErrorTextFromJsonEvent({
        type: "error",
        severity: "error",
        message: "Maximum session turns exceeded",
    }), "Maximum session turns exceeded");
    assert.equal(extractGeminiErrorTextFromJsonEvent({
        type: "message",
        role: "assistant",
        content: "normal reply",
    }), null);
});

test("extractCodexProgressTextFromJsonEvent reads reasoning summaries and plan updates", () => {
    assert.equal(
        extractCodexProgressTextFromJsonEvent({
            method: "item/reasoning/summaryTextDelta",
            params: {
                delta: "Reviewing nearby headings",
            },
        }),
        "Reviewing nearby headings",
    );
    assert.equal(
        extractCodexProgressTextFromJsonEvent({
            method: "turn/plan/updated",
            params: {
                explanation: null,
                plan: [
                    { step: "Inspect the current section", status: "completed" },
                    { step: "Draft the reply", status: "inProgress" },
                ],
            },
        }),
        "Draft the reply",
    );
    assert.equal(
        extractCodexProgressTextFromJsonEvent({
            type: "exec_command_begin",
            cmd: "npm test",
        }),
        "Running command: npm test",
    );
    assert.equal(
        extractCodexProgressTextFromJsonEvent({
            method: "item/toolCall/begin",
            params: {
                item: {
                    type: "mcpToolCall",
                    tool: "browser-use.browser_navigate",
                },
            },
        }),
        "Using browser-use.browser_navigate",
    );
});

test("extractCodexProgressTextDeltaFromJsonEvent preserves chunk spacing for buffering", () => {
    assert.equal(
        extractCodexProgressTextDeltaFromJsonEvent({
            method: "item/reasoning/summaryTextDelta",
            params: {
                delta: " using the aside skill",
            },
        }),
        " using the aside skill",
    );
    assert.equal(
        extractCodexProgressTextDeltaFromJsonEvent({
            method: "turn/plan/updated",
            params: {
                explanation: "ignore",
            },
        }),
        null,
    );
});

test("extractCodexErrorTextFromJsonEvent reads structured Codex failure messages", () => {
    assert.equal(
        extractCodexErrorTextFromJsonEvent({
            type: "error",
            message: "Authentication failed. Run codex login.",
        }),
        "Authentication failed. Run codex login.",
    );
    assert.equal(
        extractCodexErrorTextFromJsonEvent({
            method: "turn/error",
            params: {
                error: {
                    message: "Network is unavailable.",
                },
            },
        }),
        "Network is unavailable.",
    );
    assert.equal(
        extractCodexErrorTextFromJsonEvent({
            msg: "agent_message_content_delta",
            delta: "normal reply",
        }),
        null,
    );
});

test("buildSideNotePrompt allows visual assets and points them to vault-root Attachments", () => {
    const prompt = buildSideNotePrompt({
        promptText: "@codex generate a math diagram for covariance",
        vaultRootPath: "/vault",
    });

    assert.match(prompt, /Do not force visual requests into ASCII-only diagrams\./);
    assert.match(prompt, /place it under `Attachments\/` at the active vault root/i);
    assert.match(prompt, /The active vault root is: \/vault/);
    assert.doesNotMatch(prompt, /compact ASCII diagram that fits comfortably in the sidebar/);
});

test("createWorkspaceWriteSandboxPolicy includes extra writable roots without duplicates", () => {
    assert.deepEqual(
        createWorkspaceWriteSandboxPolicy("/vault/project", ["/vault", "/vault/project", "/vault"]).writableRoots,
        ["/vault/project", "/vault"],
    );
});

test("sanitizeAgentReplyText strips leading process narration and keeps the user-facing answer", () => {
    const value = [
        "I'm using the `aside` skill to locate the active thread in this workspace and pull enough nearby note context to draft the reply text that should be appended.",
        "I've loaded the Aside workflow.",
        "I found the exact thread in `test3.md`.",
        "Start with repeated curiosity, not pressure.",
    ].join(" ");

    assert.equal(
        sanitizeAgentReplyText(value),
        "Start with repeated curiosity, not pressure.",
    );
});

test("sanitizeAgentReplyText leaves normal first-person answer text alone", () => {
    assert.equal(
        sanitizeAgentReplyText("I'm drawn to problems that keep paying back attention."),
        "I'm drawn to problems that keep paying back attention.",
    );
});

test("sanitizeAgentReplyText strips concatenated narration sentences without spaces", () => {
    const value = "I’m using the `aside` skill to locate the active thread in this workspace and pull enough nearby note context to draft the reply text that should be appended.I’ve loaded the Aside workflow.I found the exact thread in `test3.md`.Start with repeated curiosity, not pressure.";

    assert.equal(
        sanitizeAgentReplyText(value),
        "Start with repeated curiosity, not pressure.",
    );
});

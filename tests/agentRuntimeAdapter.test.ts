import * as assert from "node:assert/strict";
import test from "node:test";
import {
    extractCodexProgressTextDeltaFromJsonEvent,
    buildSideNotePrompt,
    createWorkspaceWriteSandboxPolicy,
    extractCodexProgressTextFromJsonEvent,
    extractCodexTextDeltaFromJsonEvent,
    getCodexRuntimeDiagnostics,
    resetResolvedAgentExecutionEnvForTests,
    resolveAgentExecutionEnv,
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

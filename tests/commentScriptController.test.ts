import * as assert from "node:assert/strict";
import test from "node:test";
import { CommentManager, type Comment } from "../src/commentManager";
import type { ScriptRunRecord } from "../src/core/scripts/scriptRuns";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import { CommentScriptController } from "../src/vaultScripts/commentScriptController";
import { ScriptRunStore } from "../src/vaultScripts/scriptRunStore";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";
import type {
    VaultScriptRuntimeInvocation,
    VaultScriptRuntimeResult,
} from "../src/vaultScripts/vaultScriptRuntime";

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "Folder/Note.md",
        startLine: 0,
        startChar: 0,
        endLine: 0,
        endChar: 0,
        selectedText: "Alpha",
        selectedTextHash: "hash:alpha",
        comment: overrides.comment ?? "@clean",
        timestamp: overrides.timestamp ?? 10,
        anchorKind: "page",
    };
}

function createStoredRun(overrides: Partial<ScriptRunRecord> = {}): ScriptRunRecord {
    return {
        id: "stored-run",
        threadId: "thread-1",
        triggerEntryId: "thread-1",
        filePath: "Folder/Note.md",
        scriptPath: "🛠️ scripts/clean.mjs",
        mentionName: "clean",
        status: "succeeded",
        promptText: "@clean",
        createdAt: 10,
        endedAt: 11,
        ...overrides,
    };
}

function createHarness(options: {
    scripts?: string[];
    comments?: Comment[];
    initialRuns?: ScriptRunRecord[];
    vaultRootPath?: string | null;
    editSucceeds?: boolean;
    runVaultScript?: (invocation: VaultScriptRuntimeInvocation) => Promise<VaultScriptRuntimeResult>;
} = {}) {
    let persistedData: PersistedPluginData = {
        scriptRuns: options.initialRuns ?? [],
    };
    const store = new ScriptRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            persistedData = updater({ ...persistedData });
            return { ...persistedData };
        },
    });
    store.load();
    const registry = new VaultScriptRegistry();
    registry.seed(options.scripts ?? ["🛠️ scripts/clean.mjs"]);
    const commentManager = new CommentManager(options.comments ?? [createComment()]);
    const runtimeCalls: VaultScriptRuntimeInvocation[] = [];
    const appendedEntries: Array<{
        threadId: string;
        entryId: string;
        body: string;
        insertAfterCommentId?: string;
    }> = [];
    const editedEntries: Array<{ id: string; body: string }> = [];
    const loadedFilePaths: string[] = [];
    const notices: string[] = [];
    let refreshCount = 0;
    let id = 1;
    let now = 100;
    const controller = new CommentScriptController({
        createRunId: () => `script-generated-${id++}`,
        now: () => ++now,
        getVaultRootPath: () => options.vaultRootPath === undefined ? "/vault" : options.vaultRootPath,
        getCommentManager: () => commentManager,
        loadCommentsForFile: async (filePath) => {
            loadedFilePaths.push(filePath);
        },
        appendThreadEntry: async (threadId, entry, appendOptions) => {
            appendedEntries.push({
                threadId,
                entryId: entry.id,
                body: entry.body,
                ...(appendOptions?.insertAfterCommentId
                    ? { insertAfterCommentId: appendOptions.insertAfterCommentId }
                    : {}),
            });
            commentManager.appendEntry(threadId, entry);
            if (appendOptions?.insertAfterCommentId && appendOptions.insertAfterCommentId !== threadId) {
                commentManager.reorderThreadEntries(
                    threadId,
                    entry.id,
                    appendOptions.insertAfterCommentId,
                    "after",
                );
            }
            return true;
        },
        editComment: async (commentId, body) => {
            editedEntries.push({ id: commentId, body });
            if (options.editSucceeds === false || !commentManager.getCommentById(commentId)) {
                return false;
            }
            commentManager.editComment(commentId, body);
            return true;
        },
        refreshCommentViews: async () => {
            refreshCount += 1;
        },
        showNotice: (message) => notices.push(message),
        getRegistry: () => registry,
        runVaultScript: async (invocation) => {
            runtimeCalls.push(invocation);
            return options.runVaultScript?.(invocation) ?? { stdout: "cleaned", stderr: "" };
        },
    }, store);

    return {
        controller,
        store,
        registry,
        commentManager,
        runtimeCalls,
        appendedEntries,
        editedEntries,
        loadedFilePaths,
        notices,
        getRefreshCount: () => refreshCount,
        getPersistedData: () => persistedData,
    };
}

test("first saved script entry creates one durable run, process, and prefixed output", async () => {
    const harness = createHarness();
    const event = {
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "please @clean",
    };

    assert.equal(await harness.controller.handleSavedUserEntry(event), true);
    harness.registry.remove("🛠️ scripts/clean.mjs");
    assert.equal(await harness.controller.handleSavedUserEntry(event), true);

    assert.equal(harness.runtimeCalls.length, 1);
    assert.deepEqual(harness.runtimeCalls[0], {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.mjs",
        notePath: "Folder/Note.md",
    });
    assert.equal(harness.appendedEntries.length, 1);
    assert.equal(harness.appendedEntries[0]?.insertAfterCommentId, "thread-1");
    assert.equal(harness.appendedEntries[0]?.body, "Script @clean:\n\ncleaned");
    assert.deepEqual(harness.store.getRuns().map((run) => run.status), ["succeeded"]);
    assert.equal(harness.store.getRuns()[0]?.outputEntryId, harness.appendedEntries[0]?.entryId);
});

test("script output handles empty success, truncation, and concise stderr failures", async () => {
    const empty = createHarness({
        runVaultScript: async () => ({ stdout: "  ", stderr: "" }),
    });
    await empty.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@clean",
    });
    assert.equal(empty.appendedEntries[0]?.body, "Script @clean:\n\nCompleted.");

    const longOutput = Array.from({ length: 260 }, (_, index) => `word-${index}`).join(" ");
    const truncated = createHarness({
        runVaultScript: async () => ({ stdout: longOutput, stderr: "" }),
    });
    await truncated.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@clean",
    });
    assert.match(truncated.appendedEntries[0]?.body ?? "", /word-249\n\n\[output truncated\]$/u);
    assert.doesNotMatch(truncated.appendedEntries[0]?.body ?? "", /word-250/u);

    const processError = Object.assign(new Error("Command failed with a very noisy stack"), {
        stderr: " bad input\ncheck options ",
    });
    const failed = createHarness({
        runVaultScript: async () => Promise.reject(processError),
    });
    await failed.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@clean",
    });
    assert.equal(failed.store.getRuns()[0]?.status, "failed");
    assert.equal(failed.store.getRuns()[0]?.error, "bad input check options");
    assert.equal(failed.appendedEntries[0]?.body, "Script @clean:\n\nbad input check options");
});

test("rejected directives persist one failed result and bypass runtime and agent fallback", async () => {
    const cases = [
        {
            body: "@clean and @codex",
            scripts: ["🛠️ scripts/clean.mjs"],
            message: "Use a vault script or an agent, not both.",
        },
        {
            body: "@clean then @other-script",
            scripts: ["🛠️ scripts/clean.mjs", "🛠️ scripts/other-script.js"],
            message: "Use only one vault script per side note.",
        },
        {
            body: "@format",
            scripts: ["🛠️ scripts/format.js", "🛠️ scripts/Format.cjs"],
            message: "Script @format matches more than one vault file.",
        },
    ];

    for (const item of cases) {
        const harness = createHarness({ scripts: item.scripts });
        let agentCalls = 0;
        const handled = await harness.controller.handleSavedUserEntry({
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: item.body,
        });
        if (!handled) agentCalls += 1;

        assert.equal(agentCalls, 0, item.body);
        assert.equal(harness.runtimeCalls.length, 0, item.body);
        assert.equal(harness.store.getRuns().length, 1, item.body);
        assert.equal(harness.store.getRuns()[0]?.status, "failed", item.body);
        assert.equal(harness.store.getRuns()[0]?.error, item.message, item.body);
        assert.match(harness.appendedEntries[0]?.body ?? "", new RegExp(item.message.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
});

test("script processes execute serially", async () => {
    let releaseFirst = () => {};
    const harness = createHarness({
        scripts: ["🛠️ scripts/clean.mjs", "🛠️ scripts/other-script.js"],
        comments: [
            createComment({ id: "thread-1", comment: "@clean" }),
            createComment({ id: "thread-2", comment: "@other-script", timestamp: 20 }),
        ],
        runVaultScript: async (invocation) => {
            if (invocation.scriptPath.endsWith("clean.mjs")) {
                await new Promise<void>((resolve) => {
                    releaseFirst = resolve;
                });
            }
            return { stdout: "done", stderr: "" };
        },
    });

    const first = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@clean",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = harness.controller.handleSavedUserEntry({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Folder/Note.md",
        body: "@other-script",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(harness.runtimeCalls.length, 1);
    assert.equal(harness.store.getRuns().find((run) => run.id === "script-generated-1")?.status, "running");
    assert.equal(harness.store.getRuns().find((run) => run.id === "script-generated-2")?.status, "queued");
    releaseFirst();
    await Promise.all([first, second]);
    assert.equal(harness.runtimeCalls.length, 2);
});

test("retryRun reuses output and reloads the latest trigger, thread, note, and script path", async () => {
    const harness = createHarness();
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@clean",
    });
    const previous = harness.store.getRuns()[0];
    assert.ok(previous?.outputEntryId);
    harness.commentManager.renameFile("Folder/Note.md", "Renamed.md");
    harness.commentManager.editComment("thread-1", "rerun @clean now");
    harness.registry.seed(["🛠️ scripts/clean.js"]);

    assert.equal(await harness.controller.retryRun(previous.id), true);

    const retry = harness.store.getRuns()[1];
    assert.equal(retry?.retryOfRunId, previous.id);
    assert.equal(retry?.outputEntryId, previous.outputEntryId);
    assert.equal(retry?.promptText, "rerun @clean now");
    assert.equal(retry?.filePath, "Renamed.md");
    assert.equal(retry?.scriptPath, "🛠️ scripts/clean.js");
    assert.deepEqual(harness.loadedFilePaths, ["Folder/Note.md"]);
    assert.deepEqual(harness.runtimeCalls[1], {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.js",
        notePath: "Renamed.md",
    });
    assert.deepEqual(harness.editedEntries.map((entry) => entry.body), ["", "Script @clean:\n\ncleaned"]);
});

test("retryRun refuses busy, missing-script, and missing-trigger runs without runtime dispatch", async () => {
    for (const status of ["queued", "running"] as const) {
        const busy = createHarness({ initialRuns: [createStoredRun({ status, endedAt: undefined })] });
        assert.equal(await busy.controller.retryRun("stored-run"), false);
        assert.equal(busy.runtimeCalls.length, 0);
    }

    const missingScript = createHarness({ initialRuns: [createStoredRun()] });
    missingScript.registry.remove("🛠️ scripts/clean.mjs");
    assert.equal(await missingScript.controller.retryRun("stored-run"), false);
    assert.equal(missingScript.runtimeCalls.length, 0);
    assert.deepEqual(missingScript.notices, [
        "Unable to rerun: the saved trigger or vault script is no longer available.",
    ]);

    const missingTrigger = createHarness({
        comments: [],
        initialRuns: [createStoredRun()],
    });
    assert.equal(await missingTrigger.controller.retryRun("stored-run"), false);
    assert.equal(missingTrigger.runtimeCalls.length, 0);
    assert.deepEqual(missingTrigger.notices, [
        "Unable to rerun: the saved trigger or vault script is no longer available.",
    ]);
});

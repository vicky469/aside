import * as assert from "node:assert/strict";
import test from "node:test";
import { CommentManager, type Comment } from "../src/commentManager";
import type { ScriptRunRecord } from "../src/core/scripts/scriptRuns";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import {
    CommentScriptController,
    routeSavedUserEntry,
    type SavedEntryBuiltInControllers,
} from "../src/vaultScripts/commentScriptController";
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
        comment: overrides.comment ?? "/clean",
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
        promptText: "/clean",
        createdAt: 10,
        endedAt: 11,
        ...overrides,
    };
}

function createDeferred<T>() {
    let resolve = (_value: T) => {};
    let reject = (_error: unknown) => {};
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function createBuiltInControllers(
    overrides: Partial<SavedEntryBuiltInControllers> = {},
): SavedEntryBuiltInControllers {
    const skip = {
        handleSavedUserEntry: async () => false,
    };
    return {
        updateScript: overrides.updateScript ?? skip,
        createScript: overrides.createScript ?? skip,
        pdfToMarkdown: overrides.pdfToMarkdown ?? skip,
    };
}

async function waitForCondition(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 100; attempt += 1) {
        if (predicate()) return;
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error("Timed out waiting for script controller state.");
}

async function waitForRunStatus(
    harness: ReturnType<typeof createHarness>,
    triggerEntryId: string,
    status: ScriptRunRecord["status"],
): Promise<void> {
    await waitForCondition(() => harness.store.getRuns().some((run) => (
        run.triggerEntryId === triggerEntryId && run.status === status
    )));
}

function createHarness(options: {
    scripts?: string[];
    comments?: Comment[];
    initialRuns?: ScriptRunRecord[];
    vaultRootPath?: string | null;
    editSucceeds?: boolean;
    editResults?: boolean[];
    appendSucceeds?: boolean;
    beforeEditComment?: () => Promise<void>;
    beforeAppendThreadEntryReturn?: () => Promise<void>;
    refreshFailures?: number[];
    beforePersist?: (data: PersistedPluginData) => Promise<void>;
    loadCommentsForFile?: (filePath: string) => Promise<void>;
    runVaultScript?: (invocation: VaultScriptRuntimeInvocation) => Promise<VaultScriptRuntimeResult>;
} = {}) {
    let persistedData: PersistedPluginData = {
        scriptRuns: options.initialRuns ?? [],
    };
    const store = new ScriptRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            if (failNextPersist || persistFailuresRemaining > 0) {
                failNextPersist = false;
                persistFailuresRemaining = Math.max(0, persistFailuresRemaining - 1);
                throw new Error("persist failed");
            }
            const nextData = updater({ ...persistedData });
            await options.beforePersist?.(nextData);
            persistedData = nextData;
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
        alwaysInsertAfterTarget?: boolean;
        refreshBeforePersist?: boolean;
    }> = [];
    const editedEntries: Array<{ id: string; body: string }> = [];
    const appendPersistenceOptions: Array<{
        immediateAggregateRefresh?: boolean;
        skipCommentViewRefresh?: boolean;
        refreshEditorDecorations?: boolean;
        refreshMarkdownPreviews?: boolean;
    }> = [];
    const editPersistenceOptions: Array<{
        skipCommentViewRefresh?: boolean;
        deferAggregateRefresh?: boolean;
        refreshEditorDecorations?: boolean;
        refreshMarkdownPreviews?: boolean;
    }> = [];
    const loadedFilePaths: string[] = [];
    const notices: string[] = [];
    let refreshCount = 0;
    let id = 1;
    let now = 100;
    let failNextPersist = false;
    let persistFailuresRemaining = 0;
    let appendSucceeds = options.appendSucceeds ?? true;
    let editSucceeds = options.editSucceeds ?? true;
    let editResults = options.editResults?.slice() ?? [];
    const controller = new CommentScriptController({
        createRunId: () => `script-generated-${id++}`,
        now: () => ++now,
        getVaultRootPath: () => options.vaultRootPath === undefined ? "/vault" : options.vaultRootPath,
        getCommentManager: () => commentManager,
        loadCommentsForFile: async (filePath) => {
            loadedFilePaths.push(filePath);
            await options.loadCommentsForFile?.(filePath);
        },
        appendThreadEntry: async (threadId, entry, appendOptions) => {
            const persistenceOptions = appendOptions as typeof appendPersistenceOptions[number] | undefined;
            appendedEntries.push({
                threadId,
                entryId: entry.id,
                body: entry.body,
                ...(appendOptions?.insertAfterCommentId
                    ? { insertAfterCommentId: appendOptions.insertAfterCommentId }
                    : {}),
                ...(appendOptions?.alwaysInsertAfterTarget
                    ? { alwaysInsertAfterTarget: appendOptions.alwaysInsertAfterTarget }
                    : {}),
                ...(appendOptions?.refreshBeforePersist
                    ? { refreshBeforePersist: appendOptions.refreshBeforePersist }
                    : {}),
            });
            appendPersistenceOptions.push({
                immediateAggregateRefresh: persistenceOptions?.immediateAggregateRefresh,
                skipCommentViewRefresh: persistenceOptions?.skipCommentViewRefresh,
                refreshEditorDecorations: persistenceOptions?.refreshEditorDecorations,
                refreshMarkdownPreviews: persistenceOptions?.refreshMarkdownPreviews,
            });
            if (!appendSucceeds) {
                return false;
            }
            commentManager.appendEntry(threadId, entry);
            if (
                appendOptions?.insertAfterCommentId
                && (appendOptions.alwaysInsertAfterTarget
                    || appendOptions.insertAfterCommentId !== threadId)
            ) {
                commentManager.reorderThreadEntries(
                    threadId,
                    entry.id,
                    appendOptions.insertAfterCommentId,
                    "after",
                );
            }
            await options.beforeAppendThreadEntryReturn?.();
            return true;
        },
        editComment: async (commentId, body, editOptions) => {
            const persistenceOptions = editOptions as typeof editPersistenceOptions[number] | undefined;
            editedEntries.push({ id: commentId, body });
            editPersistenceOptions.push({
                skipCommentViewRefresh: persistenceOptions?.skipCommentViewRefresh,
                deferAggregateRefresh: persistenceOptions?.deferAggregateRefresh,
                refreshEditorDecorations: persistenceOptions?.refreshEditorDecorations,
                refreshMarkdownPreviews: persistenceOptions?.refreshMarkdownPreviews,
            });
            await options.beforeEditComment?.();
            const nextEditResult = editResults.length > 0
                ? editResults.shift()
                : editSucceeds;
            if (!nextEditResult || !commentManager.getCommentById(commentId)) {
                return false;
            }
            commentManager.editComment(commentId, body);
            return true;
        },
        refreshCommentViews: async () => {
            refreshCount += 1;
            if (options.refreshFailures?.includes(refreshCount)) {
                throw new Error("refresh failed");
            }
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
        appendPersistenceOptions,
        editPersistenceOptions,
        loadedFilePaths,
        notices,
        setAppendSucceeds: (value: boolean) => {
            appendSucceeds = value;
        },
        setEditSucceeds: (value: boolean) => {
            editSucceeds = value;
        },
        setEditResults: (values: boolean[]) => {
            editResults = values.slice();
        },
        failNextPersist: () => {
            failNextPersist = true;
        },
        failPersistTimes: (count: number) => {
            persistFailuresRemaining = count;
        },
        getRefreshCount: () => refreshCount,
        getPersistedData: () => persistedData,
    };
}

test("accepted script creates a durable pending output before background execution", async () => {
    const runtime = createDeferred<VaultScriptRuntimeResult>();
    const harness = createHarness({ runVaultScript: async () => runtime.promise });
    const event = {
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "please /clean",
    };

    let handledResult: boolean | undefined;
    const handled = harness.controller.handleSavedUserEntry(event).then((result) => {
        handledResult = result;
        return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(handledResult, true);
    assert.equal(harness.appendedEntries.length, 1);
    assert.equal(harness.appendedEntries[0]?.body, "");
    assert.equal(harness.appendedEntries[0]?.alwaysInsertAfterTarget, true);
    assert.equal(harness.appendedEntries[0]?.refreshBeforePersist, true);
    assert.deepEqual(harness.appendPersistenceOptions[0], {
        immediateAggregateRefresh: false,
        skipCommentViewRefresh: true,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    });
    assert.deepEqual(harness.editedEntries, []);
    const pendingRun = harness.store.getRuns()[0];
    assert.equal(pendingRun?.outputEntryId, harness.appendedEntries[0]?.entryId);
    assert.ok(pendingRun?.status === "queued" || pendingRun?.status === "running");

    runtime.resolve({ stdout: "cleaned", stderr: "" });
    await waitForRunStatus(harness, "thread-1", "succeeded");
    assert.equal(await handled, true);

    assert.equal(harness.editedEntries.length, 1);
    assert.deepEqual(harness.editedEntries[0], {
        id: pendingRun?.outputEntryId,
        body: "Script /clean:\n\ncleaned",
    });
    assert.deepEqual(harness.editPersistenceOptions[0], {
        skipCommentViewRefresh: true,
        deferAggregateRefresh: true,
        refreshEditorDecorations: false,
        refreshMarkdownPreviews: false,
    });
    assert.equal(harness.appendedEntries.length, 1);
});

test("accepted script edits the pending output in place when runtime fails", async () => {
    const runtime = createDeferred<VaultScriptRuntimeResult>();
    const harness = createHarness({ runVaultScript: async () => runtime.promise });

    let handledResult: boolean | undefined;
    const handled = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    }).then((result) => {
        handledResult = result;
        return result;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(handledResult, true);
    assert.equal(harness.appendedEntries[0]?.body, "");
    const pendingRun = harness.store.getRuns()[0];
    runtime.reject(Object.assign(new Error("Command failed"), { stderr: "bad input" }));
    await waitForRunStatus(harness, "thread-1", "failed");
    assert.equal(await handled, true);

    assert.deepEqual(harness.editedEntries, [{
        id: pendingRun?.outputEntryId,
        body: "Script /clean:\n\nbad input",
    }]);
    assert.equal(harness.appendedEntries.length, 1);
});

test("automatic script execution waits for pending reply durability", async () => {
    const pendingPersist = createDeferred<void>();
    const harness = createHarness({
        beforeAppendThreadEntryReturn: async () => pendingPersist.promise,
    });

    const handled = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForCondition(() => harness.appendedEntries.length === 1);

    assert.equal(harness.runtimeCalls.length, 0);

    pendingPersist.resolve();
    assert.equal(await handled, true);
    await waitForRunStatus(harness, "thread-1", "succeeded");
    assert.equal(harness.runtimeCalls.length, 1);
});

test("disposing during the terminal output edit keeps the run active for startup reconciliation", async () => {
    const editStarted = createDeferred<void>();
    const releaseEdit = createDeferred<void>();
    const harness = createHarness({
        beforeEditComment: async () => {
            editStarted.resolve();
            await releaseEdit.promise;
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await editStarted.promise;
    harness.controller.dispose();
    releaseEdit.resolve();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(harness.store.getRuns()[0]?.status, "running");
});

test("a terminal refresh failure keeps a successful run and output intact", async () => {
    const harness = createHarness({ refreshFailures: [3] });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForCondition(() => harness.getRefreshCount() >= 3);
    await new Promise<void>((resolve) => setImmediate(resolve));

    const run = harness.store.getRuns()[0];
    assert.equal(run?.status, "succeeded");
    assert.equal(harness.editedEntries.at(-1)?.body, "Script /clean:\n\ncleaned");
    assert.equal(harness.editedEntries.length, 1);
});

test("automatic scripts run after pending and running refresh failures", async () => {
    const harness = createHarness({ refreshFailures: [1, 2] });

    assert.equal(await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    }), true);
    await waitForRunStatus(harness, "thread-1", "succeeded");

    assert.equal(harness.runtimeCalls.length, 1);
    assert.equal(harness.appendedEntries[0]?.body, "");
    assert.equal(harness.editedEntries.at(-1)?.body, "Script /clean:\n\ncleaned");
});

test("retryRun continues after setup refresh failure once its run is persisted", async () => {
    const harness = createHarness({
        refreshFailures: [1],
        initialRuns: [createStoredRun({
            status: "failed",
            outputEntryId: "missing-output",
            error: "Interrupted",
        })],
    });

    assert.equal(await harness.controller.retryRun("stored-run"), true);

    const retry = harness.store.getRuns()[1];
    assert.equal(retry?.status, "succeeded");
    assert.equal(harness.runtimeCalls.length, 1);
    assert.equal(harness.appendedEntries[0]?.entryId, retry?.outputEntryId);
    assert.equal(harness.editedEntries.at(-1)?.body, "Script /clean:\n\ncleaned");
});

test("retryRun replaces a missing persisted output id with a new pending reply", async () => {
    const harness = createHarness({
        initialRuns: [createStoredRun({
            status: "failed",
            outputEntryId: "missing-output",
            error: "Interrupted",
        })],
    });

    assert.equal(await harness.controller.retryRun("stored-run"), true);

    const retry = harness.store.getRuns()[1];
    assert.notEqual(retry?.outputEntryId, "missing-output");
    assert.equal(harness.appendedEntries.length, 1);
    assert.equal(harness.appendedEntries[0]?.entryId, retry?.outputEntryId);
    assert.equal(harness.appendedEntries[0]?.body, "");
    assert.deepEqual(harness.editedEntries, [{
        id: retry?.outputEntryId,
        body: "Script /clean:\n\ncleaned",
    }]);
    assert.equal(retry?.status, "succeeded");
});

test("recovery failures are noticed and leave the execution queue usable", async () => {
    const firstRuntime = createDeferred<VaultScriptRuntimeResult>();
    let runtimeCount = 0;
    const harness = createHarness({
        comments: [
            createComment({ id: "thread-1", comment: "/clean" }),
            createComment({ id: "thread-2", comment: "/clean", timestamp: 20 }),
        ],
        runVaultScript: async () => {
            runtimeCount += 1;
            return runtimeCount === 1
                ? firstRuntime.promise
                : { stdout: "cleaned", stderr: "" };
        },
    });

    try {
        await harness.controller.handleSavedUserEntry({
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: "/clean",
        });
        await waitForCondition(() => harness.runtimeCalls.length === 1);
        harness.failPersistTimes(4);
        firstRuntime.reject(new Error("runtime failed"));
        await waitForCondition(() => harness.notices.length > 0);

        assert.match(harness.notices[0] ?? "", /persist failed/u);
        assert.equal(await harness.controller.handleSavedUserEntry({
            threadId: "thread-2",
            entryId: "thread-2",
            filePath: "Folder/Note.md",
            body: "/clean",
        }), true);
        await waitForRunStatus(harness, "thread-2", "succeeded");
        assert.equal(harness.runtimeCalls.length, 2);
    } finally {
        firstRuntime.resolve({ stdout: "cleaned", stderr: "" });
    }
});

test("first saved script entry creates one durable run, process, and prefixed output", async () => {
    const harness = createHarness();
    const event = {
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "please /clean",
    };

    assert.equal(await harness.controller.handleSavedUserEntry(event), true);
    await waitForRunStatus(harness, "thread-1", "succeeded");
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
    assert.equal(harness.appendedEntries[0]?.body, "");
    assert.deepEqual(harness.store.getRuns().map((run) => run.status), ["succeeded"]);
    assert.equal(harness.store.getRuns()[0]?.outputEntryId, harness.appendedEntries[0]?.entryId);
    assert.equal(harness.editedEntries.at(-1)?.body, "Script /clean:\n\ncleaned");
});

test("output append failure terminalizes the run without retrying the broken write path", async () => {
    const harness = createHarness({ appendSucceeds: false });

    assert.equal(await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    }), true);

    const run = harness.store.getRuns()[0];
    assert.equal(harness.runtimeCalls.length, 0);
    assert.equal(harness.appendedEntries.length, 1);
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "Unable to save the vault script result.");
    assert.equal(typeof run?.endedAt, "number");
    assert.deepEqual(harness.notices, ["Unable to save the vault script result."]);
    assert.equal(harness.getRefreshCount(), 1);
});

test("script output handles empty success, truncation, and concise stderr failures", async () => {
    const empty = createHarness({
        runVaultScript: async () => ({ stdout: "  ", stderr: "" }),
    });
    await empty.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(empty, "thread-1", "succeeded");
    assert.equal(empty.appendedEntries[0]?.body, "");
    assert.equal(empty.editedEntries.at(-1)?.body, "Script /clean:\n\nCompleted.");

    const longOutput = Array.from({ length: 260 }, (_, index) => `word-${index}`).join(" ");
    const truncated = createHarness({
        runVaultScript: async () => ({ stdout: longOutput, stderr: "" }),
    });
    await truncated.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(truncated, "thread-1", "succeeded");
    assert.match(truncated.editedEntries.at(-1)?.body ?? "", /word-249\n\n\[output truncated\]$/u);
    assert.doesNotMatch(truncated.editedEntries.at(-1)?.body ?? "", /word-250/u);

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
        body: "/clean",
    });
    await waitForRunStatus(failed, "thread-1", "failed");
    assert.equal(failed.store.getRuns()[0]?.status, "failed");
    assert.equal(failed.store.getRuns()[0]?.error, "bad input check options");
    assert.equal(failed.editedEntries.at(-1)?.body, "Script /clean:\n\nbad input check options");

    const blankStderr = createHarness({
        runVaultScript: async () => Promise.reject(Object.assign(
            new Error("Command failed"),
            { stderr: " \n\t " },
        )),
    });
    await blankStderr.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(blankStderr, "thread-1", "failed");
    assert.equal(blankStderr.store.getRuns()[0]?.error, "Command failed");
    assert.equal(blankStderr.editedEntries.at(-1)?.body, "Script /clean:\n\nCommand failed");
});

test("saved entry routing sends only unclaimed entries to the agent controller", async () => {
    const valid = createHarness();
    const validAgentEvents: string[] = [];
    await routeSavedUserEntry({
        event: {
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: "/clean",
        },
        scriptsEnabled: true,
        builtInControllers: createBuiltInControllers(),
        scriptController: valid.controller,
        agentController: {
            handleSavedUserEntry: async (event) => {
                validAgentEvents.push(event.entryId);
            },
        },
    });
    assert.deepEqual(validAgentEvents, []);

    const rejected = createHarness();
    const rejectedAgentEvents: string[] = [];
    const originalEvent = {
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean and @codex",
    };
    const agentController = {
        handleSavedUserEntry: async (event: typeof originalEvent) => {
            rejectedAgentEvents.push(event.body);
        },
    };
    await routeSavedUserEntry({
        event: originalEvent,
        scriptsEnabled: true,
        builtInControllers: createBuiltInControllers(),
        scriptController: rejected.controller,
        agentController,
    });
    rejected.registry.remove("🛠️ scripts/clean.mjs");
    await routeSavedUserEntry({
        event: {
            ...originalEvent,
            body: "@codex after registry refresh",
        },
        scriptsEnabled: true,
        builtInControllers: createBuiltInControllers(),
        scriptController: rejected.controller,
        agentController,
    });
    assert.deepEqual(rejectedAgentEvents, []);
    assert.equal(rejected.store.getRuns().length, 1);

    const ordinary = createHarness();
    const ordinaryAgentEvents: string[] = [];
    await routeSavedUserEntry({
        event: {
            threadId: "thread-1",
            entryId: "ordinary-entry",
            filePath: "Folder/Note.md",
            body: "ordinary @person",
        },
        scriptsEnabled: true,
        builtInControllers: createBuiltInControllers(),
        scriptController: ordinary.controller,
        agentController: {
            handleSavedUserEntry: async (event) => {
                ordinaryAgentEvents.push(event.entryId);
            },
        },
    });
    assert.deepEqual(ordinaryAgentEvents, ["ordinary-entry"]);
});

test("saved entry routing sends disabled script directives only to the agent controller", async () => {
    const routeCalls: string[] = [];
    await routeSavedUserEntry({
        event: {
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: "/clean",
        },
        scriptsEnabled: false,
        builtInControllers: createBuiltInControllers({
            updateScript: {
                handleSavedUserEntry: async () => {
                    routeCalls.push("built-in");
                    return true;
                },
            },
        }),
        scriptController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("script");
                return true;
            },
        },
        agentController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("agent");
            },
        },
    });

    assert.deepEqual(routeCalls, ["agent"]);
});

test("saved entry routing tries built-in script-authoring commands before vault scripts", async () => {
    const routeCalls: string[] = [];
    const savedEvent = {
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/create-script build a cleaner",
    };

    await routeSavedUserEntry({
        event: savedEvent,
        scriptsEnabled: true,
        builtInControllers: createBuiltInControllers({
            updateScript: {
                handleSavedUserEntry: async () => {
                    routeCalls.push("update-script");
                    return false;
                },
            },
            createScript: {
                handleSavedUserEntry: async () => {
                    routeCalls.push("create-script");
                    return true;
                },
            },
        }),
        scriptController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("script");
                return true;
            },
        },
        agentController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("agent");
            },
        },
    });

    assert.deepEqual(routeCalls, ["update-script", "create-script"]);
});

test("saved entry routing claims pdf-to-markdown before scripts and generic agents", async () => {
    const routeCalls: string[] = [];

    await routeSavedUserEntry({
        event: {
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Books/Guide.pdf",
            body: "/pdf-to-markdown",
        },
        scriptsEnabled: true,
        builtInControllers: {
            updateScript: {
                handleSavedUserEntry: async () => {
                    routeCalls.push("update-script");
                    return false;
                },
            },
            createScript: {
                handleSavedUserEntry: async () => {
                    routeCalls.push("create-script");
                    return false;
                },
            },
            pdfToMarkdown: {
                handleSavedUserEntry: async () => {
                    routeCalls.push("pdf-to-markdown");
                    return true;
                },
            },
        },
        scriptController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("script");
                return true;
            },
        },
        agentController: {
            handleSavedUserEntry: async () => {
                routeCalls.push("agent");
            },
        },
    });

    assert.deepEqual(routeCalls, ["update-script", "create-script", "pdf-to-markdown"]);
});

test("rejected directives persist one failed result and bypass runtime and agent fallback", async () => {
    const cases = [
        {
            body: "/clean and @codex",
            scripts: ["🛠️ scripts/clean.mjs"],
            message: "Use a vault script or an agent, not both.",
        },
        {
            body: "/clean then /other-script",
            scripts: ["🛠️ scripts/clean.mjs", "🛠️ scripts/other-script.js"],
            message: "Use only one vault script per side note.",
        },
        {
            body: "/format",
            scripts: ["🛠️ scripts/format.js", "🛠️ scripts/Format.cjs"],
            message: "Script /format matches more than one vault file.",
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
        assert.equal(harness.appendedEntries[0]?.alwaysInsertAfterTarget, true, item.body);
        assert.match(harness.appendedEntries[0]?.body ?? "", new RegExp(item.message.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    }
});

test("script processes execute serially", async () => {
    let releaseFirst = () => {};
    const harness = createHarness({
        scripts: ["🛠️ scripts/clean.mjs", "🛠️ scripts/other-script.js"],
        comments: [
            createComment({ id: "thread-1", comment: "/clean" }),
            createComment({ id: "thread-2", comment: "/other-script", timestamp: 20 }),
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
        body: "/clean",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = harness.controller.handleSavedUserEntry({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Folder/Note.md",
        body: "/other-script",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(harness.runtimeCalls.length, 1);
    assert.equal(harness.store.getRuns().find((run) => run.triggerEntryId === "thread-1")?.status, "running");
    assert.equal(harness.store.getRuns().find((run) => run.triggerEntryId === "thread-2")?.status, "queued");
    releaseFirst();
    await Promise.all([first, second]);
    await waitForRunStatus(harness, "thread-1", "succeeded");
    await waitForRunStatus(harness, "thread-2", "succeeded");
    assert.equal(harness.runtimeCalls.length, 2);
});

test("queued automatic execution revalidates its script against the live registry", async () => {
    let releaseFirst = () => {};
    const harness = createHarness({
        scripts: ["🛠️ scripts/clean.mjs", "🛠️ scripts/other-script.js"],
        comments: [
            createComment({ id: "thread-1", comment: "/clean" }),
            createComment({ id: "thread-2", comment: "/other-script", timestamp: 20 }),
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
        body: "/clean",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = harness.controller.handleSavedUserEntry({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Folder/Note.md",
        body: "/other-script",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    harness.registry.upsert("🛠️ scripts/Other-Script.cjs");
    releaseFirst();
    await Promise.all([first, second]);
    await waitForRunStatus(harness, "thread-1", "succeeded");
    await waitForRunStatus(harness, "thread-2", "failed");

    assert.equal(harness.runtimeCalls.length, 1);
    const secondRun = harness.store.getRuns().find((run) => run.triggerEntryId === "thread-2");
    assert.equal(secondRun?.status, "failed");
    assert.match(secondRun?.error ?? "", /changed or became ambiguous/iu);
});

test("automatic execution revalidates again after persisting running state", async () => {
    let mutateRegistry = () => {};
    const harness = createHarness({
        scripts: ["🛠️ scripts/clean.mjs"],
        beforePersist: async (data) => {
            const run = Array.isArray(data.scriptRuns) ? data.scriptRuns[0] : null;
            if (run && typeof run === "object" && "status" in run && run.status === "running") {
                mutateRegistry();
            }
        },
    });
    mutateRegistry = () => harness.registry.upsert("🛠️ scripts/Clean.cjs");

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(harness, "thread-1", "failed");

    assert.equal(harness.runtimeCalls.length, 0);
    const run = harness.store.getRuns()[0];
    assert.equal(run?.status, "failed");
    assert.match(run?.error ?? "", /changed or became ambiguous/iu);
});

test("retryRun reuses output and reloads the latest trigger, thread, note, and script path", async () => {
    const harness = createHarness();
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(harness, "thread-1", "succeeded");
    const previous = harness.store.getRuns()[0];
    assert.ok(previous?.outputEntryId);
    harness.commentManager.renameFile("Folder/Note.md", "Renamed.md", {
        selectionCapable: true,
        pageLabelHash: "hash-renamed",
    });
    harness.commentManager.editComment("thread-1", "rerun /clean now");
    harness.registry.seed(["🛠️ scripts/clean.js"]);

    assert.equal(await harness.controller.retryRun(previous.id), true);

    const retry = harness.store.getRuns()[1];
    assert.equal(retry?.retryOfRunId, previous.id);
    assert.equal(retry?.outputEntryId, previous.outputEntryId);
    assert.equal(retry?.promptText, "rerun /clean now");
    assert.equal(retry?.filePath, "Renamed.md");
    assert.equal(retry?.scriptPath, "🛠️ scripts/clean.js");
    assert.deepEqual(harness.loadedFilePaths, ["Folder/Note.md"]);
    assert.deepEqual(harness.runtimeCalls[1], {
        vaultRootPath: "/vault",
        scriptPath: "🛠️ scripts/clean.js",
        notePath: "Renamed.md",
    });
    assert.deepEqual(harness.editedEntries.map((entry) => entry.body), [
        "Script /clean:\n\ncleaned",
        "",
        "Script /clean:\n\ncleaned",
    ]);
    assert.equal(harness.appendedEntries.length, 1);
    assert.equal(harness.editedEntries.at(-1)?.body, "Script /clean:\n\ncleaned");
});

test("retryRun claims concurrently before loading and creates only one retry", async () => {
    let releaseLoad = () => {};
    const harness = createHarness({
        initialRuns: [createStoredRun()],
        loadCommentsForFile: async () => new Promise<void>((resolve) => {
            releaseLoad = resolve;
        }),
    });

    const firstRetry = harness.controller.retryRun("stored-run");
    const secondRetry = harness.controller.retryRun("stored-run");
    assert.equal(await secondRetry, false);
    releaseLoad();
    assert.equal(await firstRetry, true);

    assert.equal(harness.store.getRuns().length, 2);
    assert.equal(harness.runtimeCalls.length, 1);
});

test("retryRun persists before clearing and leaves old output visible when persistence fails", async () => {
    const harness = createHarness();
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(harness, "thread-1", "succeeded");
    const previous = harness.store.getRuns()[0];
    const previousOutput = harness.commentManager.getCommentById(previous.outputEntryId ?? "")?.comment;
    const editCountBeforeRetry = harness.editedEntries.length;
    harness.failNextPersist();

    assert.equal(await harness.controller.retryRun(previous.id), false);

    assert.equal(harness.store.getRuns().length, 1);
    assert.deepEqual(harness.editedEntries.slice(editCountBeforeRetry), []);
    assert.equal(
        harness.commentManager.getCommentById(previous.outputEntryId ?? "")?.comment,
        previousOutput,
    );
    assert.equal(harness.runtimeCalls.length, 1);
});

test("retryRun terminalizes a durable retry when clearing the old output fails", async () => {
    const harness = createHarness();
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(harness, "thread-1", "succeeded");
    const previous = harness.store.getRuns()[0];
    const previousOutput = harness.commentManager.getCommentById(previous.outputEntryId ?? "")?.comment;
    harness.setEditSucceeds(false);

    assert.equal(await harness.controller.retryRun(previous.id), false);

    const retry = harness.store.getRuns()[1];
    assert.equal(retry?.status, "failed");
    assert.equal(retry?.error, "Unable to replace the previous script result.");
    assert.equal(typeof retry?.endedAt, "number");
    assert.equal(harness.runtimeCalls.length, 1);
    assert.equal(
        harness.commentManager.getCommentById(previous.outputEntryId ?? "")?.comment,
        previousOutput,
    );
    assert.deepEqual(harness.notices, ["Unable to replace the previous script result."]);
});

test("retry output clear failure terminalizes once without retrying the edit", async () => {
    const harness = createHarness();
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/clean",
    });
    await waitForRunStatus(harness, "thread-1", "succeeded");
    const previous = harness.store.getRuns()[0];
    const editCountBeforeRetry = harness.editedEntries.length;
    harness.setEditResults([false]);

    assert.equal(await harness.controller.retryRun(previous.id), false);

    const retry = harness.store.getRuns()[1];
    assert.equal(retry?.status, "failed");
    assert.equal(retry?.error, "Unable to replace the previous script result.");
    assert.equal(harness.runtimeCalls.length, 1);
    assert.equal(harness.editedEntries.length - editCountBeforeRetry, 1);
    assert.deepEqual(harness.notices, ["Unable to replace the previous script result."]);
});

test("dispose leaves active receipts for startup reconciliation without launching queued work", async () => {
    let releaseFirst = () => {};
    const harness = createHarness({
        scripts: ["🛠️ scripts/clean.mjs", "🛠️ scripts/other-script.js"],
        comments: [
            createComment({ id: "thread-1", comment: "/clean" }),
            createComment({ id: "thread-2", comment: "/other-script", timestamp: 20 }),
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
        body: "/clean",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    const second = harness.controller.handleSavedUserEntry({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Folder/Note.md",
        body: "/other-script",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    harness.controller.dispose();
    releaseFirst();
    await Promise.all([first, second]);

    const secondRun = harness.store.getRuns().find((run) => run.triggerEntryId === "thread-2");
    const firstRun = harness.store.getRuns().find((run) => run.triggerEntryId === "thread-1");
    assert.equal(harness.runtimeCalls.length, 1);
    assert.equal(firstRun?.status, "running");
    assert.equal(secondRun?.status, "queued");
    assert.equal(harness.appendedEntries.length, 2);
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

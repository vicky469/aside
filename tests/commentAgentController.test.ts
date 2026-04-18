import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import { AgentRunStore } from "../src/control/agentRunStore";
import { CommentAgentController } from "../src/control/commentAgentController";
import type { PersistedPluginData } from "../src/control/indexNoteSettingsPlanner";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createComment(overrides: Partial<Comment> = {}): Comment {
    return {
        id: overrides.id ?? "thread-1",
        filePath: overrides.filePath ?? "Folder/Note.md",
        startLine: overrides.startLine ?? 0,
        startChar: overrides.startChar ?? 0,
        endLine: overrides.endLine ?? 0,
        endChar: overrides.endChar ?? 0,
        selectedText: overrides.selectedText ?? "Alpha",
        selectedTextHash: overrides.selectedTextHash ?? "hash:alpha",
        comment: overrides.comment ?? "@codex say hi",
        timestamp: overrides.timestamp ?? 10,
        anchorKind: overrides.anchorKind ?? "page",
        orphaned: overrides.orphaned ?? false,
        resolved: overrides.resolved ?? false,
    };
}

async function waitForAgentQueueToDrain(controller: CommentAgentController): Promise<void> {
    for (let index = 0; index < 100; index += 1) {
        const runs = controller.getAgentRuns();
        if (runs.every((run) => run.status !== "queued" && run.status !== "running")) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

function createHarness(options: {
    runtimeWorkingDirectory?: string | null;
    runtimeReplyText?: string;
    runtimeError?: Error;
    runtimeStreamTexts?: string[];
    initialComments?: Comment[];
    customRunAgentRuntime?: (invocation: {
        target: "codex" | "claude";
        prompt: string;
        cwd: string;
        onPartialText?: (partialText: string) => void;
    }) => Promise<{ runtime: "direct-cli"; replyText: string }>;
} = {}) {
    let persistedData: PersistedPluginData = {};
    const commentManager = new CommentManager(options.initialComments ?? [createComment()]);
    const file = createFile((options.initialComments?.[0] ?? createComment()).filePath);
    const appendedEntries: Array<{ threadId: string; body: string }> = [];
    const notices: string[] = [];
    const runtimeCalls: Array<{ target: "codex" | "claude"; prompt: string; cwd: string }> = [];
    let refreshCount = 0;
    let idCounter = 1;
    let now = 100;

    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
    });

    const controller = new CommentAgentController({
        createCommentId: () => `generated-${idCounter++}`,
        now: () => ++now,
        refreshCommentViews: async () => {
            refreshCount += 1;
        },
        getRuntimeWorkingDirectory: () => options.runtimeWorkingDirectory === undefined ? "/vault" : options.runtimeWorkingDirectory,
        getCommentManager: () => commentManager,
        getFileByPath: () => file,
        isCommentableFile: (candidate): candidate is TFile => !!candidate,
        loadCommentsForFile: async () => undefined,
        appendThreadEntry: async (threadId, entry) => {
            appendedEntries.push({ threadId, body: entry.body });
            commentManager.appendEntry(threadId, entry);
            return true;
        },
        runAgentRuntime: async (invocation) => {
            runtimeCalls.push(invocation);
            if (options.customRunAgentRuntime) {
                return options.customRunAgentRuntime(invocation);
            }
            if (options.runtimeError) {
                throw options.runtimeError;
            }

            for (const partialText of options.runtimeStreamTexts ?? []) {
                invocation.onPartialText?.(partialText);
            }

            return {
                runtime: "direct-cli",
                replyText: options.runtimeReplyText ?? "Done",
            };
        },
        showNotice: (message) => {
            notices.push(message);
        },
    }, store);
    controller.initialize();

    return {
        controller,
        store,
        commentManager,
        appendedEntries,
        notices,
        runtimeCalls,
        getRefreshCount: () => refreshCount,
        getPersistedData: () => persistedData,
    };
}

test("comment agent controller marks runs failed when runtime execution is unavailable", async () => {
    const harness = createHarness({
        runtimeWorkingDirectory: null,
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex fix this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "failed");
    assert.match(latestRun?.error ?? "", /desktop Obsidian/i);
    assert.deepEqual(harness.appendedEntries, []);
});

test("comment agent controller appends a reply and marks the run succeeded", async () => {
    const harness = createHarness({
        runtimeReplyText: "Ship it.",
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.requestedAgent, "codex");
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "Ship it.",
    }]);
    assert.equal(harness.runtimeCalls[0]?.target, "codex");
    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault");
});

test("comment agent controller retries using the current saved directive text", async () => {
    const harness = createHarness();

    await harness.store.addRun({
        id: "run-1",
        threadId: "thread-1",
        triggerEntryId: "thread-1",
        filePath: "Folder/Note.md",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "failed",
        promptText: "@codex old prompt",
        createdAt: 10,
        endedAt: 20,
        error: "Failed",
    });
    harness.commentManager.editComment("thread-1", "@codex explain the diff");

    const started = await harness.controller.retryLatestRun("thread-1");
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(started, true);
    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.requestedAgent, "codex");
    assert.equal(latestRun?.retryOfRunId, "run-1");
    assert.equal(harness.runtimeCalls.at(-1)?.target, "codex");
});

test("comment agent controller uses the resolved working directory for runtime execution", async () => {
    const harness = createHarness({
        runtimeWorkingDirectory: "/vault/SideNote2",
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "SideNote2/Note.md",
        body: "@codex inspect this repo",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault/SideNote2");
});

test("comment agent controller keeps the final stream card in place when a run succeeds", async () => {
    let releaseRuntime: () => void = () => {
        throw new Error("Expected runtime release callback to be set.");
    };
    const streamUpdates: Array<string | null> = [];
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            invocation.onPartialText?.("Hello");
            await new Promise<void>((resolve) => {
                releaseRuntime = () => resolve();
            });
            invocation.onPartialText?.("Hello there");
            return {
                runtime: "direct-cli",
                replyText: "Hello there",
            };
        },
    });
    const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
        streamUpdates.push(update.stream?.partialText ?? null);
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex stream this",
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText, "Hello");
    assert.deepEqual(streamUpdates.slice(0, 2), ["", "Hello"]);
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText, "Hello");
    assert.equal(harness.getRefreshCount(), 2);

    releaseRuntime();
    await waitForAgentQueueToDrain(harness.controller);
    unsubscribe();

    const finalStream = harness.controller.getActiveAgentStreamForThread("thread-1");
    assert.equal(finalStream?.status, "succeeded");
    assert.equal(finalStream?.partialText, "Hello there");
    assert.deepEqual(streamUpdates, ["", "Hello", "Hello there", "Hello there"]);
    assert.equal(harness.getRefreshCount(), 2);
});

test("comment agent controller does not synthesize transient stream text when the runtime does not stream partials", async () => {
    const streamUpdates: Array<string | null> = [];
    const harness = createHarness({
        runtimeReplyText: Array.from({ length: 12 }, (_value, index) => `Line ${index + 1}`).join("\n"),
    });
    const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
        streamUpdates.push(update.stream?.partialText ?? null);
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex reveal this",
    });
    await waitForAgentQueueToDrain(harness.controller);
    unsubscribe();

    assert.deepEqual(streamUpdates, ["", Array.from({ length: 12 }, (_value, index) => `Line ${index + 1}`).join("\n")]);
    assert.equal(harness.appendedEntries[0]?.body, Array.from({ length: 12 }, (_value, index) => `Line ${index + 1}`).join("\n"));
    assert.equal(harness.getRefreshCount(), 2);
});

test("comment agent controller shows a notice for unsupported agent mentions", async () => {
    const harness = createHarness();

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@claude review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.deepEqual(harness.notices, ["This build currently supports @codex only."]);
    assert.deepEqual(harness.runtimeCalls, []);
});

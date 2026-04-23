import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import { AgentRunStore } from "../src/control/agentRunStore";
import { CommentAgentController } from "../src/control/commentAgentController";
import type { PersistedPluginData } from "../src/control/indexNoteSettingsPlanner";
import type { AgentRuntimeSelection } from "../src/control/agentRuntimeSelection";
import type { RemoteRuntimeResponseEnvelope } from "../src/control/openclawRuntimeBridge";

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
    for (let index = 0; index < 300; index += 1) {
        const runs = controller.getAgentRuns();
        if (runs.every((run) => run.status !== "queued" && run.status !== "running")) {
            return;
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

function squashConsecutiveValues<T>(values: T[]): T[] {
    return values.filter((value, index) => index === 0 || values[index - 1] !== value);
}

function createHarness(options: {
    initialPersistedData?: PersistedPluginData;
    runtimeWorkingDirectory?: string | null;
    currentNoteContent?: string;
    runtimeReplyText?: string;
    runtimeError?: Error;
    runtimeStreamTexts?: string[];
    nowIncrement?: number;
    onRefreshCommentViews?: (controller: CommentAgentController) => void;
    initialComments?: Comment[];
    runtimeSelection?: AgentRuntimeSelection;
    customRunAgentRuntime?: (invocation: {
        target: "codex" | "claude";
        prompt: string;
        cwd: string;
        vaultRootPath?: string | null;
        onPartialText?: (partialText: string) => void;
        onProgressText?: (progressText: string) => void;
        abortSignal?: AbortSignal;
    }) => Promise<{ runtime: "direct-cli"; replyText: string }>;
    startRemoteRuntimeRun?: (options: {
        agent: "codex" | "claude";
        promptText: string;
        metadata: Record<string, unknown>;
    }) => Promise<RemoteRuntimeResponseEnvelope>;
    pollRemoteRuntimeRun?: (runId: string, afterCursor?: string | null, waitMs?: number) => Promise<RemoteRuntimeResponseEnvelope>;
    cancelRemoteRuntimeRun?: (runId: string) => Promise<RemoteRuntimeResponseEnvelope>;
} = {}) {
    let persistedData: PersistedPluginData = options.initialPersistedData ?? {};
    const commentManager = new CommentManager(options.initialComments ?? [createComment()]);
    const file = createFile((options.initialComments?.[0] ?? createComment()).filePath);
    const appendedEntries: Array<{ threadId: string; body: string; insertAfterCommentId?: string }> = [];
    const editedEntries: Array<{ commentId: string; body: string }> = [];
    const notices: string[] = [];
    const logEntries: Array<{
        level: "info" | "warn" | "error";
        area: string;
        event: string;
        payload?: Record<string, unknown>;
    }> = [];
    const runtimeCalls: Array<{ target: "codex" | "claude"; prompt: string; cwd: string; vaultRootPath?: string | null }> = [];
    const remoteStartCalls: Array<{ agent: "codex" | "claude"; promptText: string; metadata: Record<string, unknown> }> = [];
    const remotePollCalls: Array<{ runId: string; afterCursor?: string | null; waitMs?: number }> = [];
    const remoteCancelCalls: string[] = [];
    let refreshCount = 0;
    let idCounter = 1;
    let now = 100;
    const nowIncrement = options.nowIncrement ?? 1;
    let controller: CommentAgentController;

    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        writePersistedPluginData: async (data) => {
            persistedData = data;
        },
    });

    controller = new CommentAgentController({
        createCommentId: () => `generated-${idCounter++}`,
        now: () => {
            now += nowIncrement;
            return now;
        },
        getPluginVersion: () => "2.0.39",
        getVaultRootPath: () => "/vault-root",
        refreshCommentViews: async () => {
            refreshCount += 1;
            options.onRefreshCommentViews?.(controller);
        },
        getRuntimeWorkingDirectory: () => options.runtimeWorkingDirectory === undefined ? "/vault" : options.runtimeWorkingDirectory,
        getCommentManager: () => commentManager,
        getFileByPath: () => file,
        isCommentableFile: (candidate): candidate is TFile => !!candidate,
        getCurrentNoteContent: async () => options.currentNoteContent ?? "",
        loadCommentsForFile: async () => undefined,
        appendThreadEntry: async (threadId, entry, appendOptions) => {
            appendedEntries.push({
                threadId,
                body: entry.body,
                ...(appendOptions?.insertAfterCommentId
                    ? { insertAfterCommentId: appendOptions.insertAfterCommentId }
                    : {}),
            });
            commentManager.appendEntry(threadId, entry);
            if (
                appendOptions?.insertAfterCommentId
                && (appendOptions.alwaysInsertAfterTarget || appendOptions.insertAfterCommentId !== threadId)
            ) {
                commentManager.reorderThreadEntries(
                    threadId,
                    entry.id,
                    appendOptions.insertAfterCommentId,
                    "after",
                );
            }
            return true;
        },
        editComment: async (commentId, newCommentText) => {
            editedEntries.push({ commentId, body: newCommentText });
            commentManager.editComment(commentId, newCommentText);
            return true;
        },
        deleteComment: async (commentId) => {
            commentManager.deleteComment(commentId, now);
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
        resolveAgentRuntimeSelection: async () => options.runtimeSelection ?? {
            kind: "resolved",
            runtime: "direct-cli",
            modePreference: "auto",
            ownershipMessage: "Using your local Codex setup",
        },
        startRemoteRuntimeRun: async (remoteOptions) => {
            remoteStartCalls.push(remoteOptions);
            if (options.startRemoteRuntimeRun) {
                return options.startRemoteRuntimeRun(remoteOptions);
            }
            return {
                httpStatus: 200,
                status: "completed",
                cursor: "evt-1",
                runId: "remote-run-1",
                events: [],
                replyText: "Remote done",
                error: null,
            };
        },
        pollRemoteRuntimeRun: async (runId, afterCursor, waitMs) => {
            remotePollCalls.push({ runId, afterCursor, waitMs });
            if (options.pollRemoteRuntimeRun) {
                return options.pollRemoteRuntimeRun(runId, afterCursor, waitMs);
            }
            return {
                httpStatus: 200,
                status: "completed",
                cursor: afterCursor ?? "evt-1",
                runId,
                events: [],
                replyText: "Remote done",
                error: null,
            };
        },
        cancelRemoteRuntimeRun: async (runId) => {
            remoteCancelCalls.push(runId);
            if (options.cancelRemoteRuntimeRun) {
                return options.cancelRemoteRuntimeRun(runId);
            }
            return {
                httpStatus: 202,
                status: "cancelled",
                cursor: null,
                runId,
                events: [],
                replyText: null,
                error: null,
            };
        },
        showNotice: (message) => {
            notices.push(message);
        },
        log: async (level, area, event, payload) => {
            logEntries.push({ level, area, event, payload });
        },
    }, store);
    controller.initialize();

    return {
        controller,
        store,
        commentManager,
        appendedEntries,
        editedEntries,
        notices,
        logEntries,
        runtimeCalls,
        remoteStartCalls,
        remotePollCalls,
        remoteCancelCalls,
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
    assert.equal(latestRun?.outputEntryId, "generated-2");
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "thread-1",
    }]);
    assert.equal(harness.editedEntries[0]?.commentId, "generated-2");
    assert.match(harness.editedEntries[0]?.body ?? "", /desktop Obsidian/i);
    assert.match(harness.commentManager.getCommentById("generated-2")?.comment ?? "", /desktop Obsidian/i);
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
    assert.equal(latestRun?.outputEntryId, "generated-2");
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "thread-1",
    }]);
    assert.deepEqual(harness.editedEntries, [{
        commentId: "generated-2",
        body: "Ship it.",
    }]);
    assert.equal(harness.runtimeCalls[0]?.target, "codex");
    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault");
    assert.equal(harness.runtimeCalls[0]?.vaultRootPath, "/vault-root");
});

test("comment agent controller blocks a run when runtime selection is unavailable", async () => {
    const harness = createHarness({
        runtimeSelection: {
            kind: "blocked",
            modePreference: "remote",
            notice: "Remote bridge is not configured.",
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review this",
    });

    assert.deepEqual(harness.notices, ["Remote bridge is not configured."]);
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1"), null);
});

test("comment agent controller can run through the remote bridge and persist resume fields", async () => {
    const pollResponses: RemoteRuntimeResponseEnvelope[] = [{
        httpStatus: 200,
        status: "running",
        cursor: "evt-2",
        runId: "remote-run-1",
        events: [
            { type: "progress", text: "Preparing context" },
            { type: "output_delta", text: "Hello" },
        ],
        replyText: null,
        error: null,
    }, {
        httpStatus: 200,
        status: "completed",
        cursor: "evt-3",
        runId: "remote-run-1",
        events: [],
        replyText: "Hello world",
        error: null,
    }];
    const harness = createHarness({
        runtimeSelection: {
            kind: "resolved",
            runtime: "openclaw-acp",
            modePreference: "remote",
            ownershipMessage: "Using remote runtime",
        },
        startRemoteRuntimeRun: async () => ({
            httpStatus: 200,
            status: "queued",
            cursor: "evt-1",
            runId: "remote-run-1",
            events: [],
            replyText: null,
            error: null,
        }),
        pollRemoteRuntimeRun: async () => pollResponses.shift() ?? {
            httpStatus: 200,
            status: "completed",
            cursor: "evt-3",
            runId: "remote-run-1",
            events: [],
            replyText: "Hello world",
            error: null,
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.runtime, "openclaw-acp");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.remoteExecutionId, "remote-run-1");
    assert.equal(latestRun?.remoteCursor, "evt-3");
    assert.equal(harness.editedEntries.at(-1)?.body, "Hello world");
    assert.equal(harness.remoteStartCalls[0]?.metadata.contextScope, "section");
    assert.equal(typeof harness.remoteStartCalls[0]?.metadata.contextBytes, "number");
    assert.match(harness.remoteStartCalls[0]?.promptText ?? "", /Request:\n<<<\n@codex say hi\n>>>/);
    assert.deepEqual(
        harness.remotePollCalls.map((call) => call.waitMs),
        [1_500, 1_500],
    );
    assert.equal(
        harness.logEntries.find((entry) => entry.event === "agents.remote.start.response")?.payload?.status,
        "queued",
    );
    assert.deepEqual(
        harness.logEntries
            .filter((entry) => entry.event === "agents.remote.poll.requested")
            .map((entry) => ({
                requestKind: entry.payload?.requestKind,
                afterCursor: entry.payload?.afterCursor,
                waitMs: entry.payload?.waitMs,
            })),
        [
            { requestKind: "poll", afterCursor: "evt-1", waitMs: 1_500 },
            { requestKind: "poll", afterCursor: "evt-2", waitMs: 1_500 },
        ],
    );
    assert.deepEqual(
        harness.logEntries
            .filter((entry) => entry.event === "agents.remote.poll.response")
            .map((entry) => ({
                status: entry.payload?.status,
                cursor: entry.payload?.cursor,
                eventCount: entry.payload?.eventCount,
                progressEventCount: entry.payload?.progressEventCount,
                outputDeltaEventCount: entry.payload?.outputDeltaEventCount,
            })),
        [
            {
                status: "running",
                cursor: "evt-2",
                eventCount: 2,
                progressEventCount: 1,
                outputDeltaEventCount: 1,
            },
            {
                status: "completed",
                cursor: "evt-3",
                eventCount: 0,
                progressEventCount: 0,
                outputDeltaEventCount: 0,
            },
        ],
    );
});

test("comment agent controller auto-cancels remote runs after 3 minutes without reply text", async () => {
    const harness = createHarness({
        nowIncrement: 70_000,
        runtimeSelection: {
            kind: "resolved",
            runtime: "openclaw-acp",
            modePreference: "remote",
            ownershipMessage: "Using remote runtime",
        },
        startRemoteRuntimeRun: async () => ({
            httpStatus: 200,
            status: "running",
            cursor: "evt-1",
            runId: "remote-run-1",
            events: [{ type: "progress", text: "Queued remotely" }],
            replyText: null,
            error: null,
        }),
        pollRemoteRuntimeRun: async () => ({
            httpStatus: 200,
            status: "running",
            cursor: "evt-1",
            runId: "remote-run-1",
            events: [],
            replyText: null,
            error: null,
        }),
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "cancelled");
    assert.match(latestRun?.error ?? "", /3 minutes/i);
    assert.match(latestRun?.error ?? "", /without a response/i);
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "");
    assert.deepEqual(harness.remoteCancelCalls, ["remote-run-1"]);
    assert.equal(
        harness.logEntries.find((entry) => entry.event === "agents.remote.auto_cancelled")?.payload?.cursor,
        "evt-1",
    );
});

test("comment agent controller runs remote jobs in parallel across different threads", async () => {
    const pollResolvers = new Map<string, () => void>();
    let nextRunIndex = 0;
    const harness = createHarness({
        initialComments: [
            createComment({
                id: "thread-1",
                filePath: "Folder/Note.md",
                comment: "@codex review the first thread",
            }),
            createComment({
                id: "thread-2",
                filePath: "Folder/Note.md",
                comment: "@codex review the second thread",
                selectedText: "Beta",
            }),
        ],
        runtimeSelection: {
            kind: "resolved",
            runtime: "openclaw-acp",
            modePreference: "remote",
            ownershipMessage: "Using remote runtime",
        },
        startRemoteRuntimeRun: async () => ({
            httpStatus: 200,
            status: "queued",
            cursor: null,
            runId: `remote-run-${++nextRunIndex}`,
            events: [],
            replyText: null,
            error: null,
        }),
        pollRemoteRuntimeRun: async (runId) => {
            await new Promise<void>((resolve) => {
                pollResolvers.set(runId, resolve);
            });
            return {
                httpStatus: 200,
                status: "completed",
                cursor: `${runId}-done`,
                runId,
                events: [],
                replyText: `Done ${runId}`,
                error: null,
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review the first thread",
    });
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Folder/Note.md",
        body: "@codex review the second thread",
    });

    for (let attempt = 0; attempt < 40 && harness.remoteStartCalls.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    for (let attempt = 0; attempt < 40 && pollResolvers.size < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(harness.remoteStartCalls.length, 2);
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "running");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-2")?.status, "running");

    pollResolvers.get("remote-run-1")?.();
    pollResolvers.get("remote-run-2")?.();
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "succeeded");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-2")?.status, "succeeded");
});

test("comment agent controller runs local jobs in parallel across different threads", async () => {
    const runtimeResolvers: Array<() => void> = [];
    let replyIndex = 0;
    const harness = createHarness({
        initialComments: [
            createComment({
                id: "thread-1",
                filePath: "Folder/Note.md",
                comment: "@codex review the first local thread",
            }),
            createComment({
                id: "thread-2",
                filePath: "Folder/Note.md",
                comment: "@codex review the second local thread",
                selectedText: "Beta",
            }),
        ],
        customRunAgentRuntime: async () => {
            await new Promise<void>((resolve) => {
                runtimeResolvers.push(resolve);
            });
            replyIndex += 1;
            return {
                runtime: "direct-cli",
                replyText: `Local reply ${replyIndex}`,
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review the first local thread",
    });
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Folder/Note.md",
        body: "@codex review the second local thread",
    });

    for (let attempt = 0; attempt < 40 && harness.runtimeCalls.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(harness.runtimeCalls.length, 2);
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "running");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-2")?.status, "running");

    runtimeResolvers.splice(0).forEach((resolve) => resolve());
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "succeeded");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-2")?.status, "succeeded");
});

test("comment agent controller runs local jobs in parallel within the same thread", async () => {
    const runtimeResolvers: Array<() => void> = [];
    let replyIndex = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            await new Promise<void>((resolve) => {
                runtimeResolvers.push(resolve);
            });
            replyIndex += 1;
            return {
                runtime: "direct-cli",
                replyText: `Local same-thread reply ${replyIndex}`,
            };
        },
    });
    harness.commentManager.editComment("thread-1", "@codex review the parent");
    harness.commentManager.appendEntry("thread-1", {
        id: "entry-2",
        body: "@codex review the follow-up",
        timestamp: 20,
    });
    harness.commentManager.appendEntry("thread-1", {
        id: "entry-3",
        body: "Later child",
        timestamp: 30,
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review the parent",
    });
    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "entry-2",
        filePath: "Folder/Note.md",
        body: "@codex review the follow-up",
    });

    for (let attempt = 0; attempt < 40 && harness.runtimeCalls.length < 2; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }

    assert.equal(harness.runtimeCalls.length, 2);
    const runningRuns = harness.controller.getAgentRuns()
        .filter((run) => run.status === "running")
        .slice()
        .sort((left, right) => (
            left.createdAt !== right.createdAt
                ? left.createdAt - right.createdAt
                : left.id.localeCompare(right.id)
        ));
    assert.equal(runningRuns.length, 2);
    assert.deepEqual(runningRuns.map((run) => run.triggerEntryId), ["thread-1", "entry-2"]);

    const parentOutputEntryId = runningRuns[0]?.outputEntryId ?? null;
    const childOutputEntryId = runningRuns[1]?.outputEntryId ?? null;
    assert.ok(parentOutputEntryId);
    assert.ok(childOutputEntryId);
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "thread-1",
    }, {
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "entry-2",
    }]);
    assert.deepEqual(
        harness.commentManager.getThreadById("thread-1")?.entries.map((entry) => entry.id),
        ["thread-1", parentOutputEntryId, "entry-2", childOutputEntryId, "entry-3"],
    );

    runtimeResolvers.splice(0).forEach((resolve) => resolve());
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(
        harness.controller.getAgentRuns().filter((run) => run.status === "succeeded").length,
        2,
    );
    assert.deepEqual(
        [parentOutputEntryId, childOutputEntryId]
            .map((commentId) => harness.commentManager.getCommentById(commentId)?.comment ?? "")
            .slice()
            .sort(),
        ["Local same-thread reply 1", "Local same-thread reply 2"],
    );
});

test("comment agent controller inserts child-triggered replies after the triggering child entry", async () => {
    const harness = createHarness({
        runtimeReplyText: "Placed reply.",
    });
    harness.commentManager.editComment("thread-1", "Parent");
    harness.commentManager.appendEntry("thread-1", {
        id: "entry-2",
        body: "@codex answer here",
        timestamp: 20,
    });
    harness.commentManager.appendEntry("thread-1", {
        id: "entry-3",
        body: "Later child",
        timestamp: 30,
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "entry-2",
        filePath: "Folder/Note.md",
        body: "@codex answer here",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "entry-2",
    }]);
    assert.deepEqual(
        harness.commentManager.getThreadById("thread-1")?.entries.map((entry) => entry.id),
        ["thread-1", "entry-2", "generated-2", "entry-3"],
    );
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Placed reply.");
});

test("comment agent controller regenerates a specific reply run using the current saved directive text", async () => {
    let replyCount = 0;
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => ({
            runtime: "direct-cli",
            replyText: replyCount++ === 0 ? "First reply" : "Second reply",
        }),
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex old prompt",
    });
    await waitForAgentQueueToDrain(harness.controller);

    harness.commentManager.editComment("thread-1", "@codex explain the diff");

    const started = await harness.controller.retryRun("generated-1");
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(started, true);
    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.requestedAgent, "codex");
    assert.equal(latestRun?.retryOfRunId, "generated-1");
    assert.equal(harness.runtimeCalls.at(-1)?.target, "codex");
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "thread-1",
    }]);
    assert.deepEqual(harness.editedEntries, [{
        commentId: "generated-2",
        body: "First reply",
    }, {
        commentId: "generated-2",
        body: "Second reply",
    }]);
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Second reply");
});

test("comment agent controller keeps failed runs retryable through the same output entry", async () => {
    let attempt = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error("Runtime exploded");
            }

            return {
                runtime: "direct-cli",
                replyText: "Recovered reply",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex recover this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const failedRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(failedRun?.status, "failed");
    assert.equal(failedRun?.outputEntryId, "generated-2");
    assert.match(harness.commentManager.getCommentById("generated-2")?.comment ?? "", /Runtime exploded/);

    const started = await harness.controller.retryRun("generated-1");
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(started, true);
    const retriedRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retriedRun?.status, "succeeded");
    assert.equal(retriedRun?.retryOfRunId, "generated-1");
    assert.equal(retriedRun?.outputEntryId, "generated-2");
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "thread-1",
    }]);
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Recovered reply");
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

test("comment agent controller packs note path, section context, and transcript into the runtime prompt", async () => {
    const harness = createHarness({
        currentNoteContent: [
            "# Project",
            "",
            "Overview",
            "",
            "## Focus",
            "",
            "Alpha detail",
            "Beta detail",
            "",
            "## Later",
            "",
            "Gamma detail",
        ].join("\n"),
        initialComments: [createComment({
            anchorKind: "page",
            startLine: 4,
            comment: "@codex summarize the focus section",
        })],
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex summarize the focus section",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const prompt = harness.runtimeCalls[0]?.prompt ?? "";
    assert.match(prompt, /Note path: Folder\/Note\.md/);
    assert.match(prompt, /Scope: section/);
    assert.match(prompt, /Section:\n<<<\n## Focus\n\nAlpha detail\nBeta detail\n>>>/);
    assert.match(prompt, /Thread:\n- You \(current\): @codex summarize the focus section/);
    assert.match(prompt, /Request:\n<<<\n@codex summarize the focus section\n>>>/);
    assert.doesNotMatch(prompt, /Gamma detail/);
});

test("comment agent controller resumes a persisted remote run after restart instead of failing it", async () => {
    const harness = createHarness({
        initialPersistedData: {
            agentRuns: [{
                id: "run-1",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "openclaw-acp",
                status: "running",
                promptText: "@codex continue",
                createdAt: 100,
                startedAt: 101,
                remoteExecutionId: "remote-run-1",
                remoteCursor: "evt-1",
            }],
        },
        runtimeSelection: {
            kind: "resolved",
            runtime: "openclaw-acp",
            modePreference: "auto",
            ownershipMessage: "Using remote runtime",
        },
        pollRemoteRuntimeRun: async (_runId, afterCursor) => ({
            httpStatus: 200,
            status: "completed",
            cursor: "evt-2",
            runId: "remote-run-1",
            events: [],
            replyText: afterCursor === "evt-1" ? "Resumed reply" : "Unexpected",
            error: null,
        }),
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.remoteExecutionId, "remote-run-1");
    assert.equal(latestRun?.remoteCursor, "evt-2");
    assert.equal(harness.editedEntries.at(-1)?.body, "Resumed reply");
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
    assert.deepEqual(squashConsecutiveValues(streamUpdates).slice(0, 2), ["", "Hello"]);
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText, "Hello");
    assert.equal(harness.getRefreshCount(), 2);

    releaseRuntime();
    await waitForAgentQueueToDrain(harness.controller);
    unsubscribe();

    const finalStream = harness.controller.getActiveAgentStreamForThread("thread-1");
    assert.equal(finalStream, null);
    assert.deepEqual(squashConsecutiveValues(streamUpdates), ["", "Hello", "Hello there", null]);
    assert.equal(harness.getRefreshCount(), 3);
});

test("comment agent controller keeps running streams free of stage labels", async () => {
    let releaseRuntime: () => void = () => {
        throw new Error("Expected runtime release callback to be set.");
    };
    const statusUpdates: Array<string | null> = [];
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            await new Promise<void>((resolve) => {
                releaseRuntime = () => resolve();
            });
            invocation.onPartialText?.("Draft reply");
            return {
                runtime: "direct-cli",
                replyText: "Draft reply",
            };
        },
    });
    const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
        statusUpdates.push(update.stream?.statusText ?? null);
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex stage this",
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.deepEqual(squashConsecutiveValues(statusUpdates), [null]);

    releaseRuntime();
    await waitForAgentQueueToDrain(harness.controller);
    unsubscribe();

    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "succeeded");
});

test("comment agent controller shows real progress text while the runtime is still working", async () => {
    let releaseRuntime: () => void = () => {
        throw new Error("Expected runtime release callback to be set.");
    };
    const hintUpdates: Array<string | null> = [];
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            invocation.onProgressText?.("Reviewing the surrounding section");
            await new Promise<void>((resolve) => {
                releaseRuntime = () => resolve();
            });
            invocation.onPartialText?.("Draft reply");
            return {
                runtime: "direct-cli",
                replyText: "Draft reply",
            };
        },
    });
    const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
        hintUpdates.push(update.stream?.statusHintText ?? null);
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex show progress",
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(
        harness.controller.getActiveAgentStreamForThread("thread-1")?.statusHintText,
        "Reviewing the surrounding section",
    );
    assert.ok(hintUpdates.includes("Reviewing the surrounding section"));

    releaseRuntime();
    await waitForAgentQueueToDrain(harness.controller);
    unsubscribe();
});

test("comment agent controller cancels a running run without reviving the stream", async () => {
    let waitForAbort: Promise<void> | null = null;
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            invocation.onPartialText?.("Partial answer");
            waitForAbort = new Promise<void>((resolve) => {
                invocation.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
            });
            await waitForAbort;
            throw new Error("Runtime cancelled");
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex cancel this",
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText, "Partial answer");

    const cancelled = await harness.controller.cancelRun("generated-1");
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(cancelled, true);
    assert.equal(waitForAbort !== null, true);
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.status, "cancelled");
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.statusText, "Cancelled");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "cancelled");
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Partial answer");
});

test("comment agent controller keeps the cancelled reply card when no text has streamed yet", async () => {
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            await new Promise<void>((resolve) => {
                invocation.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
            });
            throw new Error("Runtime cancelled");
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex cancel before reply",
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    const cancelled = await harness.controller.cancelRun("generated-1");
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(cancelled, true);
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.status, "cancelled");
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "cancelled");
});

test("comment agent controller marks thread runs cancelled before delete flow continues", async () => {
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            await new Promise<void>((resolve) => {
                invocation.abortSignal?.addEventListener("abort", () => resolve(), { once: true });
            });
            throw new Error("Runtime cancelled");
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex remove this",
    });

    await new Promise((resolve) => setTimeout(resolve, 120));
    await harness.controller.cancelRunsForComment("thread-1");
    await new Promise((resolve) => setTimeout(resolve, 40));

    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.status, "cancelled");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "cancelled");
});

test("comment agent controller refreshes views only after the stream targets the persisted reply entry", async () => {
    const refreshSnapshots: Array<{
        status: string | null;
        outputEntryId: string | null;
    }> = [];
    const harness = createHarness({
        runtimeReplyText: "Stable reply",
        onRefreshCommentViews: (controller) => {
            const stream = controller.getActiveAgentStreamForThread("thread-1");
            refreshSnapshots.push({
                status: stream?.status ?? null,
                outputEntryId: stream?.outputEntryId ?? null,
            });
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.deepEqual(refreshSnapshots.at(-1), {
        status: "succeeded",
        outputEntryId: "generated-2",
    });
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

    assert.deepEqual(
        squashConsecutiveValues(streamUpdates),
        ["", Array.from({ length: 12 }, (_value, index) => `Line ${index + 1}`).join("\n"), null],
    );
    assert.equal(harness.appendedEntries[0]?.body, "");
    assert.equal(harness.editedEntries[0]?.body, Array.from({ length: 12 }, (_value, index) => `Line ${index + 1}`).join("\n"));
    assert.equal(harness.getRefreshCount(), 3);
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

import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import { AgentRunStore } from "../src/agents/agentRunStore";
import { CommentAgentController } from "../src/agents/commentAgentController";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import type { AgentRuntimeSelection } from "../src/agents/agentRuntimeSelection";

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
    availableFilePaths?: string[];
    runtimeSelection?: AgentRuntimeSelection;
    customRunAgentRuntime?: (invocation: {
        target: "codex" | "claude";
        prompt: string;
        cwd: string;
        vaultRootPath?: string | null;
        onPartialText?: (partialText: string) => void;
        onProgressText?: (progressText: string) => void;
        abortSignal?: AbortSignal;
    }) => Promise<{
        runtime: "direct-cli";
        replyText: string;
        usedTools?: string[];
        usedUrls?: string[];
        usedToolErrors?: Array<{ name: string; payload: string }>;
    }>;
} = {}) {
    let persistedData: PersistedPluginData = options.initialPersistedData ?? {};
    const commentManager = new CommentManager(options.initialComments ?? [createComment()]);
    const defaultFilePath = (options.initialComments?.[0] ?? createComment()).filePath;
    const availableFilePaths = new Set(options.availableFilePaths ?? [defaultFilePath]);
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
    const runtimeSelectionCalls: Array<"codex" | "claude"> = [];
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
        getFileByPath: (filePath: string) => availableFilePaths.has(filePath) ? createFile(filePath) : null,
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
        resolveAgentRuntimeSelection: async (target: "codex" | "claude") => {
            runtimeSelectionCalls.push(target);
            return options.runtimeSelection ?? {
                kind: "resolved",
                runtime: "direct-cli",
                modePreference: "auto",
                ownershipMessage: `Using your local ${target === "claude" ? "Claude" : "Codex"} setup`,
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
        runtimeSelectionCalls,
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
    assert.deepEqual(latestRun?.usedSkills, [{
        name: "aside",
        mode: "write",
        source: "built-in",
    }]);
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
    assert.deepEqual(
        harness.logEntries
            .filter((entry) => entry.event === "agents.skill.selected")
            .map((entry) => entry.payload),
        [{
            runId: latestRun?.id,
            threadId: "thread-1",
            entryId: "thread-1",
            requestedAgent: "codex",
            skill: "aside",
            mode: "write",
            source: "built-in",
        }],
    );
});

test("comment agent controller removes orphan duplicate replies created during completion", async () => {
    let harness: ReturnType<typeof createHarness>;
    harness = createHarness({
        customRunAgentRuntime: async () => {
            const activeStream = harness.controller.getActiveAgentStreamForThread("thread-1");
            harness.commentManager.appendEntry("thread-1", {
                id: "orphan-duplicate",
                body: "Ship it.",
                timestamp: activeStream?.startedAt ?? 0,
            });
            return {
                runtime: "direct-cli",
                replyText: "Ship it.",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const entries = harness.commentManager.getAllThreads({ includeDeleted: true })
        .find((thread) => thread.id === "thread-1")?.entries ?? [];
    const visibleDuplicateBodies = entries
        .filter((entry) => !entry.deletedAt && entry.body === "Ship it.")
        .map((entry) => entry.id);
    assert.deepEqual(visibleDuplicateBodies, ["generated-2"]);
});

test("comment agent controller dispatches claude as a peer provider", async () => {
    const harness = createHarness({
        runtimeReplyText: "Claude reply.",
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@claude review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.requestedAgent, "claude");
    assert.deepEqual(harness.runtimeSelectionCalls, ["claude"]);
    assert.equal(harness.runtimeCalls[0]?.target, "claude");
    assert.deepEqual(latestRun?.usedSkills, [{
        name: "aside",
        mode: "write",
        source: "built-in",
    }]);
    assert.deepEqual(harness.editedEntries, [{
        commentId: "generated-2",
        body: "Claude reply.",
    }]);
});

test("comment agent controller treats mixed supported agents as a conflict", async () => {
    const harness = createHarness();

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex and @claude compare this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.deepEqual(harness.notices, ["Use only one explicit supported agent target per side note."]);
    assert.deepEqual(harness.runtimeCalls, []);
});

test("comment agent controller persists runtime tool and url metadata", async () => {
    const harness = createHarness({
        customRunAgentRuntime: async () => ({
            runtime: "direct-cli",
            replyText: "Ship it.",
            usedTools: ["browser-use.browser_navigate"],
            usedUrls: ["http://localhost:3000/dashboard?token=secret#debug"],
            usedToolErrors: [{
                name: "WebSearch",
                payload: "unavailable",
            }],
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
    assert.equal(latestRun?.status, "succeeded");
    assert.deepEqual(latestRun?.usedTools, ["browser-use.browser_navigate", "WebSearch (unavailable)"]);
    assert.deepEqual(latestRun?.usedUrls, ["http://localhost:3000/dashboard"]);
    assert.deepEqual(latestRun?.usedToolErrors, [{
        name: "WebSearch",
        payload: "unavailable",
    }]);
});

test("comment agent controller blocks a run when runtime selection is unavailable", async () => {
    const harness = createHarness({
        runtimeSelection: {
            kind: "blocked",
            modePreference: "auto",
            notice: "Built-in @codex requires desktop Obsidian.",
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex review this",
    });

    assert.deepEqual(harness.notices, ["Built-in @codex requires desktop Obsidian."]);
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1"), null);
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
        body: "",
    }, {
        commentId: "generated-2",
        body: "Second reply",
    }]);
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Second reply");
});

test("comment agent controller clears the previous retry reply before the regenerated runtime completes", async () => {
    let resolveSecondReply!: (replyText: string) => void;
    const secondReply = new Promise<string>((resolve) => {
        resolveSecondReply = resolve;
    });
    let replyCount = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            replyCount += 1;
            if (replyCount === 1) {
                return {
                    runtime: "direct-cli",
                    replyText: "First reply",
                };
            }

            return {
                runtime: "direct-cli",
                replyText: await secondReply,
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex old prompt",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const started = await harness.controller.retryRun("generated-1");

    assert.equal(started, true);
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "");
    assert.deepEqual(harness.editedEntries.slice(-1), [{
        commentId: "generated-2",
        body: "",
    }]);

    resolveSecondReply("Second reply");
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Second reply");
});

test("comment agent controller can retry a saved agent prompt when run metadata is missing", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            id: "thread-1",
            filePath: "Folder/Note.md",
            comment: "@codex recover this prompt",
        })],
        runtimeReplyText: "Recovered from prompt",
    });

    const started = await harness.controller.retryPromptForComment("thread-1", "Folder/Note.md");
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(started, true);
    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.requestedAgent, "codex");
    assert.equal(latestRun?.retryOfRunId, undefined);
    assert.equal(harness.runtimeCalls.at(-1)?.target, "codex");
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "thread-1",
    }]);
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Recovered from prompt");
});

test("comment agent controller retries a renamed thread when old run output is missing", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            id: "thread-1",
            filePath: "Folder/Renamed.md",
            comment: "@codex recover after rename",
        })],
        availableFilePaths: ["Folder/Renamed.md"],
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Original.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "succeeded",
                promptText: "@codex recover after rename",
                createdAt: 10,
                startedAt: 11,
                endedAt: 12,
                outputEntryId: "missing-output-entry",
            }],
        },
        runtimeReplyText: "Recovered after rename",
    });

    const started = await harness.controller.retryRun("run-old");
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(started, true);
    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.retryOfRunId, "run-old");
    assert.equal(latestRun?.filePath, "Folder/Renamed.md");
    assert.notEqual(latestRun?.outputEntryId, "missing-output-entry");
    assert.deepEqual(harness.appendedEntries, [{
        threadId: "thread-1",
        body: "",
        insertAfterCommentId: "thread-1",
    }]);
    assert.equal(harness.commentManager.getCommentById(latestRun?.outputEntryId ?? "")?.comment, "Recovered after rename");
    assert.deepEqual(harness.notices, []);
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
        runtimeWorkingDirectory: "/vault/Aside",
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Aside/Note.md",
        body: "@codex inspect this repo",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault/Aside");
});

test("comment agent controller packs note path, page context, and transcript into the runtime prompt", async () => {
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
    assert.match(prompt, /Scope: page/);
    assert.match(prompt, /Page:\n<<<\n# Project\n\nOverview\n\n## Focus\n\nAlpha detail\nBeta detail\n\n## Later\n\nGamma detail\n>>>/);
    assert.match(prompt, /Thread:\n- You \(current\): @codex summarize the focus section/);
    assert.match(prompt, /Request:\n<<<\n@codex summarize the focus section\n>>>/);
});

test("comment agent controller marks persisted in-flight runs failed after restart", async () => {
    const harness = createHarness({
        initialPersistedData: {
            agentRuns: [{
                id: "run-1",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "running",
                promptText: "@codex continue",
                createdAt: 100,
                startedAt: 101,
            }],
        },
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "failed");
    assert.equal(latestRun?.error, "The previous Aside agent run did not finish. Retry the thread to run it again.");
    assert.deepEqual(harness.editedEntries, []);
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

test("comment agent controller keeps process log lines separate from streamed reply text", async () => {
    let releaseRuntime: () => void = () => {
        throw new Error("Expected runtime release callback to be set.");
    };
    const processLogUpdates: string[][] = [];
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            invocation.onProgressText?.("Reading thread context");
            invocation.onProgressText?.("Running command: rg \"Codex\" src");
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
        processLogUpdates.push(update.stream?.processLogLines ?? []);
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex show process",
    });

    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(
        harness.controller.getActiveAgentStreamForThread("thread-1")?.processLogLines,
        [
            "Reading thread context",
            "Running command: rg \"Codex\" src",
        ],
    );
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText, "");
    assert.deepEqual(
        processLogUpdates.filter((lines) => lines.length > 0).at(-1),
        [
            "Reading thread context",
            "Running command: rg \"Codex\" src",
        ],
    );

    releaseRuntime();
    await waitForAgentQueueToDrain(harness.controller);
    unsubscribe();

    assert.equal(harness.editedEntries.at(-1)?.body, "Draft reply");
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

test("comment agent controller refreshes views after clearing the completed stream", async () => {
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

    assert.ok(refreshSnapshots.some((snapshot) =>
        snapshot.status === "running"
        && snapshot.outputEntryId === "generated-2"
    ));
    assert.deepEqual(refreshSnapshots.at(-1), {
        status: null,
        outputEntryId: null,
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

test("comment agent controller ignores entries without explicit agent mentions", async () => {
    const harness = createHarness();

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.deepEqual(harness.notices, []);
    assert.deepEqual(harness.runtimeCalls, []);
});

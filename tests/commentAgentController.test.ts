import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import { AgentRunStore } from "../src/agents/agentRunStore";
import { CommentAgentController } from "../src/agents/commentAgentController";
import type { AgentRunRecord, AgentRunStreamState } from "../src/core/agents/agentRuns";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import type {
    AgentRuntimeSelection,
    DefaultAgentRuntimeSelection,
} from "../src/agents/agentRuntimeSelection";
import type {
    AgentRuntimeInvocation,
    AgentRuntimeResult,
} from "../src/agents/agentRuntimeAdapter";
import {
    getAgentActorLabel,
    getSupportedAgentActors,
} from "../src/core/agents/agentActorRegistry";
import type { AsideAgentTarget } from "../src/core/config/agentTargets";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";
import {
    executeSidebarCommentRegenerateAction,
    getSidebarCommentRegenerateAction,
} from "../src/ui/views/sidebarPersistedComment";

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
    currentNoteContentError?: Error;
    customGetCurrentNoteContent?: (file: TFile) => Promise<string>;
    customLoadCommentsForFile?: (file: TFile) => Promise<void>;
    runtimeReplyText?: string;
    runtimeError?: Error;
    runtimeStreamTexts?: string[];
    nowIncrement?: number;
    onRefreshCommentViews?: (controller: CommentAgentController) => void | Promise<void>;
    initialComments?: Comment[];
    availableFilePaths?: string[];
    isCommentableFilePath?: (filePath: string) => boolean;
    isPageNoteCapableFilePath?: (filePath: string) => boolean;
    runtimeSelection?: AgentRuntimeSelection;
    resolveAgentRuntimeSelection?: (target: AsideAgentTarget) => Promise<AgentRuntimeSelection>;
    defaultRuntimeSelection?: DefaultAgentRuntimeSelection;
    resolveDefaultAgentRuntimeSelection?: () => Promise<DefaultAgentRuntimeSelection>;
    customRunAgentRuntime?: (invocation: AgentRuntimeInvocation) => Promise<AgentRuntimeResult>;
    beforePersistedRunUpdate?: (
        nextRuns: AgentRunRecord[],
        previousRuns: AgentRunRecord[],
    ) => Promise<void>;
    customAppendThreadEntry?: () => Promise<void>;
    customCommitThreadEntry?: (
        entry: { id: string; body: string },
        commentManager: CommentManager,
    ) => Promise<boolean | void>;
    customHashText?: (text: string) => Promise<string>;
    customBeforeEditComment?: () => Promise<void>;
    customEditComment?: (commentId: string, newCommentText: string) => Promise<void>;
    resolveEditCommentResult?: (
        commentId: string,
        newCommentText: string,
        commentManager: CommentManager,
    ) => boolean;
    failSucceededRunUpdateAttempts?: number;
    registeredScriptPaths?: string[];
    scriptsEnabled?: boolean | (() => boolean);
} = {}) {
    let persistedData: PersistedPluginData = options.initialPersistedData ?? {};
    const commentManager = new CommentManager(options.initialComments ?? [createComment()]);
    const defaultFilePath = (options.initialComments?.[0] ?? createComment()).filePath;
    const availableFilePaths = new Set(options.availableFilePaths ?? [defaultFilePath]);
    const appendedEntries: Array<{ threadId: string; body: string; insertAfterCommentId?: string }> = [];
    const committedEntries: Array<{ filePath: string; threadId: string; id: string; body: string; insertAfterCommentId?: string }> = [];
    const editedEntries: Array<{ commentId: string; body: string }> = [];
    const persistedFiles: Array<{ path: string; skipCommentViewRefresh?: boolean }> = [];
    const notices: string[] = [];
    const logEntries: Array<{
        level: "info" | "warn" | "error";
        area: string;
        event: string;
        payload?: Record<string, unknown>;
    }> = [];
    const runtimeCalls: AgentRuntimeInvocation[] = [];
    const runtimeSelectionCalls: AsideAgentTarget[] = [];
    const currentNoteContentReads: string[] = [];
    const vaultScriptRegistry = new VaultScriptRegistry();
    vaultScriptRegistry.seed(options.registeredScriptPaths ?? []);
    let defaultRuntimeSelectionCalls = 0;
    let failedSucceededRunUpdates = 0;
    let refreshCount = 0;
    let idCounter = 1;
    let now = 100;
    const nowIncrement = options.nowIncrement ?? 1;
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            const nextData = updater({ ...persistedData });
            const nextRuns = Array.isArray(nextData.agentRuns)
                ? nextData.agentRuns as AgentRunRecord[]
                : [];
            const previousRuns = Array.isArray(persistedData.agentRuns)
                ? persistedData.agentRuns as AgentRunRecord[]
                : [];
            await options.beforePersistedRunUpdate?.(nextRuns, previousRuns);
            if (
                failedSucceededRunUpdates < (options.failSucceededRunUpdateAttempts ?? 0)
                && nextRuns.some((run) => run.status === "succeeded")
                && !previousRuns.some((run) => run.status === "succeeded")
            ) {
                failedSucceededRunUpdates += 1;
                throw new Error("run metadata unavailable");
            }
            persistedData = nextData;
            return { ...persistedData };
        },
    });

    const controller = new CommentAgentController({
        isScriptsEnabled: () => typeof options.scriptsEnabled === "function"
            ? options.scriptsEnabled()
            : options.scriptsEnabled ?? true,
        createCommentId: () => `generated-${idCounter++}`,
        now: () => {
            now += nowIncrement;
            return now;
        },
        getPluginVersion: () => "2.0.39",
        getVaultRootPath: () => "/vault-root",
        refreshCommentViews: async () => {
            refreshCount += 1;
            await options.onRefreshCommentViews?.(controller);
        },
        getRuntimeWorkingDirectory: () => options.runtimeWorkingDirectory === undefined ? "/vault" : options.runtimeWorkingDirectory,
        getCommentManager: () => commentManager,
        getFileByPath: (filePath: string) => availableFilePaths.has(filePath) ? createFile(filePath) : null,
        getFilePaths: () => Array.from(availableFilePaths),
        isCommentableFile: (candidate): candidate is TFile => (
            !!candidate
            && (options.isCommentableFilePath?.(candidate.path) ?? true)
        ),
        isPageNoteCapableFile: (candidate): candidate is TFile => (
            !!candidate
            && (options.isPageNoteCapableFilePath?.(candidate.path) ?? true)
        ),
        getCurrentNoteContent: async (file) => {
            currentNoteContentReads.push(file.path);
            if (options.customGetCurrentNoteContent) {
                return options.customGetCurrentNoteContent(file);
            }
            if (options.currentNoteContentError) {
                throw options.currentNoteContentError;
            }
            return options.currentNoteContent ?? "";
        },
        loadCommentsForFile: async (file) => options.customLoadCommentsForFile?.(file),
        hashText: async (text) => options.customHashText?.(text) ?? `hash:${text}`,
        persistCommentsForFile: async (file, persistOptions) => {
            persistedFiles.push({
                path: file.path,
                ...(persistOptions?.skipCommentViewRefresh !== undefined
                    ? { skipCommentViewRefresh: persistOptions.skipCommentViewRefresh }
                    : {}),
            });
        },
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
            await options.customAppendThreadEntry?.();
            return true;
        },
        commitThreadEntry: async (filePath, threadId, entry, commitOptions) => {
            committedEntries.push({
                filePath,
                threadId,
                id: entry.id,
                body: entry.body,
                ...(commitOptions?.insertAfterCommentId
                    ? { insertAfterCommentId: commitOptions.insertAfterCommentId }
                    : {}),
            });
            const customResult = await options.customCommitThreadEntry?.(entry, commentManager);
            if (customResult === false) {
                return false;
            }
            const currentEntry = commentManager.getCommentById(entry.id);
            if (
                commitOptions?.onlyIfEntryAbsentOrBlank
                && currentEntry
                && (currentEntry.deletedAt !== undefined || currentEntry.comment.trim().length > 0)
            ) {
                return true;
            }
            if (commentManager.getCommentById(entry.id)) {
                commentManager.editComment(entry.id, entry.body);
            } else {
                commentManager.appendEntry(threadId, entry);
                if (commitOptions?.insertAfterCommentId) {
                    commentManager.reorderThreadEntries(
                        threadId,
                        entry.id,
                        commitOptions.insertAfterCommentId,
                        "after",
                    );
                }
            }
            return true;
        },
        editComment: async (commentId, newCommentText) => {
            await options.customBeforeEditComment?.();
            editedEntries.push({ commentId, body: newCommentText });
            const edited = options.resolveEditCommentResult?.(
                commentId,
                newCommentText,
                commentManager,
            ) ?? true;
            if (edited) {
                commentManager.editComment(commentId, newCommentText);
            }
            await options.customEditComment?.(commentId, newCommentText);
            return edited;
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
        resolveAgentRuntimeSelection: async (target: AsideAgentTarget) => {
            runtimeSelectionCalls.push(target);
            return options.resolveAgentRuntimeSelection?.(target) ?? options.runtimeSelection ?? {
                kind: "resolved",
                runtime: "direct-cli",
                modePreference: "auto",
                ownershipMessage: `Using your local ${getAgentActorLabel(target)} setup`,
            };
        },
        resolveDefaultAgentRuntimeSelection: async () => {
            defaultRuntimeSelectionCalls += 1;
            return options.resolveDefaultAgentRuntimeSelection?.()
                ?? options.defaultRuntimeSelection
                ?? {
                    kind: "resolved",
                    selectedAgent: "codex",
                    runtime: "direct-cli",
                    modePreference: "auto",
                };
        },
        resolveVaultScriptMention: (mention) => vaultScriptRegistry.resolve(mention),
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
        committedEntries,
        editedEntries,
        persistedFiles,
        notices,
        logEntries,
        runtimeCalls,
        runtimeSelectionCalls,
        currentNoteContentReads,
        availableFilePaths,
        vaultScriptRegistry,
        getDefaultRuntimeSelectionCalls: () => defaultRuntimeSelectionCalls,
        getRefreshCount: () => refreshCount,
        getPersistedData: () => persistedData,
    };
}

test("create-script agent request queues the preferred available agent", async () => {
    const harness = createHarness({
        defaultRuntimeSelection: {
            kind: "resolved",
            selectedAgent: "claude",
            runtime: "direct-cli",
            modePreference: "auto",
        },
    });

    await harness.controller.handleCreateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/create-script build a cleaner",
    }, "build a cleaner");
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.requestKind, "create-script");
    assert.equal(latestRun?.preferredAgent, undefined);
    assert.equal(latestRun?.requestedAgent, "claude");
    assert.equal(latestRun?.promptText, "build a cleaner");
    assert.equal(harness.runtimeCalls[0]?.requestKind, "create-script");
});

test("create-script runs from the vault root instead of a nested note or repository directory", async () => {
    const harness = createHarness({
        runtimeWorkingDirectory: "/vault-root/Projects/NestedRepo",
        defaultRuntimeSelection: {
            kind: "resolved",
            selectedAgent: "codex",
            runtime: "direct-cli",
            modePreference: "auto",
        },
    });

    await harness.controller.handleCreateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Projects/NestedRepo/Folder/Note.md",
        body: "/create-script build a cleaner",
    }, "build a cleaner");
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault-root");
    assert.equal(harness.runtimeCalls[0]?.vaultRootPath, "/vault-root");
});

test("create-script returns immediately when no agent is available", async () => {
    const harness = createHarness({
        defaultRuntimeSelection: {
            kind: "none",
            preferredAgent: "gemini",
        },
    });

    await harness.controller.handleCreateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/create-script build a cleaner",
    }, "build a cleaner");

    assert.equal(harness.appendedEntries[0]?.body, "No agent is available to create the script.");
    assert.equal(harness.controller.getAgentRuns().length, 0);
    assert.equal(harness.runtimeCalls.length, 0);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 1);
});

test("pdf-to-markdown queues the preferred default agent from the vault root", async () => {
    const harness = createHarness({
        runtimeWorkingDirectory: "/vault-root/Books",
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        defaultRuntimeSelection: {
            kind: "resolved",
            selectedAgent: "claude",
            runtime: "direct-cli",
            modePreference: "auto",
        },
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const run = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(run?.requestKind, "pdf-to-markdown");
    assert.equal(run?.requestedAgent, "claude");
    assert.equal(run?.preferredAgent, undefined);
    assert.equal(run?.promptText, "/pdf-to-markdown");
    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault-root");
    assert.equal(harness.runtimeCalls[0]?.requestKind, "pdf-to-markdown");
});

test("pdf-to-markdown returns immediately when no agent is available", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        defaultRuntimeSelection: {
            kind: "none",
            preferredAgent: "gemini",
        },
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });

    assert.equal(harness.appendedEntries[0]?.body, "No agent is available to convert this PDF.");
    assert.equal(harness.controller.getAgentRuns().length, 0);
    assert.equal(harness.runtimeCalls.length, 0);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 1);
});

test("pdf-to-markdown preserves a case-variant existing sibling before agent selection", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.PDF",
            comment: "/pdf-to-markdown",
        })],
        availableFilePaths: ["Books/Guide.PDF", "Books/guide.MD"],
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.PDF",
        body: "/pdf-to-markdown",
    });

    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 0);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.controller.getAgentRuns(), []);
    assert.equal(
        harness.appendedEntries[0]?.body,
        "Conflict: `Books/Guide.md` already exists. It was not modified.",
    );
});

test("pdf-to-markdown serializes concurrent requests for one destination", async () => {
    let releaseFirstSelection = () => {};
    const firstSelectionBlocked = new Promise<void>((resolve) => {
        releaseFirstSelection = resolve;
    });
    const harness = createHarness({
        initialComments: [
            createComment({
                id: "thread-1",
                filePath: "Books/Guide.pdf",
                comment: "/pdf-to-markdown",
            }),
            createComment({
                id: "thread-2",
                filePath: "Books/Guide.pdf",
                comment: "/pdf-to-markdown",
            }),
        ],
        resolveDefaultAgentRuntimeSelection: async () => {
            await firstSelectionBlocked;
            return {
                kind: "resolved",
                selectedAgent: "codex",
                runtime: "direct-cli",
                modePreference: "auto",
            };
        },
    });

    const first = harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });

    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 1);
    assert.equal(
        harness.appendedEntries[0]?.body,
        "A PDF-to-Markdown conversion is already running for `Books/Guide.md`.",
    );

    releaseFirstSelection();
    await first;
    await waitForAgentQueueToDrain(harness.controller);
    assert.equal(harness.controller.getAgentRuns().length, 1);
});

test("pdf-to-markdown blocks a destination reserved by a persisted active run", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            id: "thread-2",
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        initialPersistedData: {
            agentRuns: [{
                id: "run-1",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Books/Guide.PDF",
                requestedAgent: "codex",
                requestKind: "pdf-to-markdown",
                runtime: "direct-cli",
                status: "running",
                promptText: "/pdf-to-markdown",
                createdAt: 100,
                startedAt: 101,
            }],
        },
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-2",
        entryId: "thread-2",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });

    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 0);
    assert.equal(
        harness.appendedEntries[0]?.body,
        "A PDF-to-Markdown conversion is already running for `Books/Guide.md`.",
    );
    assert.equal(harness.controller.getAgentRuns().length, 1);
});

test("pdf-to-markdown regenerate revalidates the current source before agent selection", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        availableFilePaths: ["Books/Guide.pdf"],
        runtimeError: new Error("agent failed after launch"),
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const previous = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(previous?.status, "failed");

    const selectionsBeforeRetry = harness.getDefaultRuntimeSelectionCalls();
    harness.commentManager.renameFile("Books/Guide.pdf", "Books/Guide.md", {
        selectionCapable: true,
        pageLabelHash: "hash-guide",
    });
    harness.availableFilePaths.delete("Books/Guide.pdf");
    harness.availableFilePaths.add("Books/Guide.md");

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), false);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), selectionsBeforeRetry);
    assert.equal(
        harness.appendedEntries.at(-1)?.body,
        "Open a PDF and use /pdf-to-markdown.",
    );
});

test("pdf-to-markdown regenerate preserves a case-variant sibling created after a failed run", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        runtimeError: new Error("agent failed after launch"),
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const previous = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(previous?.status, "failed");

    const selectionsBeforeRetry = harness.getDefaultRuntimeSelectionCalls();
    harness.availableFilePaths.add("Books/guide.MD");

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), false);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), selectionsBeforeRetry);
    assert.equal(
        harness.appendedEntries.at(-1)?.body,
        "Conflict: `Books/Guide.md` already exists. It was not modified.",
    );
});

test("update-script queues the resolved target and runs from the vault root", async () => {
    const harness = createHarness({
        runtimeWorkingDirectory: "/vault-root/Projects/NestedRepo",
        registeredScriptPaths: ["🛠️ scripts/embed-image-urls.mjs"],
    });
    const targetScript = harness.vaultScriptRegistry.resolve("/embed-image-urls");
    assert.ok(targetScript);

    await harness.controller.handleUpdateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/update-script /embed-image-urls make the default size reasonable",
    }, "make the default size reasonable", targetScript);
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.requestKind, "update-script");
    assert.equal(latestRun?.targetScriptPath, "🛠️ scripts/embed-image-urls.mjs");
    assert.deepEqual(latestRun?.usedFiles, [
        "Folder/Note.md",
        "🛠️ scripts/embed-image-urls.mjs",
    ]);
    assert.equal(harness.runtimeCalls[0]?.cwd, "/vault-root");
    assert.equal(harness.runtimeCalls[0]?.requestKind, "update-script");
    assert.equal(
        harness.runtimeCalls[0]?.targetScriptPath,
        "🛠️ scripts/embed-image-urls.mjs",
    );
});

test("update-script returns immediately when no agent is available", async () => {
    const harness = createHarness({
        registeredScriptPaths: ["🛠️ scripts/embed-image-urls.mjs"],
        defaultRuntimeSelection: {
            kind: "none",
            preferredAgent: "gemini",
        },
    });
    const targetScript = harness.vaultScriptRegistry.resolve("/embed-image-urls");
    assert.ok(targetScript);

    await harness.controller.handleUpdateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/update-script /embed-image-urls make the default smaller",
    }, "make the default smaller", targetScript);

    assert.equal(harness.appendedEntries[0]?.body, "No agent is available to update the script.");
    assert.equal(harness.controller.getAgentRuns().length, 0);
    assert.equal(harness.runtimeCalls.length, 0);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 1);
});

test("comment agent controller does not dispatch update-script after disposal", async () => {
    let releaseSelection: () => void = () => undefined;
    let markSelectionStarted: () => void = () => undefined;
    const selectionStarted = new Promise<void>((resolve) => {
        markSelectionStarted = resolve;
    });
    const blockedSelection = new Promise<void>((resolve) => {
        releaseSelection = resolve;
    });
    const harness = createHarness({
        registeredScriptPaths: ["🛠️ scripts/embed-image-urls.mjs"],
        resolveDefaultAgentRuntimeSelection: async () => {
            markSelectionStarted();
            await blockedSelection;
            return {
                kind: "resolved",
                selectedAgent: "codex",
                runtime: "direct-cli",
                modePreference: "auto",
            };
        },
    });
    const targetScript = harness.vaultScriptRegistry.resolve("/embed-image-urls");
    assert.ok(targetScript);

    const pendingDispatch = harness.controller.handleUpdateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/update-script /embed-image-urls make the default smaller",
    }, "make the default smaller", targetScript);
    await selectionStarted;
    harness.controller.dispose();
    releaseSelection();
    await pendingDispatch;

    assert.deepEqual(harness.controller.getAgentRuns(), []);
    assert.deepEqual(harness.runtimeCalls, []);
});

test("comment agent controller does not launch after disposal during prompt context loading", async () => {
    let releaseContext: () => void = () => undefined;
    let markContextStarted: () => void = () => undefined;
    const contextStarted = new Promise<void>((resolve) => {
        markContextStarted = resolve;
    });
    const blockedContext = new Promise<void>((resolve) => {
        releaseContext = resolve;
    });
    const harness = createHarness({
        customGetCurrentNoteContent: async () => {
            markContextStarted();
            await blockedContext;
            return "# Note";
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex continue",
    });
    await contextStarted;
    harness.controller.dispose();
    releaseContext();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(harness.runtimeCalls, []);
    assert.equal(harness.controller.getAgentRuns()[0]?.status, "queued");
});

test("comment agent controller does not launch after disposal during running-state persistence", async () => {
    let releaseRunningUpdate: () => void = () => undefined;
    let markRunningUpdateStarted: () => void = () => undefined;
    const runningUpdateStarted = new Promise<void>((resolve) => {
        markRunningUpdateStarted = resolve;
    });
    const blockedRunningUpdate = new Promise<void>((resolve) => {
        releaseRunningUpdate = resolve;
    });
    const harness = createHarness({
        beforePersistedRunUpdate: async (nextRuns, previousRuns) => {
            const entersRunning = nextRuns.some((run) => run.status === "running")
                && !previousRuns.some((run) => run.status === "running");
            if (entersRunning) {
                markRunningUpdateStarted();
                await blockedRunningUpdate;
            }
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex continue",
    });
    await runningUpdateStarted;
    harness.controller.dispose();
    releaseRunningUpdate();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(harness.runtimeCalls, []);
    assert.equal(harness.controller.getAgentRuns()[0]?.status, "running");
});

test("comment agent controller ignores a runtime completion after disposal", async () => {
    let releaseRuntime: () => void = () => undefined;
    let markRuntimeStarted: () => void = () => undefined;
    let markRuntimeReturned: () => void = () => undefined;
    const runtimeStarted = new Promise<void>((resolve) => {
        markRuntimeStarted = resolve;
    });
    const blockedRuntime = new Promise<void>((resolve) => {
        releaseRuntime = resolve;
    });
    const runtimeReturned = new Promise<void>((resolve) => {
        markRuntimeReturned = resolve;
    });
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            markRuntimeStarted();
            await blockedRuntime;
            markRuntimeReturned();
            return { runtime: "direct-cli", replyText: "Late reply" };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex continue",
    });
    await runtimeStarted;
    harness.controller.dispose();
    releaseRuntime();
    await runtimeReturned;
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(harness.committedEntries, []);
    assert.equal(harness.controller.getAgentRuns()[0]?.status, "running");
});

test("comment agent controller stops retry preparation after disposal", async () => {
    let releaseLoad: () => void = () => undefined;
    let markLoadStarted: () => void = () => undefined;
    const loadStarted = new Promise<void>((resolve) => {
        markLoadStarted = resolve;
    });
    const blockedLoad = new Promise<void>((resolve) => {
        releaseLoad = resolve;
    });
    const harness = createHarness({
        initialPersistedData: {
            agentRuns: [{
                id: "run-1",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "failed",
                promptText: "@codex continue",
                createdAt: 100,
                endedAt: 101,
                error: "Stopped",
            }],
        },
        customLoadCommentsForFile: async () => {
            markLoadStarted();
            await blockedLoad;
        },
        defaultRuntimeSelection: {
            kind: "none",
            preferredAgent: "codex",
        },
    });

    const retry = harness.controller.retryRun("run-1");
    await loadStarted;
    harness.controller.dispose();
    releaseLoad();

    assert.equal(await retry, false);
    assert.deepEqual(harness.appendedEntries, []);
    assert.equal(harness.controller.getAgentRuns().length, 1);
});

test("update-script regenerate reparses the latest request and re-resolves its target", async () => {
    let runtimeAttempt = 0;
    const harness = createHarness({
        initialComments: [createComment({
            comment: "/update-script /embed-image-urls make the default smaller",
        })],
        registeredScriptPaths: ["🛠️ scripts/embed-image-urls.mjs"],
        customRunAgentRuntime: async () => {
            runtimeAttempt += 1;
            if (runtimeAttempt === 1) {
                throw new Error("Codex failed after launch");
            }
            return {
                runtime: "direct-cli",
                replyText: "Updated /embed-image-urls.",
            };
        },
    });
    const targetScript = harness.vaultScriptRegistry.resolve("/embed-image-urls");
    assert.ok(targetScript);

    await harness.controller.handleUpdateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/update-script /embed-image-urls make the default smaller",
    }, "make the default smaller", targetScript);
    await waitForAgentQueueToDrain(harness.controller);
    const previous = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(previous?.status, "failed");

    harness.commentManager.editComment(
        "thread-1",
        "/update-script /embed-image-urls make the default reasonable",
    );
    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), true);
    await waitForAgentQueueToDrain(harness.controller);

    const retry = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retry?.requestKind, "update-script");
    assert.equal(retry?.promptText, "make the default reasonable");
    assert.equal(retry?.targetScriptPath, "🛠️ scripts/embed-image-urls.mjs");
    assert.equal(retry?.retryOfRunId, previous?.id);
    assert.equal(
        harness.runtimeCalls.at(-1)?.targetScriptPath,
        "🛠️ scripts/embed-image-urls.mjs",
    );
});

test("update-script regenerate follows a renamed target only when the latest command names it", async () => {
    let runtimeAttempt = 0;
    const harness = createHarness({
        initialComments: [createComment({
            comment: "/update-script /embed-image-urls make the default smaller",
        })],
        registeredScriptPaths: ["🛠️ scripts/embed-image-urls.mjs"],
        customRunAgentRuntime: async () => {
            runtimeAttempt += 1;
            if (runtimeAttempt === 1) {
                throw new Error("Codex failed after launch");
            }
            return {
                runtime: "direct-cli",
                replyText: "Updated renamed script.",
            };
        },
    });
    const targetScript = harness.vaultScriptRegistry.resolve("/embed-image-urls");
    assert.ok(targetScript);

    await harness.controller.handleUpdateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/update-script /embed-image-urls make the default smaller",
    }, "make the default smaller", targetScript);
    await waitForAgentQueueToDrain(harness.controller);
    const previous = harness.controller.getLatestAgentRunForThread("thread-1");

    harness.vaultScriptRegistry.rename(
        "🛠️ scripts/embed-image-urls.mjs",
        "🛠️ scripts/embed-image-urls-v2.mjs",
    );
    harness.commentManager.editComment(
        "thread-1",
        "/update-script /embed-image-urls-v2 make the default reasonable",
    );

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), true);
    await waitForAgentQueueToDrain(harness.controller);
    const retry = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retry?.promptText, "make the default reasonable");
    assert.equal(retry?.targetScriptPath, "🛠️ scripts/embed-image-urls-v2.mjs");
    assert.equal(
        harness.runtimeCalls.at(-1)?.targetScriptPath,
        "🛠️ scripts/embed-image-urls-v2.mjs",
    );
});

test("update-script regenerate stops before selection when the target disappears", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            comment: "/update-script /embed-image-urls make the default smaller",
        })],
        registeredScriptPaths: ["🛠️ scripts/embed-image-urls.mjs"],
        runtimeError: new Error("Codex failed after launch"),
    });
    const targetScript = harness.vaultScriptRegistry.resolve("/embed-image-urls");
    assert.ok(targetScript);

    await harness.controller.handleUpdateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/update-script /embed-image-urls make the default smaller",
    }, "make the default smaller", targetScript);
    await waitForAgentQueueToDrain(harness.controller);
    const previous = harness.controller.getLatestAgentRunForThread("thread-1");
    const selectionsBeforeRetry = harness.getDefaultRuntimeSelectionCalls();
    harness.vaultScriptRegistry.remove("🛠️ scripts/embed-image-urls.mjs");

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), false);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), selectionsBeforeRetry);
    assert.match(harness.appendedEntries.at(-1)?.body ?? "", /not available to update/iu);
});

test("update-script regenerate stops before selection when the target becomes ambiguous", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            comment: "/update-script /embed-image-urls make the default smaller",
        })],
        registeredScriptPaths: ["🛠️ scripts/embed-image-urls.mjs"],
        runtimeError: new Error("Codex failed after launch"),
    });
    const targetScript = harness.vaultScriptRegistry.resolve("/embed-image-urls");
    assert.ok(targetScript);

    await harness.controller.handleUpdateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/update-script /embed-image-urls make the default smaller",
    }, "make the default smaller", targetScript);
    await waitForAgentQueueToDrain(harness.controller);
    const previous = harness.controller.getLatestAgentRunForThread("thread-1");
    const selectionsBeforeRetry = harness.getDefaultRuntimeSelectionCalls();
    harness.vaultScriptRegistry.upsert("🛠️ scripts/EMBED-IMAGE-URLS.js");

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), false);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), selectionsBeforeRetry);
    assert.match(harness.appendedEntries.at(-1)?.body ?? "", /not available to update/iu);
});

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
    assert.deepEqual(harness.appendedEntries, []);
    assert.equal(harness.committedEntries[0]?.id, "generated-2");
    assert.match(harness.committedEntries[0]?.body ?? "", /desktop Obsidian/i);
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
    assert.deepEqual(latestRun?.usedFiles, ["Folder/Note.md"]);
    assert.deepEqual(harness.committedEntries, [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "Ship it.",
        insertAfterCommentId: "thread-1",
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

test("comment agent controller records requested Excalidraw subskills", async () => {
    const filePath = "Excalidraw/Drawing 2026-07-23 12.57.34.excalidraw.md";
    const harness = createHarness({
        initialComments: [createComment({
            filePath,
            selectedText: "Drawing 2026-07-23 12.57.34.excalidraw",
            comment: "@codex create some arts in excalidraw",
        })],
        availableFilePaths: [filePath],
        runtimeReplyText: "Created.",
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath,
        body: "@codex create some arts in excalidraw",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.deepEqual(latestRun?.usedSkills, [
        {
            name: "aside",
            mode: "write",
            source: "built-in",
        },
        {
            name: "obsidian-excalidraw",
            source: "requested",
        },
    ]);
});

test("comment agent controller turns annotation proposals into anchored side notes", async () => {
    const harness = createHarness({
        currentNoteContent: "# Plan\n\nThis offer needs a sharper promise for factory buyers.\n",
        runtimeReplyText: [
            "```aside-annotations",
            JSON.stringify([{
                selectedText: "sharper promise",
                comment: "这里可以更具体：承诺应该落到交付结果或试点范围，而不是抽象地说更锋利。",
            }]),
            "```",
            "已添加 1 条 anchored 批注。",
        ].join("\n"),
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex 你看看这篇有哪里可以改进的。你可以加批注",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const anchoredThreads = harness.commentManager
        .getThreadsForFile("Folder/Note.md", { includeDeleted: true })
        .filter((thread) => thread.anchorKind === "selection");

    assert.equal(anchoredThreads.length, 1);
    assert.equal(anchoredThreads[0].selectedText, "sharper promise");
    assert.equal(anchoredThreads[0].startLine, 2);
    assert.equal(anchoredThreads[0].startChar, 19);
    assert.equal(anchoredThreads[0].endLine, 2);
    assert.equal(anchoredThreads[0].endChar, 34);
    assert.equal(
        anchoredThreads[0].entries[0].body,
        "这里可以更具体：承诺应该落到交付结果或试点范围，而不是抽象地说更锋利。",
    );
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "已添加 1 条 anchored 批注。");
    assert.doesNotMatch(harness.commentManager.getCommentById("generated-2")?.comment ?? "", /aside-annotations/);
    assert.deepEqual(harness.persistedFiles, [{
        path: "Folder/Note.md",
        skipCommentViewRefresh: true,
    }]);
});

test("comment agent controller rejects cancellation while annotation proposals are applied", async () => {
    let markHashStarted: () => void = () => undefined;
    let releaseHash: () => void = () => undefined;
    const hashStarted = new Promise<void>((resolve) => {
        markHashStarted = resolve;
    });
    const blockedHash = new Promise<void>((resolve) => {
        releaseHash = resolve;
    });
    const harness = createHarness({
        currentNoteContent: "# Plan\n\nA sharper promise matters.\n",
        runtimeReplyText: [
            "```aside-annotations",
            JSON.stringify([{
                selectedText: "sharper promise",
                comment: "Make the promise concrete.",
            }]),
            "```",
            "Added one note.",
        ].join("\n"),
        customHashText: async (text) => {
            markHashStarted();
            await blockedHash;
            return `hash:${text}`;
        },
    });

    const savePromise = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex add an annotation",
    });
    await hashStarted;
    try {
        assert.equal(await harness.controller.cancelRun("generated-1"), false);
    } finally {
        releaseHash();
        await savePromise;
        await waitForAgentQueueToDrain(harness.controller);
    }

    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "succeeded");
});

test("comment agent controller stops annotation and reply persistence after disposal", async () => {
    let markHashStarted: () => void = () => undefined;
    let releaseHash: () => void = () => undefined;
    const hashStarted = new Promise<void>((resolve) => {
        markHashStarted = resolve;
    });
    const blockedHash = new Promise<void>((resolve) => {
        releaseHash = resolve;
    });
    const harness = createHarness({
        currentNoteContent: "# Plan\n\nA sharper promise matters.\n",
        runtimeReplyText: [
            "```aside-annotations",
            JSON.stringify([{
                selectedText: "sharper promise",
                comment: "Make the promise concrete.",
            }]),
            "```",
            "Added one note.",
        ].join("\n"),
        customHashText: async (text) => {
            markHashStarted();
            await blockedHash;
            return `hash:${text}`;
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex add an annotation",
    });
    await hashStarted;
    harness.controller.dispose();
    releaseHash();
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.equal(
        harness.commentManager.getThreadsForFile("Folder/Note.md", { includeDeleted: true })
            .filter((thread) => thread.anchorKind === "selection").length,
        0,
    );
    assert.deepEqual(harness.committedEntries, []);
});

test("comment agent controller removes orphan duplicate replies created during completion", async () => {
    const harness = createHarness({
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
    assert.deepEqual(harness.committedEntries, [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "Claude reply.",
        insertAfterCommentId: "thread-1",
    }]);
});

test("comment agent controller dispatches gemini as a peer provider", async () => {
    const harness = createHarness({
        runtimeReplyText: "Gemini reply.",
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@gemini review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.requestedAgent, "gemini");
    assert.deepEqual(harness.runtimeSelectionCalls, ["gemini"]);
    assert.equal(harness.runtimeCalls[0]?.target, "gemini");
    assert.deepEqual(latestRun?.usedSkills, [{
        name: "aside",
        mode: "write",
        source: "built-in",
    }]);
    assert.deepEqual(harness.committedEntries, [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "Gemini reply.",
        insertAfterCommentId: "thread-1",
    }]);
});

test("comment agent controller dispatches deepseek through OpenCode", async () => {
    const harness = createHarness({
        runtimeReplyText: "OpenCode reply.",
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@deepseek review this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "succeeded");
    assert.equal(latestRun?.requestedAgent, "deepseek");
    assert.deepEqual(harness.runtimeSelectionCalls, ["deepseek"]);
    assert.equal(harness.runtimeCalls[0]?.target, "deepseek");
    assert.deepEqual(harness.committedEntries, [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "OpenCode reply.",
        insertAfterCommentId: "thread-1",
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
            usedSkills: [{ name: "obsidian-excalidraw" }],
            usedTools: ["browser-use.browser_navigate"],
            usedFiles: ["Folder/Reference.md"],
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
    assert.deepEqual(latestRun?.usedSkills, [
        {
            name: "aside",
            mode: "write",
            source: "built-in",
        },
        {
            name: "obsidian-excalidraw",
        },
    ]);
    assert.deepEqual(latestRun?.usedTools, ["browser-use.browser_navigate", "WebSearch (unavailable)"]);
    assert.deepEqual(latestRun?.usedFiles, ["Folder/Note.md", "Folder/Reference.md"]);
    assert.deepEqual(latestRun?.usedUrls, ["http://localhost:3000/dashboard"]);
    assert.deepEqual(latestRun?.usedToolErrors, [{
        name: "WebSearch",
        payload: "unavailable",
    }]);
});

for (const actor of getSupportedAgentActors()) {
    test(`comment agent controller persists ${actor.id} blocked preflight as a failed card`, async () => {
        const diagnostic = actor.id === "codex"
            ? "Error: Missing optional dependency @openai/codex-darwin-arm64.\n    at launcher.js:20:3"
            : "    at launcher.js:20:3";
        const harness = createHarness({
            initialComments: [createComment({ comment: `${actor.directive} review this` })],
            runtimeSelection: {
                kind: "blocked",
                runtime: "direct-cli",
                modePreference: "auto",
                notice: `${actor.label} is unavailable.`,
                diagnostic,
            },
        });

        await harness.controller.handleSavedUserEntry({
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: `${actor.directive} review this`,
        });

        const run = harness.controller.getLatestAgentRunForThread("thread-1");
        assert.equal(run?.requestedAgent, actor.id);
        assert.equal(run?.status, "failed");
        assert.equal(run?.error, diagnostic);
        assert.equal(run?.outputEntryId, "generated-2");
        assert.equal(
            harness.commentManager.getCommentById("generated-2")?.comment,
            actor.id === "codex"
                ? "Missing optional dependency @openai/codex-darwin-arm64."
                : `${actor.label} couldn’t complete this request. Try another agent.`,
        );
        assert.deepEqual(harness.runtimeCalls, []);
        assert.deepEqual(harness.notices, []);
    });
}

test("comment agent controller persists a blocked retry in the existing failed card", async () => {
    const harness = createHarness({
        initialComments: [createComment({ comment: "@codex review this" })],
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "failed",
                promptText: "@codex review this",
                createdAt: 10,
                endedAt: 12,
                error: "Previous failure",
                outputEntryId: "reply-1",
            }],
        },
        runtimeSelection: {
            kind: "blocked",
            runtime: "direct-cli",
            modePreference: "auto",
            notice: "Codex was not found on PATH.",
            diagnostic: "Codex was not found on PATH.",
        },
    });
    harness.commentManager.appendEntry("thread-1", {
        id: "reply-1",
        body: "Previous failure",
        timestamp: 20,
    });
    const internalController = harness.controller as any;
    internalController.retainedRunStreamIds.add("run-old");
    internalController.setRunStream({
        runId: "run-old",
        threadId: "thread-1",
        requestedAgent: "codex",
        runtime: "direct-cli",
        status: "failed",
        statusHintText: "Couldn’t save reply",
        partialText: "Unsaved replacement",
        startedAt: 10,
        updatedAt: 12,
        outputEntryId: "reply-1",
    });

    assert.equal(await harness.controller.retryRun("run-old"), true);

    const latest = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latest?.status, "failed");
    assert.equal(latest?.retryOfRunId, "run-old");
    assert.equal(latest?.outputEntryId, "reply-1");
    assert.equal(
        harness.commentManager.getCommentById("reply-1")?.comment,
        "Codex was not found on PATH.",
    );
    assert.deepEqual(harness.appendedEntries, []);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.notices, []);
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
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
    assert.deepEqual(
        harness.controller.getAgentStreamsForThread("thread-1")
            .map((stream) => stream.triggerEntryId)
            .sort(),
        ["entry-2", "thread-1"],
    );

    const parentOutputEntryId = runningRuns[0]?.outputEntryId ?? null;
    const childOutputEntryId = runningRuns[1]?.outputEntryId ?? null;
    assert.ok(parentOutputEntryId);
    assert.ok(childOutputEntryId);
    assert.deepEqual(harness.committedEntries, []);
    assert.deepEqual(
        harness.commentManager.getThreadById("thread-1")?.entries.map((entry) => entry.id),
        ["thread-1", "entry-2", "entry-3"],
    );

    runtimeResolvers.splice(0).forEach((resolve) => resolve());
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(
        harness.controller.getAgentRuns().filter((run) => run.status === "succeeded").length,
        2,
    );
    assert.equal(harness.committedEntries.length, 2);
    assert.deepEqual(
        [parentOutputEntryId, childOutputEntryId]
            .map((commentId) => harness.commentManager.getCommentById(commentId)?.comment ?? "")
            .slice()
            .sort(),
        ["Local same-thread reply 1", "Local same-thread reply 2"],
    );
});

test("comment agent controller commits a running reply to the run's renamed file", async () => {
    let releaseRuntime: () => void = () => {
        throw new Error("Runtime did not start.");
    };
    const harness = createHarness({
        availableFilePaths: ["Folder/Note.md", "Folder/Renamed.md"],
        customRunAgentRuntime: async () => {
            await new Promise<void>((resolve) => {
                releaseRuntime = resolve;
            });
            return {
                runtime: "direct-cli",
                replyText: "Reply after rename",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer while I rename this note",
    });
    for (let attempt = 0; attempt < 40 && harness.runtimeCalls.length < 1; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await harness.store.renameFile("Folder/Note.md", "Folder/Renamed.md");
    releaseRuntime();
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(harness.committedEntries.at(-1)?.filePath, "Folder/Renamed.md");
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

    assert.deepEqual(harness.appendedEntries, []);
    assert.equal(harness.committedEntries[0]?.insertAfterCommentId, "entry-2");
    assert.deepEqual(
        harness.commentManager.getThreadById("thread-1")?.entries.map((entry) => entry.id),
        ["thread-1", "entry-2", "generated-2", "entry-3"],
    );
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Placed reply.");
});

test("comment agent controller regenerates a specific reply run using the current saved directive text", async () => {
    let replyCount = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => ({
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
    assert.deepEqual(harness.committedEntries, [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "First reply",
        insertAfterCommentId: "thread-1",
    }, {
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "Second reply",
        insertAfterCommentId: "thread-1",
    }]);
    assert.equal(harness.commentManager.getCommentById(latestRun?.outputEntryId ?? "")?.comment, "Second reply");
});

test("comment agent controller regenerates a non-Markdown reply in the existing output entry", async () => {
    let attempt = 0;
    let releaseRetry!: () => void;
    const retryGate = new Promise<void>((resolve) => {
        releaseRetry = resolve;
    });
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        availableFilePaths: ["Books/Guide.pdf"],
        isCommentableFilePath: (filePath) => /\.md$/iu.test(filePath),
        isPageNoteCapableFilePath: () => true,
        currentNoteContentError: new Error("binary source must not be read"),
        customRunAgentRuntime: async () => {
            attempt += 1;
            if (attempt === 1) {
                throw new Error("first conversion failed");
            }
            await retryGate;
            return { runtime: "direct-cli", replyText: "Recovered conversion" };
        },
    });

    await harness.controller.handlePdfToMarkdownRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Books/Guide.pdf",
        body: "/pdf-to-markdown",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const failedRun = harness.controller.getLatestAgentRunForThread("thread-1");
    const outputEntryId = failedRun?.outputEntryId ?? "";
    assert.equal(failedRun?.status, "failed");
    assert.ok(outputEntryId);

    const started = await harness.controller.retryRun(failedRun?.id ?? "");

    assert.equal(started, true);
    const retryRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retryRun?.outputEntryId, outputEntryId);
    assert.equal(harness.commentManager.getCommentById(outputEntryId)?.comment, "first conversion failed");
    assert.equal(
        harness.controller.getActiveAgentStreamForThread("thread-1")?.outputEntryId,
        outputEntryId,
    );
    assert.equal(harness.committedEntries.length, 1);
    assert.deepEqual(harness.currentNoteContentReads, []);

    releaseRetry();
    await waitForAgentQueueToDrain(harness.controller);
    assert.equal(harness.commentManager.getCommentById(outputEntryId)?.comment, "Recovered conversion");
});

test("comment agent controller appends an output entry when a non-Markdown retry has none", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Documents/Guide.docx",
            comment: "@codex summarize this file",
        })],
        availableFilePaths: ["Documents/Guide.docx"],
        isCommentableFilePath: (filePath) => /\.md$/iu.test(filePath),
        isPageNoteCapableFilePath: () => true,
        currentNoteContentError: new Error("binary source must not be read"),
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Documents/Guide.docx",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "failed",
                promptText: "@codex summarize this file",
                createdAt: 10,
                startedAt: 11,
                endedAt: 12,
                error: "previous failure",
                outputEntryId: "missing-output",
            }],
        },
        runtimeReplyText: "Recovered document reply",
    });

    assert.equal(await harness.controller.retryRun("run-old"), true);
    await waitForAgentQueueToDrain(harness.controller);

    const retryRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.notEqual(retryRun?.outputEntryId, "missing-output");
    assert.equal(harness.committedEntries.length, 1);
    assert.equal(
        harness.commentManager.getCommentById(retryRun?.outputEntryId ?? "")?.comment,
        "Recovered document reply",
    );
    assert.deepEqual(harness.currentNoteContentReads, []);
});

test("comment agent controller rejects missing and ineligible retry sources without reply mutation", async () => {
    for (const scenario of [{
        name: "missing source",
        filePath: "Documents/Missing.docx",
        availableFilePaths: [] as string[],
        isPageNoteCapableFilePath: () => true,
    }, {
        name: "generated index",
        filePath: "🐰 Aside Index.md",
        availableFilePaths: ["🐰 Aside Index.md"],
        isPageNoteCapableFilePath: () => false,
    }]) {
        const harness = createHarness({
            initialComments: [createComment({
                filePath: scenario.filePath,
                comment: "@codex retry this",
            })],
            availableFilePaths: scenario.availableFilePaths,
            isCommentableFilePath: () => false,
            isPageNoteCapableFilePath: scenario.isPageNoteCapableFilePath,
            initialPersistedData: {
                agentRuns: [{
                    id: "run-old",
                    threadId: "thread-1",
                    triggerEntryId: "thread-1",
                    filePath: scenario.filePath,
                    requestedAgent: "codex",
                    runtime: "direct-cli",
                    status: "failed",
                    promptText: "@codex retry this",
                    createdAt: 10,
                    endedAt: 12,
                    outputEntryId: "reply-1",
                }],
            },
        });
        harness.commentManager.appendEntry("thread-1", {
            id: "reply-1",
            body: "Previous failure",
            timestamp: 20,
        });

        assert.equal(await harness.controller.retryRun("run-old"), false, scenario.name);
        assert.deepEqual(harness.runtimeCalls, [], scenario.name);
        assert.deepEqual(harness.editedEntries, [], scenario.name);
        assert.deepEqual(harness.appendedEntries, [], scenario.name);
        assert.equal(
            harness.commentManager.getCommentById("reply-1")?.comment,
            "Previous failure",
            scenario.name,
        );
    }
});

test("comment agent controller re-resolves the configured default for create-script regenerate", async () => {
    let selection: DefaultAgentRuntimeSelection = {
        kind: "resolved",
        selectedAgent: "codex",
        runtime: "direct-cli",
        modePreference: "auto",
    };
    let runtimeAttempt = 0;
    const harness = createHarness({
        initialComments: [createComment({
            comment: "/create-script build a cleaner",
        })],
        resolveDefaultAgentRuntimeSelection: async () => selection,
        customRunAgentRuntime: async () => {
            runtimeAttempt += 1;
            if (runtimeAttempt === 1) {
                throw new Error("Codex failed after launch");
            }
            return {
                runtime: "direct-cli",
                replyText: "Created /cleaner.",
            };
        },
    });

    await harness.controller.handleCreateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/create-script build a cleaner",
    }, "build a cleaner");
    await waitForAgentQueueToDrain(harness.controller);

    const previous = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(previous?.status, "failed");
    selection = {
        kind: "resolved",
        selectedAgent: "claude",
        runtime: "direct-cli",
        modePreference: "auto",
    };

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), true);
    await waitForAgentQueueToDrain(harness.controller);

    const retry = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retry?.requestKind, "create-script");
    assert.equal(retry?.requestedAgent, "claude");
    assert.equal(retry?.preferredAgent, undefined);
    assert.equal(retry?.outputEntryId, previous?.outputEntryId);
    assert.equal(retry?.retryOfRunId, previous?.id);
    assert.equal(harness.runtimeCalls.at(-1)?.requestKind, "create-script");
});

test("comment agent controller keeps the previous durable reply while regeneration runs", async () => {
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
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "First reply");
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText, "");
    assert.deepEqual(harness.committedEntries.slice(-1), [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "First reply",
        insertAfterCommentId: "thread-1",
    }]);

    resolveSecondReply("Second reply");
    await waitForAgentQueueToDrain(harness.controller);

    const retriedRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(harness.commentManager.getCommentById(retriedRun?.outputEntryId ?? "")?.comment, "Second reply");
});

test("comment agent controller shows success before final retry persistence finishes", async () => {
    let releaseFinalEdit: () => void = () => undefined;
    let markFinalEditStarted: () => void = () => undefined;
    const finalEditStarted = new Promise<void>((resolve) => {
        markFinalEditStarted = resolve;
    });
    const blockedFinalEdit = new Promise<void>((resolve) => {
        releaseFinalEdit = resolve;
    });
    let runtimeCount = 0;
    const harness = createHarness({
        customCommitThreadEntry: async (entry) => {
            if (entry.body === "Second reply") {
                markFinalEditStarted();
                await blockedFinalEdit;
            }
        },
        customRunAgentRuntime: async () => {
            runtimeCount += 1;
            return {
                runtime: "direct-cli",
                replyText: runtimeCount === 1 ? "First reply" : "Second reply",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const retryPromise = harness.controller.retryRun("generated-1");
    await finalEditStarted;

    try {
        const stream = harness.controller.getActiveAgentStreamForThread("thread-1");
        assert.equal(stream?.status, "succeeded");
        assert.equal(stream?.statusHintText, undefined);
        assert.equal(stream?.partialText, "Second reply");
        assert.equal(stream?.outputEntryId, "generated-2");
        assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "running");
    } finally {
        releaseFinalEdit();
        assert.equal(await retryPromise, true);
        await waitForAgentQueueToDrain(harness.controller);
    }
});

test("comment agent controller retries with one final replacement and no empty edit", async () => {
    let runtimeCount = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            runtimeCount += 1;
            return {
                runtime: "direct-cli",
                replyText: runtimeCount === 1 ? "First reply" : "Second reply",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const commitsBeforeRetry = harness.committedEntries.length;

    assert.equal(await harness.controller.retryRun("generated-1"), true);
    await waitForAgentQueueToDrain(harness.controller);

    assert.deepEqual(harness.committedEntries.slice(commitsBeforeRetry), [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "generated-2",
        body: "Second reply",
        insertAfterCommentId: "thread-1",
    }]);
});

test("comment agent controller creates a fresh reply when the prior output was deleted", async () => {
    let runtimeCount = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            runtimeCount += 1;
            return {
                runtime: "direct-cli",
                replyText: runtimeCount === 1 ? "First reply" : "Second reply",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const firstRun = harness.controller.getLatestAgentRunForThread("thread-1");
    const deletedOutputEntryId = firstRun?.outputEntryId ?? "";
    const deletedAt = Date.now();
    harness.commentManager.deleteComment(deletedOutputEntryId, deletedAt);

    assert.equal(await harness.controller.retryRun(firstRun?.id ?? ""), true);
    await waitForAgentQueueToDrain(harness.controller);

    const retry = harness.controller.getLatestAgentRunForThread("thread-1");
    const retryOutput = harness.commentManager.getCommentById(retry?.outputEntryId ?? "");
    assert.notEqual(retry?.outputEntryId, deletedOutputEntryId);
    assert.equal(harness.commentManager.getCommentById(deletedOutputEntryId)?.deletedAt, deletedAt);
    assert.equal(retryOutput?.comment, "Second reply");
    assert.equal(retryOutput?.deletedAt, undefined);
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
});

test("comment agent controller keeps an unsaved completed reply visible", async () => {
    let runtimeCount = 0;
    let finalEditAttempts = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            runtimeCount += 1;
            return {
                runtime: "direct-cli",
                replyText: runtimeCount === 1 ? "First reply" : "Second reply",
            };
        },
        customCommitThreadEntry: async (entry) => {
            if (entry.body !== "Second reply") {
                return;
            }
            finalEditAttempts += 1;
            return false;
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(await harness.controller.retryRun("generated-1"), true);
    await waitForAgentQueueToDrain(harness.controller);

    const retry = harness.controller.getLatestAgentRunForThread("thread-1");
    const stream = harness.controller.getActiveAgentStreamForThread("thread-1");
    assert.equal(retry?.status, "failed");
    assert.equal(stream?.status, "failed");
    assert.equal(stream?.statusHintText, "Couldn’t save reply");
    assert.equal(stream?.partialText, "Second reply");
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "First reply");
    assert.equal(finalEditAttempts, 1);
    assert.equal(harness.editedEntries.some((entry) => entry.body === ""), false);
});

test("comment agent controller does not relabel a saved reply when run finalization fails", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let retryCallback: () => void = () => {
        throw new Error("Reply finalization retry was not scheduled.");
    };
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout(callback: () => void) {
                retryCallback = callback;
                return 1;
            },
            clearTimeout() {},
        },
    });
    const harness = createHarness({
        runtimeReplyText: "Durable reply",
        failSucceededRunUpdateAttempts: 1,
    });

    try {
        await harness.controller.handleSavedUserEntry({
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: "@codex answer this",
        });
        for (let attempt = 0; attempt < 40; attempt += 1) {
            if (harness.logEntries.some((entry) => entry.event === "agents.run.finalize_failed")) {
                break;
            }
            await new Promise((resolve) => setTimeout(resolve, 10));
        }

        assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Durable reply");
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.status, "succeeded");
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.statusHintText, undefined);
        assert.equal(harness.logEntries.some((entry) => entry.event === "agents.reply.persist_failed"), false);
        assert.equal(harness.logEntries.some((entry) => entry.event === "agents.run.finalize_failed"), true);

        retryCallback();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "succeeded");
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
    } finally {
        harness.controller.dispose();
        if (previousWindow) {
            Object.defineProperty(globalThis, "window", previousWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

for (const persistenceFailure of ["false", "throw"] as const) {
    test(`comment agent controller reports ${persistenceFailure} while saving a cancelled partial reply`, async () => {
        const harness = createHarness({
            customCommitThreadEntry: async () => {
                if (persistenceFailure === "throw") {
                    throw new Error("cancel reply storage unavailable");
                }
                return false;
            },
            customRunAgentRuntime: async (invocation) => {
                invocation.onPartialText?.("Partial answer");
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
            body: "@codex cancel this",
        });
        await new Promise((resolve) => setTimeout(resolve, 30));

        assert.equal(await harness.controller.cancelRun("generated-1"), true);
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.status, "failed");
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.statusHintText, "Couldn’t save reply");
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText, "Partial answer");
    });
}

for (const persistenceFailure of ["false", "throw"] as const) {
    test(`comment agent controller reports ${persistenceFailure} while saving a runtime failure reply`, async () => {
        const harness = createHarness({
            runtimeError: new Error("Runtime exploded"),
            customCommitThreadEntry: async () => {
                if (persistenceFailure === "throw") {
                    throw new Error("failure reply storage unavailable");
                }
                return false;
            },
        });

        await harness.controller.handleSavedUserEntry({
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: "@codex answer this",
        });
        await waitForAgentQueueToDrain(harness.controller);

        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.status, "failed");
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.statusHintText, "Couldn’t save reply");
        assert.match(harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText ?? "", /Runtime exploded/u);
        assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.error, "Runtime exploded");
    });
}

test("comment agent controller rejects cancellation while a completed reply is persisting", async () => {
    let releaseFinalEdit: () => void = () => undefined;
    let markFinalEditStarted: () => void = () => undefined;
    const finalEditStarted = new Promise<void>((resolve) => {
        markFinalEditStarted = resolve;
    });
    const blockedFinalEdit = new Promise<void>((resolve) => {
        releaseFinalEdit = resolve;
    });
    let finalEditCount = 0;
    let runtimeCount = 0;
    const harness = createHarness({
        customCommitThreadEntry: async (entry) => {
            if (entry.body !== "Second reply") {
                return;
            }
            finalEditCount += 1;
            if (finalEditCount === 1) {
                markFinalEditStarted();
                await blockedFinalEdit;
            }
        },
        customRunAgentRuntime: async () => {
            runtimeCount += 1;
            return {
                runtime: "direct-cli",
                replyText: runtimeCount === 1 ? "First reply" : "Second reply",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const retryPromise = harness.controller.retryRun("generated-1");
    await finalEditStarted;
    try {
        assert.equal(await harness.controller.cancelRun("generated-3"), false);
    } finally {
        releaseFinalEdit();
        await retryPromise;
        await waitForAgentQueueToDrain(harness.controller);
    }
});

test("comment agent controller rejects regenerate while a completed reply is persisting", async () => {
    let releaseFinalEdit: () => void = () => undefined;
    let markFinalEditStarted: () => void = () => undefined;
    const finalEditStarted = new Promise<void>((resolve) => {
        markFinalEditStarted = resolve;
    });
    const blockedFinalEdit = new Promise<void>((resolve) => {
        releaseFinalEdit = resolve;
    });
    let runtimeCount = 0;
    let finalEditCount = 0;
    const harness = createHarness({
        customCommitThreadEntry: async (entry) => {
            if (entry.body !== "Second reply") {
                return;
            }
            finalEditCount += 1;
            if (finalEditCount === 1) {
                markFinalEditStarted();
                await blockedFinalEdit;
            }
        },
        customRunAgentRuntime: async () => {
            runtimeCount += 1;
            return {
                runtime: "direct-cli",
                replyText: runtimeCount === 1 ? "First reply" : "Second reply",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const retryPromise = harness.controller.retryRun("generated-1");
    await finalEditStarted;
    try {
        assert.equal(await harness.controller.retryRun("generated-3"), false);
        assert.equal(harness.notices.at(-1), "That agent reply is still being saved.");
    } finally {
        releaseFinalEdit();
        await retryPromise;
        await waitForAgentQueueToDrain(harness.controller);
    }
});

test("comment agent controller rejects duplicate regenerate for the same trigger", async () => {
    let releaseRetryRuntime: () => void = () => undefined;
    let markRetryRuntimeStarted: () => void = () => undefined;
    const retryRuntimeStarted = new Promise<void>((resolve) => {
        markRetryRuntimeStarted = resolve;
    });
    const blockedRetryRuntime = new Promise<void>((resolve) => {
        releaseRetryRuntime = resolve;
    });
    let runtimeCount = 0;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            runtimeCount += 1;
            if (runtimeCount > 1) {
                markRetryRuntimeStarted();
                await blockedRetryRuntime;
            }
            return {
                runtime: "direct-cli",
                replyText: runtimeCount === 1 ? "First reply" : "Replacement reply",
            };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });
    await waitForAgentQueueToDrain(harness.controller);
    const originalRun = harness.controller.getLatestAgentRunForThread("thread-1");

    assert.equal(await harness.controller.retryRun(originalRun?.id ?? ""), true);
    await retryRuntimeStarted;
    try {
        assert.equal(await harness.controller.retryRun(originalRun?.id ?? ""), false);
        const sameTriggerRuns = harness.controller.getAgentRuns()
            .filter((run) => run.triggerEntryId === "thread-1");
        assert.equal(sameTriggerRuns.length, 2);
        assert.equal(new Set(sameTriggerRuns.map((run) => run.outputEntryId)).size, 1);
    } finally {
        releaseRetryRuntime();
        await waitForAgentQueueToDrain(harness.controller);
    }
});

test("comment agent controller reserves a trigger while regenerate preflight is pending", async () => {
    let releaseRuntimeSelection: () => void = () => undefined;
    let markRuntimeSelectionStarted: () => void = () => undefined;
    const runtimeSelectionStarted = new Promise<void>((resolve) => {
        markRuntimeSelectionStarted = resolve;
    });
    const blockedRuntimeSelection = new Promise<void>((resolve) => {
        releaseRuntimeSelection = resolve;
    });
    const harness = createHarness({
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "succeeded",
                promptText: "@codex answer this",
                createdAt: 10,
                outputEntryId: "missing-output",
            }],
        },
        resolveAgentRuntimeSelection: async () => {
            markRuntimeSelectionStarted();
            await blockedRuntimeSelection;
            return {
                kind: "resolved",
                runtime: "direct-cli",
                modePreference: "auto",
                ownershipMessage: "Using your local Codex setup",
            };
        },
    });

    const firstRetry = harness.controller.retryRun("run-old");
    await runtimeSelectionStarted;
    const duplicateRetry = harness.controller.retryRun("run-old");
    releaseRuntimeSelection();

    assert.deepEqual(await Promise.all([firstRetry, duplicateRetry]), [true, false]);
    await waitForAgentQueueToDrain(harness.controller);
    assert.equal(
        harness.controller.getAgentRuns().filter((run) => run.triggerEntryId === "thread-1").length,
        2,
    );
});

test("comment agent controller shows optimistic success for a peer provider", async () => {
    let releaseFinalEdit: () => void = () => undefined;
    let markFinalEditStarted: () => void = () => undefined;
    const finalEditStarted = new Promise<void>((resolve) => {
        markFinalEditStarted = resolve;
    });
    const blockedFinalEdit = new Promise<void>((resolve) => {
        releaseFinalEdit = resolve;
    });
    const harness = createHarness({
        customCommitThreadEntry: async (entry) => {
            if (entry.body === "Gemini reply") {
                markFinalEditStarted();
                await blockedFinalEdit;
            }
        },
        customRunAgentRuntime: async () => ({
            runtime: "direct-cli",
            replyText: "Gemini reply",
        }),
    });

    const savePromise = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@gemini answer this",
    });
    await finalEditStarted;
    try {
        const stream = harness.controller.getActiveAgentStreamForThread("thread-1");
        assert.equal(stream?.requestedAgent, "gemini");
        assert.equal(stream?.status, "succeeded");
        assert.equal(stream?.partialText, "Gemini reply");
    } finally {
        releaseFinalEdit();
        await savePromise;
        await waitForAgentQueueToDrain(harness.controller);
    }
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
    assert.equal(harness.committedEntries.length, 1);
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Recovered from prompt");
});

test("disabled Scripts retries an edited ordinary agent prompt without inheriting a historical script request kind", async () => {
    const harness = createHarness({
        scriptsEnabled: false,
        initialComments: [createComment({
            comment: "@codex explain this instead",
        })],
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                requestKind: "create-script",
                runtime: "direct-cli",
                status: "failed",
                promptText: "build a cleaner",
                createdAt: 10,
                endedAt: 12,
                error: "previous failure",
            }],
        },
        runtimeReplyText: "Ordinary reply",
    });

    const action = getSidebarCommentRegenerateAction(
        "thread-1",
        "@codex explain this instead",
        harness.controller.getAgentRuns(),
        [],
        false,
    );
    assert.deepEqual(action, { kind: "agent-prompt" });
    assert.ok(action);
    const started = await executeSidebarCommentRegenerateAction(
        action,
        { id: "thread-1", filePath: "Folder/Note.md" },
        {
            saveVisibleDraftIfPresent: async () => true,
            retryAgentRun: async () => false,
            retryScriptRun: async () => false,
            retryAgentPromptForComment: (commentId, filePath) =>
                harness.controller.retryPromptForComment(commentId, filePath),
        },
    );
    await waitForAgentQueueToDrain(harness.controller);

    assert.equal(started, true);
    assert.equal(harness.controller.getAgentRuns().length, 2);
    const retry = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retry?.retryOfRunId, "run-old");
    assert.equal(retry?.requestKind, undefined);
    assert.equal(harness.runtimeCalls.at(-1)?.requestKind, undefined);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 0);
    assert.deepEqual(harness.notices, []);
});

test("disabled Scripts silently blocks any mixed script directive from prompt retry before history mutation", async () => {
    for (const body of [
        "/create-script build a cleaner @codex",
        "/update-script /clean improve it @codex",
        "/pdf-to-markdown @codex",
    ]) {
        const harness = createHarness({
            scriptsEnabled: false,
            initialComments: [createComment({ comment: body })],
            initialPersistedData: {
                agentRuns: [{
                    id: "run-old",
                    threadId: "thread-1",
                    triggerEntryId: "thread-1",
                    filePath: "Folder/Note.md",
                    requestedAgent: "codex",
                    requestKind: "create-script",
                    runtime: "direct-cli",
                    status: "failed",
                    promptText: "build a cleaner",
                    createdAt: 10,
                    endedAt: 12,
                    error: "previous failure",
                }],
            },
        });
        const runsBeforeRetry = harness.controller.getAgentRuns();

        const started = await harness.controller.retryPromptForComment("thread-1", "Folder/Note.md");
        await waitForAgentQueueToDrain(harness.controller);

        assert.equal(started, false, body);
        assert.deepEqual(harness.controller.getAgentRuns(), runsBeforeRetry, body);
        assert.deepEqual(harness.runtimeCalls, [], body);
        assert.deepEqual(harness.appendedEntries, [], body);
        assert.deepEqual(harness.committedEntries, [], body);
        assert.deepEqual(harness.editedEntries, [], body);
        assert.deepEqual(harness.notices, [], body);
    }
});

test("disabled Scripts silently blocks direct retries of every historical script-oriented agent run", async () => {
    for (const requestKind of ["create-script", "update-script", "pdf-to-markdown"] as const) {
        const harness = createHarness({
            scriptsEnabled: false,
            initialPersistedData: {
                agentRuns: [{
                    id: "run-old",
                    threadId: "thread-1",
                    triggerEntryId: "thread-1",
                    filePath: "Folder/Note.md",
                    requestedAgent: "codex",
                    requestKind,
                    ...(requestKind === "update-script"
                        ? { targetScriptPath: "🛠️ scripts/clean.mjs" }
                        : {}),
                    runtime: "direct-cli",
                    status: "failed",
                    promptText: "script work",
                    createdAt: 10,
                    endedAt: 12,
                    error: "previous failure",
                }],
            },
        });
        const runsBeforeRetry = harness.controller.getAgentRuns();

        assert.equal(await harness.controller.retryRun("run-old"), false, requestKind);
        assert.deepEqual(harness.controller.getAgentRuns(), runsBeforeRetry, requestKind);
        assert.deepEqual(harness.runtimeCalls, [], requestKind);
        assert.deepEqual(harness.appendedEntries, [], requestKind);
        assert.deepEqual(harness.committedEntries, [], requestKind);
        assert.deepEqual(harness.editedEntries, [], requestKind);
        assert.deepEqual(harness.notices, [], requestKind);
    }
});

test("script-oriented retry rechecks the live Scripts capability after asynchronous selection", async () => {
    let scriptsEnabled = true;
    const harness = createHarness({
        scriptsEnabled: () => scriptsEnabled,
        initialComments: [createComment({
            comment: "/create-script build a cleaner",
        })],
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                requestKind: "create-script",
                runtime: "direct-cli",
                status: "failed",
                promptText: "build a cleaner",
                createdAt: 10,
                endedAt: 12,
                error: "previous failure",
            }],
        },
        resolveDefaultAgentRuntimeSelection: async () => {
            scriptsEnabled = false;
            return {
                kind: "resolved",
                selectedAgent: "codex",
                runtime: "direct-cli",
                modePreference: "auto",
            };
        },
    });
    const runsBeforeRetry = harness.controller.getAgentRuns();

    assert.equal(await harness.controller.retryRun("run-old"), false);

    assert.deepEqual(harness.controller.getAgentRuns(), runsBeforeRetry);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.appendedEntries, []);
    assert.deepEqual(harness.committedEntries, []);
    assert.deepEqual(harness.editedEntries, []);
    assert.deepEqual(harness.notices, []);
});

test("disabled Scripts preserves ordinary and unknown agent retry behavior", async () => {
    const ordinary = createHarness({
        scriptsEnabled: false,
        initialComments: [createComment({ comment: "@codex explain this" })],
        initialPersistedData: {
            agentRuns: [{
                id: "run-old",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "failed",
                promptText: "@codex explain this",
                createdAt: 10,
                endedAt: 12,
                error: "previous failure",
            }],
        },
        runtimeReplyText: "Ordinary retry",
    });

    assert.equal(await ordinary.controller.retryRun("run-old"), true);
    await waitForAgentQueueToDrain(ordinary.controller);
    assert.equal(ordinary.controller.getLatestAgentRunForThread("thread-1")?.requestKind, undefined);
    assert.equal(ordinary.runtimeCalls.length, 1);
    assert.deepEqual(ordinary.notices, []);

    const unknown = createHarness({ scriptsEnabled: false });
    assert.equal(await unknown.controller.retryRun("missing-run"), false);
    assert.deepEqual(unknown.controller.getAgentRuns(), []);
    assert.deepEqual(unknown.runtimeCalls, []);
    assert.deepEqual(unknown.notices, ["Unable to find that agent reply."]);
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
    assert.equal(harness.committedEntries.length, 1);
    assert.equal(harness.commentManager.getCommentById(latestRun?.outputEntryId ?? "")?.comment, "Recovered after rename");
    assert.deepEqual(harness.notices, []);
});

test("comment agent controller replaces streamed provider garbage on a known failure", async () => {
    const harness = createHarness({
        customRunAgentRuntime: async (invocation) => {
            invocation.onPartialText?.("RESOURCE_EXHAUSTED: quota exceeded and internal details");
            throw new Error("RESOURCE_EXHAUSTED: quota exceeded");
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@gemini summarize this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const run = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "RESOURCE_EXHAUSTED: quota exceeded");
    assert.equal(
        harness.commentManager.getCommentById(run?.outputEntryId ?? "")?.comment,
        "Gemini couldn’t complete this request. Try another agent.",
    );
});

test("comment agent controller rejects provider failure text returned as success", async () => {
    const harness = createHarness({
        customRunAgentRuntime: async () => ({
            runtime: "direct-cli",
            replyText: "You have insufficient credits to continue.",
        }),
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex summarize this",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const run = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(run?.status, "failed");
    assert.equal(run?.error, "You have insufficient credits to continue.");
    assert.equal(
        harness.commentManager.getCommentById(run?.outputEntryId ?? "")?.comment,
        "Codex couldn’t complete this request. Try another agent.",
    );
});

test("comment agent controller preserves successful prose that mentions a provider failure phrase", async () => {
    const replyText = "The guide explains why a model is currently unavailable message may appear and how to retry safely.";
    const harness = createHarness({
        customRunAgentRuntime: async () => ({
            runtime: "direct-cli",
            replyText,
        }),
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex explain this error",
    });
    await waitForAgentQueueToDrain(harness.controller);

    const run = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(run?.status, "succeeded");
    assert.equal(harness.commentManager.getCommentById(run?.outputEntryId ?? "")?.comment, replyText);
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
    assert.deepEqual(harness.appendedEntries, []);
    assert.equal(harness.committedEntries.length, 2);
    assert.equal(harness.commentManager.getCommentById(retriedRun?.outputEntryId ?? "")?.comment, "Recovered reply");
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

test("comment agent controller marks persisted in-flight runs failed after restart and creates a missing reply card", async () => {
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
                outputEntryId: "reply-1",
            }],
        },
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();
    await waitForAgentQueueToDrain(harness.controller);

    const latestRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(latestRun?.status, "failed");
    assert.equal(latestRun?.error, "The previous Aside agent run did not finish. Retry the thread to run it again.");
    assert.deepEqual(harness.committedEntries, [{
        filePath: "Folder/Note.md",
        threadId: "thread-1",
        id: "reply-1",
        body: "The previous Aside agent run did not finish. Retry the thread to run it again.",
        insertAfterCommentId: "thread-1",
    }]);
    assert.equal(
        harness.commentManager.getCommentById("reply-1")?.comment,
        "The previous Aside agent run did not finish. Retry the thread to run it again.",
    );
});

test("comment agent controller marks persisted in-flight runs failed after restart without overwriting a stored reply", async () => {
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
                outputEntryId: "reply-1",
            }],
        },
    });
    harness.commentManager.appendEntry("thread-1", {
        id: "reply-1",
        body: "Stored response",
        timestamp: 102,
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();

    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "failed");
    assert.equal(harness.commentManager.getCommentById("reply-1")?.comment, "Stored response");
    assert.deepEqual(harness.committedEntries, []);
});

test("comment agent controller does not overwrite a reply completed during restart recovery", async () => {
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
                outputEntryId: "reply-1",
            }],
        },
        customCommitThreadEntry: async (entry, commentManager) => {
            commentManager.appendEntry("thread-1", {
                id: entry.id,
                body: "Completed while recovery was waiting",
                timestamp: 102,
            });
        },
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();

    assert.equal(
        harness.commentManager.getCommentById("reply-1")?.comment,
        "Completed while recovery was waiting",
    );
});

test("comment agent controller stops restart recovery after disposal", async () => {
    let releaseLoad: () => void = () => undefined;
    let markLoadStarted: () => void = () => undefined;
    const loadStarted = new Promise<void>((resolve) => {
        markLoadStarted = resolve;
    });
    const blockedLoad = new Promise<void>((resolve) => {
        releaseLoad = resolve;
    });
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
                outputEntryId: "reply-1",
            }],
        },
        customLoadCommentsForFile: async () => {
            markLoadStarted();
            await blockedLoad;
        },
    });

    const recovery = harness.controller.reconcilePendingRunsFromPreviousSession();
    await loadStarted;
    harness.controller.dispose();
    releaseLoad();
    await recovery;

    assert.deepEqual(harness.committedEntries, []);
    assert.equal(harness.controller.getAgentRuns()[0]?.status, "running");
});

test("comment agent controller skips interruption output when a run finishes during reload", async () => {
    let releaseLoad: () => void = () => undefined;
    let markLoadStarted: () => void = () => undefined;
    const loadStarted = new Promise<void>((resolve) => {
        markLoadStarted = resolve;
    });
    const blockedLoad = new Promise<void>((resolve) => {
        releaseLoad = resolve;
    });
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
                outputEntryId: "reply-1",
            }],
        },
        customLoadCommentsForFile: async () => {
            markLoadStarted();
            await blockedLoad;
        },
    });

    const recovery = harness.controller.reconcilePendingRunsFromPreviousSession();
    await loadStarted;
    await harness.store.updateRun("run-1", (run) => ({
        ...run,
        status: "succeeded",
        endedAt: 102,
        error: undefined,
    }));
    releaseLoad();
    await recovery;

    assert.deepEqual(harness.committedEntries, []);
    assert.equal(harness.commentManager.getCommentById("reply-1"), undefined);
    assert.equal(harness.controller.getAgentRuns()[0]?.status, "succeeded");
});

test("comment agent controller recovers queued runs without a reserved output id", async () => {
    const harness = createHarness({
        initialPersistedData: {
            agentRuns: [{
                id: "run-1",
                threadId: "thread-1",
                triggerEntryId: "thread-1",
                filePath: "Folder/Note.md",
                requestedAgent: "codex",
                runtime: "direct-cli",
                status: "queued",
                promptText: "@codex continue",
                createdAt: 100,
            }],
        },
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();

    assert.equal(harness.controller.getAgentRuns()[0]?.status, "failed");
    assert.equal(harness.controller.getAgentRuns()[0]?.outputEntryId, "generated-1");
    assert.equal(harness.committedEntries[0]?.id, "generated-1");
});

test("comment agent controller fills a blank interrupted reply", async () => {
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
                outputEntryId: "reply-1",
            }],
        },
    });
    harness.commentManager.appendEntry("thread-1", {
        id: "reply-1",
        body: "",
        timestamp: 101,
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();

    assert.match(harness.commentManager.getCommentById("reply-1")?.comment ?? "", /did not finish/);
    assert.equal(harness.committedEntries.length, 1);
});

test("comment agent controller does not resurrect a deleted interrupted reply", async () => {
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
                outputEntryId: "reply-1",
            }],
        },
    });
    harness.commentManager.appendEntry("thread-1", {
        id: "reply-1",
        body: "",
        timestamp: 101,
    });
    harness.commentManager.deleteComment("reply-1", Date.now());

    await harness.controller.reconcilePendingRunsFromPreviousSession();

    assert.notEqual(harness.commentManager.getCommentById("reply-1")?.deletedAt, undefined);
    assert.deepEqual(harness.committedEntries, []);
});

test("comment agent controller terminalizes recovery when interruption persistence fails", async () => {
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
                outputEntryId: "reply-1",
            }],
        },
        customCommitThreadEntry: async () => false,
    });

    await harness.controller.reconcilePendingRunsFromPreviousSession();

    assert.equal(harness.controller.getAgentRuns()[0]?.status, "failed");
    assert.equal(harness.commentManager.getCommentById("reply-1"), undefined);
    assert.ok(harness.logEntries.some((entry) => entry.event === "agents.reply.interrupted_commit_failed"));
});

test("comment agent controller preserves a run completed during restart recovery", async () => {
    let releaseCommit: () => void = () => undefined;
    let markCommitStarted: () => void = () => undefined;
    const commitStarted = new Promise<void>((resolve) => {
        markCommitStarted = resolve;
    });
    const blockedCommit = new Promise<void>((resolve) => {
        releaseCommit = resolve;
    });
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
                outputEntryId: "reply-1",
            }],
        },
        customCommitThreadEntry: async (_entry, commentManager) => {
            markCommitStarted();
            await blockedCommit;
            commentManager.appendEntry("thread-1", {
                id: "reply-1",
                body: "Completed by the previous session",
                timestamp: 102,
            });
        },
    });

    const recovery = harness.controller.reconcilePendingRunsFromPreviousSession();
    await commitStarted;
    await harness.store.updateRun("run-1", (run) => ({
        ...run,
        status: "succeeded",
        endedAt: 102,
        error: undefined,
    }));
    releaseCommit();
    await recovery;

    assert.equal(harness.controller.getAgentRuns()[0]?.status, "succeeded");
    assert.equal(
        harness.commentManager.getCommentById("reply-1")?.comment,
        "Completed by the previous session",
    );
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

test("comment agent controller shows starting status and launches while refresh is blocked", async () => {
    let releaseRefresh: () => void = () => undefined;
    const blockedRefresh = new Promise<void>((resolve) => {
        releaseRefresh = resolve;
    });
    let runtimeStarted = false;
    const updates: AgentRunStreamState[] = [];
    const harness = createHarness({
        onRefreshCommentViews: async () => blockedRefresh,
        customRunAgentRuntime: async () => {
            runtimeStarted = true;
            return { runtime: "direct-cli", replyText: "Done" };
        },
    });
    const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
        if (update.stream) {
            updates.push(update.stream);
        }
    });

    const savePromise = harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });

    try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(runtimeStarted, true);
        assert.equal(updates[0]?.status, "queued");
        assert.equal(updates[0]?.statusHintText, "Starting Codex…");
    } finally {
        releaseRefresh();
        await savePromise;
        await waitForAgentQueueToDrain(harness.controller);
        unsubscribe();
    }
});

test("comment agent controller shows the live reply without persisting a blank entry", async () => {
    let releaseRuntime: () => void = () => undefined;
    const blockedRuntime = new Promise<void>((resolve) => {
        releaseRuntime = resolve;
    });
    let runtimeStarted = false;
    const harness = createHarness({
        customRunAgentRuntime: async () => {
            runtimeStarted = true;
            await blockedRuntime;
            return { runtime: "direct-cli", replyText: "Done" };
        },
    });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex answer this",
    });

    try {
        await new Promise((resolve) => setTimeout(resolve, 20));
        assert.equal(runtimeStarted, true);
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1")?.outputEntryId, "generated-2");
        assert.deepEqual(harness.appendedEntries, []);
        assert.deepEqual(harness.editedEntries, []);
    } finally {
        releaseRuntime();
        await waitForAgentQueueToDrain(harness.controller);
    }
    assert.deepEqual(harness.appendedEntries, []);
    assert.deepEqual(harness.editedEntries, []);
    assert.equal(harness.committedEntries.length, 1);
    assert.equal(harness.committedEntries[0]?.body, "Done");
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

    assert.equal(harness.committedEntries.at(-1)?.body, "Draft reply");
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
    assert.equal(harness.commentManager.getCommentById("generated-2")?.comment, "Cancelled.");
    assert.equal(harness.controller.getLatestAgentRunForThread("thread-1")?.status, "cancelled");
});

test("comment agent controller emits a clear update when terminal retention expires", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const scheduled: { callback?: () => void } = {};
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout(callback: () => void) {
                scheduled.callback = callback;
                return 1;
            },
            clearTimeout() {},
        },
    });

    try {
        const harness = createHarness();
        const updates: Array<{ threadId: string; stream: unknown }> = [];
        const unsubscribe = harness.controller.subscribeToStreamUpdates((update) => {
            updates.push(update);
        });
        const controller = harness.controller as any;
        controller.setRunStream({
            runId: "retained-run",
            threadId: "thread-1",
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "cancelled",
            statusText: "Cancelled",
            partialText: "",
            startedAt: 100,
            updatedAt: 101,
        });
        updates.length = 0;

        assert.ok(scheduled.callback);
        scheduled.callback();

        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
        assert.deepEqual(updates, [{ threadId: "thread-1", runId: "retained-run", stream: null }]);
        unsubscribe();
        harness.controller.dispose();
    } finally {
        if (previousWindow) {
            Object.defineProperty(globalThis, "window", previousWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
});

test("comment agent controller does not schedule retained failure streams to expire", () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let scheduled = false;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout() {
                scheduled = true;
                return 1;
            },
            clearTimeout() {},
        },
    });

    try {
        const harness = createHarness();
        const controller = harness.controller as any;
        controller.retainedRunStreamIds.add("unsaved-run");
        controller.setRunStream({
            runId: "unsaved-run",
            threadId: "thread-1",
            requestedAgent: "codex",
            runtime: "direct-cli",
            status: "failed",
            statusHintText: "Couldn’t save reply",
            partialText: "Unsaved answer",
            startedAt: 100,
            updatedAt: 101,
        });

        assert.equal(scheduled, false);
        assert.equal(
            harness.controller.getActiveAgentStreamForThread("thread-1")?.partialText,
            "Unsaved answer",
        );
        harness.controller.dispose();
    } finally {
        if (previousWindow) {
            Object.defineProperty(globalThis, "window", previousWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
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

test("comment agent controller keeps optimistic success through persisted view refresh", async () => {
    const refreshSnapshots: Array<{
        status: string | null;
        outputEntryId: string | null;
        locallyOwnedRunIds: string[];
    }> = [];
    const harness = createHarness({
        runtimeReplyText: "Stable reply",
        onRefreshCommentViews: (controller) => {
            const stream = controller.getActiveAgentStreamForThread("thread-1");
            refreshSnapshots.push({
                status: stream?.status ?? null,
                outputEntryId: stream?.outputEntryId ?? null,
                locallyOwnedRunIds: controller.getLocallyOwnedRunIds(),
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
        status: "succeeded",
        outputEntryId: "generated-2",
        locallyOwnedRunIds: ["generated-1"],
    });
    assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
});

test("comment agent controller retries a failed persisted-card handoff", async () => {
    const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    let retryCallback: () => void = () => {
        throw new Error("Reply handoff retry was not scheduled.");
    };
    let retryScheduled = false;
    let rejectedOptimisticRefresh = false;
    Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: {
            setTimeout(callback: () => void) {
                retryCallback = callback;
                retryScheduled = true;
                return 1;
            },
            clearTimeout() {},
        },
    });
    const harness = createHarness({
        runtimeReplyText: "Stable reply",
        onRefreshCommentViews: (controller) => {
            if (
                controller.getActiveAgentStreamForThread("thread-1")?.status === "succeeded"
                && !rejectedOptimisticRefresh
            ) {
                rejectedOptimisticRefresh = true;
                throw new Error("View was busy");
            }
        },
    });

    try {
        await harness.controller.handleSavedUserEntry({
            threadId: "thread-1",
            entryId: "thread-1",
            filePath: "Folder/Note.md",
            body: "@codex answer this",
        });
        await waitForAgentQueueToDrain(harness.controller);

        assert.equal(
            harness.controller.getActiveAgentStreamForThread("thread-1")?.status,
            "succeeded",
        );
        assert.equal(retryScheduled, true);
        retryCallback();
        await new Promise<void>((resolve) => setImmediate(resolve));
        assert.equal(harness.controller.getActiveAgentStreamForThread("thread-1"), null);
    } finally {
        harness.controller.dispose();
        if (previousWindow) {
            Object.defineProperty(globalThis, "window", previousWindow);
        } else {
            Reflect.deleteProperty(globalThis, "window");
        }
    }
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
    assert.deepEqual(harness.appendedEntries, []);
    assert.equal(harness.committedEntries[0]?.body, Array.from({ length: 12 }, (_value, index) => `Line ${index + 1}`).join("\n"));
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

import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { CommentManager, type Comment } from "../src/commentManager";
import { AgentRunStore } from "../src/agents/agentRunStore";
import { CommentAgentController } from "../src/agents/commentAgentController";
import type { PersistedPluginData } from "../src/settings/indexNoteSettingsPlanner";
import type {
    AgentRuntimeSelection,
    DefaultAgentRuntimeSelection,
} from "../src/agents/agentRuntimeSelection";
import type {
    AgentRuntimeInvocation,
    AgentRuntimeResult,
} from "../src/agents/agentRuntimeAdapter";
import { getAgentActorLabel } from "../src/core/agents/agentActorRegistry";
import type { AsideAgentTarget } from "../src/core/config/agentTargets";
import { VaultScriptRegistry } from "../src/vaultScripts/vaultScriptRegistry";

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
    defaultRuntimeSelection?: DefaultAgentRuntimeSelection;
    resolveDefaultAgentRuntimeSelection?: () => Promise<DefaultAgentRuntimeSelection>;
    customRunAgentRuntime?: (invocation: AgentRuntimeInvocation) => Promise<AgentRuntimeResult>;
    agentsFeatureAvailable?: boolean;
    registeredScriptPaths?: string[];
} = {}) {
    let persistedData: PersistedPluginData = options.initialPersistedData ?? {};
    const commentManager = new CommentManager(options.initialComments ?? [createComment()]);
    const defaultFilePath = (options.initialComments?.[0] ?? createComment()).filePath;
    const availableFilePaths = new Set(options.availableFilePaths ?? [defaultFilePath]);
    const appendedEntries: Array<{ threadId: string; body: string; insertAfterCommentId?: string }> = [];
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
    const vaultScriptRegistry = new VaultScriptRegistry();
    vaultScriptRegistry.seed(options.registeredScriptPaths ?? []);
    let defaultRuntimeSelectionCalls = 0;
    let refreshCount = 0;
    let idCounter = 1;
    let now = 100;
    const nowIncrement = options.nowIncrement ?? 1;
    const store = new AgentRunStore({
        readPersistedPluginData: () => persistedData,
        updatePersistedPluginData: async (updater) => {
            persistedData = updater({ ...persistedData });
            return { ...persistedData };
        },
    });

    const controller = new CommentAgentController({
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
        hashText: async (text) => `hash:${text}`,
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
        resolveAgentRuntimeSelection: async (target: AsideAgentTarget) => {
            runtimeSelectionCalls.push(target);
            return options.runtimeSelection ?? {
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
                    preferredAgent: "codex",
                    usedFallback: false,
                    runtime: "direct-cli",
                    modePreference: "auto",
                };
        },
        resolveVaultScriptMention: (mention) => vaultScriptRegistry.resolve(mention),
        isAgentsFeatureAvailable: () => options.agentsFeatureAvailable ?? true,
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
        persistedFiles,
        notices,
        logEntries,
        runtimeCalls,
        runtimeSelectionCalls,
        vaultScriptRegistry,
        getDefaultRuntimeSelectionCalls: () => defaultRuntimeSelectionCalls,
        getRefreshCount: () => refreshCount,
        getPersistedData: () => persistedData,
    };
}

test("disabled agent directive performs no runtime selection or launch", async () => {
    const harness = createHarness({ agentsFeatureAvailable: false });

    await harness.controller.handleSavedUserEntry({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "@codex say hi",
    });

    assert.deepEqual(harness.runtimeSelectionCalls, []);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.controller.getAgentRuns(), []);
    assert.deepEqual(harness.notices, ["Agents experiment is disabled."]);
});

test("disabled create-script request performs no default-agent selection", async () => {
    const harness = createHarness({ agentsFeatureAvailable: false });

    await harness.controller.handleCreateScriptRequest({
        threadId: "thread-1",
        entryId: "thread-1",
        filePath: "Folder/Note.md",
        body: "/create-script build a cleaner",
    }, "build a cleaner");

    assert.equal(harness.getDefaultRuntimeSelectionCalls(), 0);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.notices, ["Agents experiment is disabled."]);
});

test("disabled regenerate preserves the existing run without diagnostics", async () => {
    const existingRun = {
        id: "run-old",
        threadId: "thread-1",
        triggerEntryId: "thread-1",
        filePath: "Folder/Note.md",
        requestedAgent: "codex" as const,
        runtime: "direct-cli" as const,
        status: "succeeded" as const,
        promptText: "@codex say hi",
        createdAt: 10,
        startedAt: 11,
        endedAt: 12,
    };
    const harness = createHarness({
        agentsFeatureAvailable: false,
        initialPersistedData: { agentRuns: [existingRun] },
    });
    const runsBeforeRetry = harness.controller.getAgentRuns();

    assert.equal(await harness.controller.retryRun("run-old"), false);
    assert.deepEqual(harness.runtimeSelectionCalls, []);
    assert.deepEqual(harness.runtimeCalls, []);
    assert.deepEqual(harness.controller.getAgentRuns(), runsBeforeRetry);
    assert.deepEqual(harness.notices, ["Agents experiment is disabled."]);
});

test("create-script agent request queues the preferred available agent", async () => {
    const harness = createHarness({
        defaultRuntimeSelection: {
            kind: "resolved",
            selectedAgent: "claude",
            preferredAgent: "claude",
            usedFallback: false,
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
            preferredAgent: "codex",
            usedFallback: false,
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

test("create-script agent request records fallback agent metadata", async () => {
    const harness = createHarness({
        defaultRuntimeSelection: {
            kind: "resolved",
            selectedAgent: "codex",
            preferredAgent: "gemini",
            usedFallback: true,
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
    assert.equal(latestRun?.preferredAgent, "gemini");
    assert.equal(latestRun?.requestedAgent, "codex");
    assert.equal(harness.runtimeCalls[0]?.requestKind, "create-script");
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
            preferredAgent: "claude",
            usedFallback: false,
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

test("pdf-to-markdown records default-agent fallback metadata", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        defaultRuntimeSelection: {
            kind: "resolved",
            selectedAgent: "codex",
            preferredAgent: "gemini",
            usedFallback: true,
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
    assert.equal(run?.requestedAgent, "codex");
    assert.equal(run?.preferredAgent, "gemini");
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

test("pdf-to-markdown regenerate revalidates the current source before agent selection", async () => {
    const harness = createHarness({
        initialComments: [createComment({
            filePath: "Books/Guide.pdf",
            comment: "/pdf-to-markdown",
        })],
        availableFilePaths: ["Books/Guide.pdf", "Books/Guide.md"],
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
    harness.commentManager.renameFile("Books/Guide.pdf", "Books/Guide.md");

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), false);
    assert.equal(harness.getDefaultRuntimeSelectionCalls(), selectionsBeforeRetry);
    assert.equal(
        harness.appendedEntries.at(-1)?.body,
        "Open a PDF and use /pdf-to-markdown.",
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
    assert.deepEqual(latestRun?.usedFiles, ["Folder/Note.md"]);
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
    assert.deepEqual(harness.editedEntries, [{
        commentId: "generated-2",
        body: "Claude reply.",
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
    assert.deepEqual(harness.editedEntries, [{
        commentId: "generated-2",
        body: "Gemini reply.",
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
    assert.equal(harness.commentManager.getCommentById(latestRun?.outputEntryId ?? "")?.comment, "Second reply");
});

test("comment agent controller re-resolves the default fallback for create-script regenerate", async () => {
    let selection: DefaultAgentRuntimeSelection = {
        kind: "resolved",
        selectedAgent: "codex",
        preferredAgent: "gemini",
        usedFallback: true,
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
        preferredAgent: "gemini",
        usedFallback: true,
        runtime: "direct-cli",
        modePreference: "auto",
    };

    assert.equal(await harness.controller.retryRun(previous?.id ?? ""), true);
    await waitForAgentQueueToDrain(harness.controller);

    const retry = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(retry?.requestKind, "create-script");
    assert.equal(retry?.requestedAgent, "claude");
    assert.equal(retry?.preferredAgent, "gemini");
    assert.equal(retry?.outputEntryId, previous?.outputEntryId);
    assert.equal(retry?.retryOfRunId, previous?.id);
    assert.equal(harness.runtimeCalls.at(-1)?.requestKind, "create-script");
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

    const retriedRun = harness.controller.getLatestAgentRunForThread("thread-1");
    assert.equal(harness.commentManager.getCommentById(retriedRun?.outputEntryId ?? "")?.comment, "Second reply");
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

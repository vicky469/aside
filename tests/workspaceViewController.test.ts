import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import { WorkspaceViewController } from "../src/control/workspaceViewController";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createMarkdownView(
    file: TFile,
    options: {
        value?: string;
        mode?: "source" | "preview";
        editorView?: { dom: unknown; hasFocus?: boolean } | null;
        containsTarget?: unknown;
        cursor?: unknown;
        selectionCalls?: Array<{ from: unknown; to: unknown }>;
        rerenderCalls?: boolean[];
    } = {},
) {
    return {
        file,
        editor: {
            getValue: () => options.value ?? "",
            getCursor: () => options.cursor ?? { line: 0, ch: 0 },
            setSelection: (from: unknown, to: unknown) => {
                options.selectionCalls?.push({ from, to });
            },
            cm: options.editorView
                ? Object.assign(options.editorView, {
                    hasFocus: options.editorView.hasFocus ?? false,
                })
                : null,
        },
        contentEl: {
            contains: (value: unknown) => value === options.containsTarget,
        },
        getMode: () => options.mode ?? "source",
        getViewType: () => "markdown",
        previewMode: {
            rerender: (force: boolean) => {
                options.rerenderCalls?.push(force);
            },
        },
    };
}

function createSidebarView(renderCalls: number[]) {
    return {
        getViewType: () => "sidenote2-view",
        renderComments: async () => {
            renderCalls.push(renderCalls.length + 1);
        },
    };
}

function createHarness(options: {
    activeFile?: TFile | null;
    activeLeaf?: { view: unknown } | null;
    leaves?: Array<{ view: unknown }>;
    files?: TFile[];
    cachedReadValues?: Record<string, string>;
    hasPendingAggregateRefresh?: boolean;
} = {}) {
    const filesByPath = new Map((options.files ?? []).map((file) => [file.path, file]));
    const loadedFiles: string[] = [];
    let ensureIndexedCommentsLoadedCount = 0;
    let refreshAggregateNoteCount = 0;

    const workspace = {
        activeLeaf: options.activeLeaf ?? null,
        getActiveFile: () => options.activeFile ?? null,
        getMostRecentLeaf: () => options.activeLeaf ?? null,
        getLeavesOfType: (viewType: string) =>
            (options.leaves ?? []).filter((leaf) =>
                (leaf.view as { getViewType?: () => string } | null)?.getViewType?.() === viewType,
            ),
        iterateAllLeaves: (callback: (leaf: { view: unknown }) => void) => {
            for (const leaf of options.leaves ?? []) {
                callback(leaf);
            }
        },
    };

    const app = {
        workspace,
        vault: {
            getAbstractFileByPath: (path: string) => filesByPath.get(path) ?? null,
            cachedRead: async (file: TFile) => options.cachedReadValues?.[file.path] ?? "",
        },
    } as unknown as ConstructorParameters<typeof WorkspaceViewController>[0]["app"];

    const controller = new WorkspaceViewController({
        app,
        isSidebarSupportedFile: (file): file is TFile =>
            !!file && (file.extension === "md" || file.extension === "pdf"),
        isAllCommentsNotePath: (filePath) => filePath === "SideNote2 index.md",
        ensureIndexedCommentsLoaded: async () => {
            ensureIndexedCommentsLoadedCount += 1;
        },
        hasPendingAggregateRefresh: () => options.hasPendingAggregateRefresh ?? false,
        refreshAggregateNoteNow: async () => {
            refreshAggregateNoteCount += 1;
        },
        loadCommentsForFile: async (file) => {
            if (file) {
                loadedFiles.push(file.path);
            }
        },
    });

    return {
        controller,
        loadedFiles,
        getEnsureIndexedCommentsLoadedCount: () => ensureIndexedCommentsLoadedCount,
        getRefreshAggregateNoteCount: () => refreshAggregateNoteCount,
    };
}

test("workspace view controller resolves files, markdown views, and open note content", async () => {
    const openFile = createFile("docs/open.md");
    const secondaryFile = createFile("docs/secondary.md");
    const closedFile = createFile("docs/closed.md");
    const pdfFile = createFile("docs/diagram.pdf");
    const activeEditorView = { dom: { id: "active-dom" }, hasFocus: true };
    const secondaryEditorView = { dom: { id: "secondary-dom" } };
    const activeMarkdownView = createMarkdownView(openFile, {
        value: "open editor text",
        editorView: activeEditorView,
    });
    const secondaryMarkdownView = createMarkdownView(secondaryFile, {
        value: "secondary editor text",
        editorView: secondaryEditorView,
        containsTarget: secondaryEditorView.dom,
    });
    const harness = createHarness({
        activeLeaf: { view: activeMarkdownView },
        leaves: [{ view: activeMarkdownView }, { view: secondaryMarkdownView }],
        files: [openFile, secondaryFile, closedFile, pdfFile],
        cachedReadValues: {
            [closedFile.path]: "closed file text",
        },
    });

    assert.equal(harness.controller.getFileByPath(openFile.path), openFile);
    assert.equal(harness.controller.getMarkdownFileByPath(openFile.path), openFile);
    assert.equal(harness.controller.getMarkdownFileByPath(pdfFile.path), null);
    assert.equal(harness.controller.getMarkdownViewForFile(openFile), activeMarkdownView);
    assert.equal(
        harness.controller.getMarkdownViewForEditorView(activeEditorView as never),
        activeMarkdownView,
    );
    assert.equal(
        harness.controller.getMarkdownViewForEditorView(secondaryEditorView as never),
        secondaryMarkdownView,
    );
    assert.equal(harness.controller.isMarkdownEditorFocused(openFile), true);
    assert.equal(await harness.controller.getCurrentNoteContent(openFile), "open editor text");
    assert.equal(await harness.controller.getCurrentNoteContent(closedFile), "closed file text");
});

test("workspace view controller syncs visible files, rerenders surfaces, and clears markdown selections", async () => {
    const indexFile = createFile("SideNote2 index.md");
    const noteFile = createFile("docs/note.md");
    const previewRerenders: boolean[] = [];
    const sidebarRenderCalls: number[] = [];
    const selectionCalls: Array<{ from: unknown; to: unknown }> = [];
    const noteCursor = { line: 2, ch: 8 };
    const noteMarkdownView = createMarkdownView(noteFile, {
        value: "note text",
        cursor: noteCursor,
        selectionCalls,
    });
    const previewMarkdownView = createMarkdownView(noteFile, {
        mode: "preview",
        rerenderCalls: previewRerenders,
    });
    const harness = createHarness({
        activeLeaf: { view: noteMarkdownView },
        leaves: [
            { view: { file: indexFile, getViewType: () => "markdown" } },
            { view: { file: noteFile, getViewType: () => "markdown" } },
            { view: createSidebarView(sidebarRenderCalls) },
            { view: previewMarkdownView },
            { view: noteMarkdownView },
        ],
        files: [indexFile, noteFile],
    });

    await harness.controller.loadVisibleFiles();
    await harness.controller.refreshCommentViews();
    harness.controller.refreshMarkdownPreviews();

    assert.equal(harness.getEnsureIndexedCommentsLoadedCount(), 1);
    assert.equal(harness.getRefreshAggregateNoteCount(), 0);
    assert.deepEqual(harness.loadedFiles, ["docs/note.md"]);
    assert.deepEqual(sidebarRenderCalls, [1]);
    assert.deepEqual(previewRerenders, [true]);

    assert.equal(harness.controller.clearMarkdownSelection(noteFile.path), true);
    assert.deepEqual(selectionCalls, [{ from: noteCursor, to: noteCursor }]);
    assert.equal(harness.controller.clearMarkdownSelection(indexFile.path), false);
});

test("workspace view controller refreshes the index note immediately when an aggregate refresh is pending", async () => {
    const indexFile = createFile("SideNote2 index.md");
    const harness = createHarness({
        activeLeaf: { view: { file: indexFile, getViewType: () => "markdown" } },
        leaves: [
            { view: { file: indexFile, getViewType: () => "markdown" } },
        ],
        files: [indexFile],
        hasPendingAggregateRefresh: true,
    });

    await harness.controller.syncSidebarFile(indexFile);

    assert.equal(harness.getEnsureIndexedCommentsLoadedCount(), 1);
    assert.equal(harness.getRefreshAggregateNoteCount(), 1);
});

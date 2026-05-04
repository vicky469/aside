import * as assert from "node:assert/strict";
import test from "node:test";
import type { TFile } from "obsidian";
import {
    PluginRegistrationController,
    resolveCommentProtocolTarget,
    type EditorMenuItemLike,
    type EditorMenuLike,
} from "../src/app/pluginRegistrationController";

function createFile(path: string): TFile {
    return {
        path,
        basename: path.split("/").pop()?.replace(/\.[^.]+$/, "") ?? path,
        extension: path.split(".").pop() ?? "",
    } as TFile;
}

function createMenuHarness() {
    const items: Array<{
        title: string | null;
        icon: string | null;
        onClick: (() => void | Promise<void>) | null;
    }> = [];

    const menu: EditorMenuLike = {
        addItem(builder) {
            const item: EditorMenuItemLike & {
                title: string | null;
                icon: string | null;
                onClickHandler: (() => void | Promise<void>) | null;
            } = {
                title: null,
                icon: null,
                onClickHandler: null,
                setTitle(title: string) {
                    this.title = title;
                    return this;
                },
                setIcon(icon: string) {
                    this.icon = icon;
                    return this;
                },
                onClick(callback: () => void | Promise<void>) {
                    this.onClickHandler = callback;
                    return this;
                },
            };

            builder(item);
            items.push({
                title: item.title,
                icon: item.icon,
                onClick: item.onClickHandler,
            });
        },
    };

    return { menu, items };
}

function createHarness() {
    const registerViewCalls: Array<{ viewType: string; creator: (leaf: unknown) => unknown }> = [];
    const protocolHandlers = new Map<string, (params: Record<string, unknown>) => void>();
    const removedCommandIds: string[] = [];
    const commands: Array<{
        id: string;
        name: string;
        icon: string;
        callback?: () => Promise<void> | void;
        editorCallback?: (editor: { somethingSelected(): boolean }, view: { file: TFile | null }) => Promise<void> | void;
    }> = [];
    let editorMenuHandler: ((menu: EditorMenuLike, editor: { somethingSelected(): boolean }, view: { file: TFile | null }) => void) | null = null;
    const ribbonActions: Array<{ icon: string; title: string; callback: () => void }> = [];
    const createdSidebarLeaves: unknown[] = [];
    const draftCalls: Array<{ selected: boolean; filePath: string | null }> = [];
    const highlightedCommentTargets: Array<{ filePath: string | null; commentId: string }> = [];
    const openedCommentTargets: Array<{ filePath: string | null; commentId: string }> = [];
    let openIndexNoteCount = 0;

    const controller = new PluginRegistrationController({
        manifestId: "side-note2",
        iconId: "side-note2-icon",
        registerView: (viewType, creator) => {
            registerViewCalls.push({ viewType, creator });
        },
        registerObsidianProtocolHandler: (action, handler) => {
            protocolHandlers.set(action, handler);
        },
        removeCommand: (commandId) => {
            removedCommandIds.push(commandId);
        },
        addCommand: (command) => {
            commands.push(command);
        },
        registerEditorMenu: (handler) => {
            editorMenuHandler = handler;
        },
        addRibbonIcon: (icon, title, callback) => {
            ribbonActions.push({ icon, title, callback });
        },
        createSidebarView: (leaf) => {
            createdSidebarLeaves.push(leaf);
            return { leaf };
        },
        startDraftFromEditorSelection: async (editor, file) => {
            draftCalls.push({
                selected: editor.somethingSelected(),
                filePath: file?.path ?? null,
            });
        },
        highlightCommentById: async (filePath, commentId) => {
            highlightedCommentTargets.push({ filePath, commentId });
        },
        openCommentById: async (filePath, commentId) => {
            openedCommentTargets.push({ filePath, commentId });
        },
        openIndexNote: async () => {
            openIndexNoteCount += 1;
        },
    });

    return {
        controller,
        registerViewCalls,
        protocolHandlers,
        removedCommandIds,
        commands,
        getEditorMenuHandler: () => editorMenuHandler,
        ribbonActions,
        createdSidebarLeaves,
        draftCalls,
        highlightedCommentTargets,
        openedCommentTargets,
        getOpenIndexNoteCount: () => openIndexNoteCount,
    };
}

test("plugin registration controller registers the view, protocol handler, command, and ribbon action", async () => {
    const harness = createHarness();
    const editorFile = createFile("docs/file.md");

    harness.controller.register();

    assert.deepEqual(harness.registerViewCalls.map((call) => call.viewType), ["sidenote2-view"]);
    assert.equal(harness.registerViewCalls[0].creator({ id: "leaf-1" }) instanceof Object, true);
    assert.deepEqual(harness.createdSidebarLeaves, [{ id: "leaf-1" }]);
    assert.deepEqual(harness.removedCommandIds, ["side-note2:activate-view"]);
    assert.deepEqual(harness.commands.map((command) => command.id), ["add-comment-to-selection"]);
    assert.deepEqual(harness.ribbonActions.map((action) => action.title), ["Open index"]);

    await harness.commands[0].editorCallback?.(
        { somethingSelected: () => true },
        { file: editorFile },
    );
    assert.deepEqual(harness.draftCalls, [{
        selected: true,
        filePath: editorFile.path,
    }]);

    harness.protocolHandlers.get("side-note2-comment")?.({});
    harness.protocolHandlers.get("side-note2-comment")?.({
        file: "docs/file.md",
        commentId: "comment-1",
    });
    await Promise.resolve();
    assert.deepEqual(harness.highlightedCommentTargets, []);
    assert.deepEqual(harness.openedCommentTargets, [{
        filePath: "docs/file.md",
        commentId: "comment-1",
    }]);

    harness.ribbonActions[0].callback();
    await Promise.resolve();
    assert.equal(harness.getOpenIndexNoteCount(), 1);
});

test("plugin registration controller only adds the editor menu item for active selections", async () => {
    const harness = createHarness();
    const editorMenuHandler = (() => {
        harness.controller.register();
        return harness.getEditorMenuHandler();
    })();
    const file = createFile("docs/file.md");

    assert.ok(editorMenuHandler);

    const emptyMenuHarness = createMenuHarness();
    editorMenuHandler?.(
        emptyMenuHarness.menu,
        { somethingSelected: () => false },
        { file },
    );
    assert.deepEqual(emptyMenuHarness.items, []);

    const selectedMenuHarness = createMenuHarness();
    editorMenuHandler?.(
        selectedMenuHarness.menu,
        { somethingSelected: () => true },
        { file },
    );

    assert.deepEqual(selectedMenuHarness.items.map((item) => ({
        title: item.title,
        icon: item.icon,
    })), [{
        title: "Add comment to selection",
        icon: "side-note2-icon",
    }]);

    await selectedMenuHarness.items[0].onClick?.();
    assert.deepEqual(harness.draftCalls, [{
        selected: true,
        filePath: file.path,
    }]);
});

test("comment protocol target resolution requires a comment id and treats file as optional", () => {
    assert.equal(resolveCommentProtocolTarget({}), null);
    assert.equal(resolveCommentProtocolTarget({ file: "docs/file.md" }), null);
    assert.deepEqual(resolveCommentProtocolTarget({ commentId: "comment-1" }), {
        filePath: null,
        commentId: "comment-1",
    });
    assert.deepEqual(resolveCommentProtocolTarget({
        file: "docs/file.md",
        commentId: "comment-1",
    }), {
        filePath: "docs/file.md",
        commentId: "comment-1",
    });
});

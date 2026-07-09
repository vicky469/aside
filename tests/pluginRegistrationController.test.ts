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

function createHarness(options: { selectionAction?: "add-comment" | "orphan-anchor" } = {}) {
    const registerViewCalls: Array<{ viewType: string; creator: (leaf: unknown) => unknown }> = [];
    const registerExtensionsCalls: Array<{ extensions: string[]; viewType: string }> = [];
    const protocolHandlers = new Map<string, (params: Record<string, unknown>) => void>();
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
    const createdPublicHtmlLeaves: unknown[] = [];
    const draftCalls: Array<{ selected: boolean; filePath: string | null }> = [];
    const selectionActionCalls: Array<{ selected: boolean; filePath: string | null }> = [];
    const openedCommentTargets: Array<{ filePath: string | null; commentId: string }> = [];
    let openIndexNoteCount = 0;

    const controller = new PluginRegistrationController({
        manifestId: "aside",
        iconId: "aside-icon",
        registerView: (viewType, creator) => {
            registerViewCalls.push({ viewType, creator });
        },
        registerExtensions: (extensions, viewType) => {
            registerExtensionsCalls.push({ extensions, viewType });
        },
        registerObsidianProtocolHandler: (action, handler) => {
            protocolHandlers.set(action, handler);
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
        createPublicHtmlView: (leaf) => {
            createdPublicHtmlLeaves.push(leaf);
            return { leaf, publicHtml: true };
        },
        startDraftFromEditorSelection: async (editor, file) => {
            draftCalls.push({
                selected: editor.somethingSelected(),
                filePath: file?.path ?? null,
            });
        },
        getEditorSelectionAction: (editor, file) => {
            selectionActionCalls.push({
                selected: editor.somethingSelected(),
                filePath: file?.path ?? null,
            });
            return options.selectionAction ?? "add-comment";
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
        registerExtensionsCalls,
        protocolHandlers,
        commands,
        getEditorMenuHandler: () => editorMenuHandler,
        ribbonActions,
        createdSidebarLeaves,
        createdPublicHtmlLeaves,
        draftCalls,
        selectionActionCalls,
        openedCommentTargets,
        getOpenIndexNoteCount: () => openIndexNoteCount,
    };
}

test("plugin registration controller registers views, protocol handler, selection command, and ribbon action", async () => {
    const harness = createHarness();
    const editorFile = createFile("docs/file.md");

    harness.controller.register();

    assert.deepEqual(harness.registerViewCalls.map((call) => call.viewType), [
        "aside-view",
        "aside-public-html-view",
    ]);
    assert.equal(harness.registerViewCalls[0].creator({ id: "leaf-1" }) instanceof Object, true);
    assert.deepEqual(harness.createdSidebarLeaves, [{ id: "leaf-1" }]);
    assert.equal(harness.registerViewCalls[1].creator({ id: "leaf-2" }) instanceof Object, true);
    assert.deepEqual(harness.createdPublicHtmlLeaves, [{ id: "leaf-2" }]);
    assert.deepEqual(harness.registerExtensionsCalls, [{
        extensions: ["html", "htm"],
        viewType: "aside-public-html-view",
    }]);
    assert.deepEqual(Array.from(harness.protocolHandlers.keys()), ["aside-comment"]);
    assert.deepEqual(harness.commands.map((command) => command.id), ["add-comment-to-selection"]);
    assert.deepEqual(harness.commands.map((command) => command.name), ["Add comment to selection"]);
    assert.deepEqual(harness.ribbonActions.map((action) => action.title), ["Open Aside"]);

    await harness.commands[0].callback?.();
    await harness.commands[0].editorCallback?.(
        { somethingSelected: () => true },
        { file: editorFile },
    );
    assert.deepEqual(harness.draftCalls, [{
        selected: true,
        filePath: editorFile.path,
    }]);

    harness.protocolHandlers.get("aside-comment")?.({});
    harness.protocolHandlers.get("aside-comment")?.({
        file: "docs/file.md",
        commentId: "comment-1",
    });
    await Promise.resolve();
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
        icon: "aside-icon",
    }]);

    await selectedMenuHarness.items[0].onClick?.();
    assert.deepEqual(harness.draftCalls, [{
        selected: true,
        filePath: file.path,
    }]);
});

test("plugin registration controller labels a matched anchor selection as anchor removal", async () => {
    const harness = createHarness({ selectionAction: "orphan-anchor" });
    const editorMenuHandler = (() => {
        harness.controller.register();
        return harness.getEditorMenuHandler();
    })();
    const file = createFile("docs/file.md");

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
        title: "Remove anchor from side note",
        icon: "aside-icon",
    }]);
    assert.deepEqual(harness.selectionActionCalls, [{
        selected: true,
        filePath: file.path,
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

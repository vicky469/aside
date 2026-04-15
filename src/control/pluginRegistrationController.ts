import type { TFile } from "obsidian";

export interface EditorMenuItemLike {
    setTitle(title: string): EditorMenuItemLike;
    setIcon(icon: string): EditorMenuItemLike;
    onClick(callback: () => void | Promise<void>): EditorMenuItemLike;
}

export interface EditorMenuLike {
    addItem(builder: (item: EditorMenuItemLike) => void): void;
}

export interface EditorSelectionLike {
    somethingSelected(): boolean;
}

export interface EditorCommandViewLike {
    file: TFile | null;
}

export interface PluginRegistrationHost {
    manifestId: string;
    iconId: string;
    registerView(viewType: string, creator: (leaf: unknown) => unknown): void;
    registerObsidianProtocolHandler(
        action: string,
        handler: (params: Record<string, unknown>) => void,
    ): void;
    removeCommand(commandId: string): void;
    addCommand(command: {
        id: string;
        name: string;
        icon: string;
        callback?: () => Promise<void> | void;
        editorCallback?: (
            editor: EditorSelectionLike,
            view: EditorCommandViewLike,
        ) => Promise<void> | void;
    }): void;
    registerEditorMenu(
        handler: (
            menu: EditorMenuLike,
            editor: EditorSelectionLike,
            view: EditorCommandViewLike,
        ) => void,
    ): void;
    addRibbonIcon(icon: string, title: string, callback: () => void): void;
    createSidebarView(leaf: unknown): unknown;
    startDraftFromEditorSelection(editor: EditorSelectionLike, file: TFile | null): Promise<unknown>;
    highlightCommentById(filePath: string, commentId: string): Promise<void>;
    openIndexNote(): Promise<void> | void;
}

export interface CommentProtocolTarget {
    filePath: string;
    commentId: string;
}

export function resolveCommentProtocolTarget(params: Record<string, unknown>): CommentProtocolTarget | null {
    const filePath = typeof params.file === "string" ? params.file : null;
    const commentId = typeof params.commentId === "string" ? params.commentId : null;
    return filePath && commentId ? { filePath, commentId } : null;
}

export class PluginRegistrationController {
    constructor(private readonly host: PluginRegistrationHost) {}

    public register(): void {
        this.host.registerView("sidenote2-view", (leaf) => this.host.createSidebarView(leaf));
        this.host.registerObsidianProtocolHandler("side-note2-comment", (params) => {
            const target = resolveCommentProtocolTarget(params);
            if (!target) {
                return;
            }

            void this.host.highlightCommentById(target.filePath, target.commentId);
        });
        this.host.removeCommand(`${this.host.manifestId}:activate-view`);

        this.host.addCommand({
            id: "add-comment-to-selection",
            name: "Add comment to selection",
            icon: this.host.iconId,
            editorCallback: async (editor, view) => {
                await this.host.startDraftFromEditorSelection(editor, view.file);
            },
        });

        this.host.registerEditorMenu((menu, editor, view) => {
            if (!editor.somethingSelected()) {
                return;
            }

            menu.addItem((item) => {
                item.setTitle("Add comment to selection")
                    .setIcon(this.host.iconId)
                    .onClick(async () => {
                        await this.host.startDraftFromEditorSelection(editor, view.file);
                    });
            });
        });

        this.host.addRibbonIcon(this.host.iconId, "Open index", () => {
            void this.host.openIndexNote();
        });
    }
}

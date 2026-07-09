import type { TFile } from "obsidian";
import {
    EDITOR_SELECTION_COMMENT_ACTION_LABELS,
    type EditorSelectionCommentAction,
} from "../comments/editorSelectionCommentAction";
import {
    PUBLIC_HTML_FILE_EXTENSIONS,
    PUBLIC_HTML_VIEW_TYPE,
} from "../publish/publicHtmlViewTypes";

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
    registerExtensions(extensions: string[], viewType: string): void;
    registerObsidianProtocolHandler(
        action: string,
        handler: (params: Record<string, unknown>) => void,
    ): void;
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
    createPublicHtmlView(leaf: unknown): unknown;
    startDraftFromEditorSelection(editor: EditorSelectionLike, file: TFile | null): Promise<unknown>;
    getEditorSelectionAction(editor: EditorSelectionLike, file: TFile | null): EditorSelectionCommentAction;
    openCommentById(filePath: string | null, commentId: string): Promise<void>;
    openIndexNote(): Promise<void> | void;
}

export interface CommentProtocolTarget {
    filePath: string | null;
    commentId: string;
}

export function resolveCommentProtocolTarget(params: Record<string, unknown>): CommentProtocolTarget | null {
    const filePath = typeof params.file === "string" ? params.file : null;
    const commentId = typeof params.commentId === "string" ? params.commentId : null;
    return commentId ? { filePath, commentId } : null;
}

export class PluginRegistrationController {
    constructor(private readonly host: PluginRegistrationHost) {}

    public register(): void {
        this.host.registerView("aside-view", (leaf) => this.host.createSidebarView(leaf));
        this.host.registerView(PUBLIC_HTML_VIEW_TYPE, (leaf) => this.host.createPublicHtmlView(leaf));
        this.host.registerExtensions([...PUBLIC_HTML_FILE_EXTENSIONS], PUBLIC_HTML_VIEW_TYPE);
        this.host.registerObsidianProtocolHandler("aside-comment", (params) => {
            const target = resolveCommentProtocolTarget(params);
            if (!target) {
                return;
            }

            void this.host.openCommentById(target.filePath, target.commentId);
        });

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

            const selectionAction = this.host.getEditorSelectionAction(editor, view.file);
            menu.addItem((item) => {
                item.setTitle(EDITOR_SELECTION_COMMENT_ACTION_LABELS[selectionAction])
                    .setIcon(this.host.iconId)
                    .onClick(async () => {
                        await this.host.startDraftFromEditorSelection(editor, view.file);
                    });
            });
        });

        this.host.addRibbonIcon(this.host.iconId, "Open Aside", () => {
            void this.host.openIndexNote();
        });
    }
}

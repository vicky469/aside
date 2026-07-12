import { MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type { Plugin } from "obsidian";
import type { MarkdownViewModeType } from "obsidian";
import {
    resolveWorkspaceTargetInput,
    resolveIndexLeafMode,
    resolveWorkspaceFileTargets,
    resolveWorkspaceLeafTargetInput,
    shouldHidePublicMarkdownProperties,
    shouldIgnoreWorkspaceLeafChange,
    type SidebarUnavailableReason,
} from "./workspaceContextPlanner";

export interface WorkspaceContextHost {
    app: Plugin["app"];
    getActiveMarkdownFile(): TFile | null;
    getActiveSidebarFile(): TFile | null;
    setWorkspaceFiles(activeMarkdownFile: TFile | null, activeSidebarFile: TFile | null): void;
    isAllCommentsNotePath(path: string): boolean;
    isMarkdownCommentableFile(file: TFile | null): file is TFile;
    isSidebarSupportedFile(file: TFile | null): file is TFile;
    getPublicMarkdownPropertiesHiddenRoot(): string;
    syncSidebarFile(file: TFile | null): Promise<void>;
    updateSidebarViews(file: TFile | null, options?: {
        skipDataRefresh?: boolean;
        unavailableReason?: SidebarUnavailableReason | null;
    }): Promise<void>;
    refreshEditorDecorations(): void;
}

export class WorkspaceContextController {
    private workspaceTargetVersion = 0;

    constructor(private readonly host: WorkspaceContextHost) {}

    public initializeActiveFiles(activeFile: TFile | null): void {
        const nextState = resolveWorkspaceFileTargets(
            activeFile,
            activeFile,
            null,
            null,
            (file): file is TFile => this.host.isMarkdownCommentableFile(file),
            (file): file is TFile => this.host.isSidebarSupportedFile(file),
        );
        this.host.setWorkspaceFiles(nextState.activeMarkdownFile, nextState.activeSidebarFile);
    }

    public handleFileOpen(file: TFile | null): void {
        const activeFile = this.host.app.workspace.getActiveFile();

        void this.syncIndexNoteLeafMode(this.host.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null);
        this.syncIndexNoteViewClasses();
        this.applyWorkspaceFileTargets(resolveWorkspaceTargetInput(
            file,
            activeFile,
        ), activeFile);
    }

    public handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
        const viewType = leaf?.view?.getViewType?.() ?? null;
        if (shouldIgnoreWorkspaceLeafChange(viewType)) {
            return;
        }
        const workspaceActiveFile = this.host.app.workspace.getActiveFile();

        const file = resolveWorkspaceLeafTargetInput(
            leaf,
            workspaceActiveFile,
            (value): value is TFile => value instanceof TFile,
            (filePath) => {
                const file = this.host.app.vault.getAbstractFileByPath(filePath);
                return file instanceof TFile ? file : null;
            },
        );
        void this.syncIndexNoteLeafMode(leaf);
        this.syncIndexNoteViewClasses();
        this.applyWorkspaceFileTargets(file, workspaceActiveFile);
    }

    public async syncIndexNoteLeafMode(leaf: WorkspaceLeaf | null): Promise<void> {
        if (!(leaf?.view instanceof MarkdownView)) {
            return;
        }

        const viewState = leaf.getViewState();
        const targetViewState = resolveIndexLeafMode({
            isMarkdownLeaf: viewState.type === "markdown",
            isIndexLeaf: this.host.isAllCommentsNotePath(leaf.view.file?.path ?? ""),
            currentViewMode: leaf.view.getMode(),
            isSourceMode: typeof viewState.state?.source === "boolean" ? viewState.state.source : undefined,
        });
        if (!targetViewState) {
            return;
        }

        await this.setLeafMarkdownMode(leaf, targetViewState);
    }

    public syncIndexNoteViewClasses(): void {
        this.host.app.workspace.iterateAllLeaves((leaf) => {
            if (!(leaf.view instanceof MarkdownView)) {
                return;
            }

            leaf.view.containerEl.classList.toggle(
                "aside-index-note-view",
                this.host.isAllCommentsNotePath(leaf.view.file?.path ?? ""),
            );
            leaf.view.containerEl.classList.toggle(
                "aside-public-markdown-hide-properties",
                shouldHidePublicMarkdownProperties({
                    filePath: leaf.view.file?.path,
                    extension: leaf.view.file?.extension,
                    allowedRoot: this.host.getPublicMarkdownPropertiesHiddenRoot(),
                }),
            );
        });
    }

    private applyWorkspaceFileTargets(
        file: TFile | null,
        workspaceActiveFile: TFile | null,
    ): void {
        const targetVersion = ++this.workspaceTargetVersion;
        const nextState = resolveWorkspaceFileTargets(
            file,
            workspaceActiveFile,
            this.host.getActiveMarkdownFile(),
            this.host.getActiveSidebarFile(),
            (candidate): candidate is TFile => this.host.isMarkdownCommentableFile(candidate),
            (candidate): candidate is TFile => this.host.isSidebarSupportedFile(candidate),
        );
        this.host.setWorkspaceFiles(nextState.activeMarkdownFile, nextState.activeSidebarFile);

        void this.host.updateSidebarViews(nextState.sidebarFile, {
            skipDataRefresh: true,
            unavailableReason: nextState.sidebarUnavailableReason,
        });
        const syncPromise = this.host.syncSidebarFile(nextState.sidebarFile);
        void syncPromise.finally(async () => {
            if (targetVersion !== this.workspaceTargetVersion) {
                return;
            }
            await this.host.updateSidebarViews(nextState.sidebarFile, {
                skipDataRefresh: true,
                unavailableReason: nextState.sidebarUnavailableReason,
            });
            this.host.refreshEditorDecorations();
        });
    }

    private async setLeafMarkdownMode(leaf: WorkspaceLeaf, targetMode: {
        mode: MarkdownViewModeType;
        sourceMode: boolean;
    }): Promise<void> {
        const viewState = leaf.getViewState();
        if (viewState.type !== "markdown") {
            return;
        }

        await leaf.setViewState({
            ...viewState,
            state: {
                ...(viewState.state ?? {}),
                mode: targetMode.mode,
                source: targetMode.sourceMode,
            },
        });
        this.syncIndexNoteViewClasses();
    }
}

import { MarkdownView, TFile, WorkspaceLeaf } from "obsidian";
import type { Plugin } from "obsidian";
import type { MarkdownViewModeType } from "obsidian";
import {
    resolveWorkspaceTargetInput,
    resolveIndexLeafMode,
    resolveWorkspaceFileTargets,
    resolveWorkspaceLeafTargetInput,
    shouldIgnoreWorkspaceFileOpen,
    shouldIgnoreWorkspaceLeafChange,
} from "./workspaceContextPlanner";

export interface WorkspaceContextHost {
    app: Plugin["app"];
    getActiveMarkdownFile(): TFile | null;
    getActiveSidebarFile(): TFile | null;
    setWorkspaceFiles(activeMarkdownFile: TFile | null, activeSidebarFile: TFile | null): void;
    isAllCommentsNotePath(path: string): boolean;
    isMarkdownCommentableFile(file: TFile | null): file is TFile;
    isSidebarSupportedFile(file: TFile | null): file is TFile;
    syncSidebarFile(file: TFile | null): Promise<void>;
    updateSidebarViews(file: TFile | null, options?: { skipDataRefresh?: boolean }): Promise<void>;
    refreshEditorDecorations(): void;
}

export class WorkspaceContextController {
    private workspaceTargetVersion = 0;

    constructor(private readonly host: WorkspaceContextHost) {}

    public initializeActiveFiles(activeFile: TFile | null): void {
        const nextState = resolveWorkspaceFileTargets(
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
        if (shouldIgnoreWorkspaceFileOpen(file, activeFile)) {
            return;
        }

        void this.syncIndexNoteLeafMode(this.host.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? null);
        this.syncIndexNoteViewClasses();
        this.applyWorkspaceFileTargets(resolveWorkspaceTargetInput(
            file,
            activeFile,
        ));
    }

    public handleActiveLeafChange(leaf: WorkspaceLeaf | null): void {
        const viewType = leaf?.view?.getViewType?.() ?? null;
        if (shouldIgnoreWorkspaceLeafChange(viewType)) {
            return;
        }

        const file = resolveWorkspaceLeafTargetInput(
            leaf,
            this.host.app.workspace.getActiveFile(),
            (value): value is TFile => value instanceof TFile,
        );
        void this.syncIndexNoteLeafMode(leaf);
        this.syncIndexNoteViewClasses();
        this.applyWorkspaceFileTargets(file);
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
                "sidenote2-index-note-view",
                this.host.isAllCommentsNotePath(leaf.view.file?.path ?? ""),
            );
        });
    }

    private applyWorkspaceFileTargets(file: TFile | null): void {
        const targetVersion = ++this.workspaceTargetVersion;
        const nextState = resolveWorkspaceFileTargets(
            file,
            this.host.getActiveMarkdownFile(),
            this.host.getActiveSidebarFile(),
            (candidate): candidate is TFile => this.host.isMarkdownCommentableFile(candidate),
            (candidate): candidate is TFile => this.host.isSidebarSupportedFile(candidate),
        );
        this.host.setWorkspaceFiles(nextState.activeMarkdownFile, nextState.activeSidebarFile);

        void this.host.updateSidebarViews(nextState.sidebarFile, { skipDataRefresh: true });
        const syncPromise = this.host.syncSidebarFile(nextState.sidebarFile);
        void syncPromise.finally(async () => {
            if (targetVersion !== this.workspaceTargetVersion) {
                return;
            }
            await this.host.updateSidebarViews(nextState.sidebarFile, { skipDataRefresh: true });
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

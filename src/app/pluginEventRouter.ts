import type { EventRef, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";

type WorkspaceEventName = "file-open" | "active-leaf-change" | "editor-change";
type VaultEventName = "rename" | "delete" | "modify";

interface WorkspaceEventSource {
    layoutReady: boolean;
    on(eventName: "file-open", handler: (file: TFile | null) => void): EventRef;
    on(eventName: "active-leaf-change", handler: (leaf: WorkspaceLeaf | null) => void): EventRef;
    on(eventName: "editor-change", handler: (editor: unknown, info?: { file?: TFile | null }) => void): EventRef;
    on(eventName: WorkspaceEventName, handler: (...args: unknown[]) => void): EventRef;
    onLayoutReady(handler: () => void | Promise<void>): void;
}

interface VaultEventSource {
    on(eventName: "rename", handler: (file: unknown, oldPath: string) => void | Promise<void>): EventRef;
    on(eventName: "delete", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: "modify", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: VaultEventName, handler: (...args: unknown[]) => void): EventRef;
}

export interface PluginEventRouterHost {
    app: {
        workspace: WorkspaceEventSource;
        vault: VaultEventSource;
    };
    registerEvent(eventRef: EventRef): void;
    isTFile(value: unknown): value is TFile;
    handleLayoutReady(): void | Promise<void>;
    handleFileOpen(file: TFile | null): void;
    handleActiveLeafChange(leaf: WorkspaceLeaf | null): void;
    handleFileRename(file: TFile | null, oldPath: string): Promise<void>;
    handleFileDelete(file: TAbstractFile | null): Promise<void>;
    handleFileModify(file: TFile | null): Promise<void>;
    handleEditorChange(filePath: string | null | undefined): void;
}

function isTAbstractFile(value: unknown): value is TAbstractFile {
    return !!value && typeof (value as TAbstractFile).path === "string";
}

export class PluginEventRouter {
    constructor(private readonly host: PluginEventRouterHost) {}

    public async register(): Promise<void> {
        await this.registerLayoutReady();
        this.registerWorkspaceEvents();
        this.registerVaultEvents();
    }

    private async registerLayoutReady(): Promise<void> {
        if (this.host.app.workspace.layoutReady) {
            await this.host.handleLayoutReady();
            return;
        }

        this.host.app.workspace.onLayoutReady(async () => {
            await this.host.handleLayoutReady();
        });
    }

    private registerWorkspaceEvents(): void {
        this.host.registerEvent(
            this.host.app.workspace.on("file-open", (file) => {
                this.host.handleFileOpen(file);
            }),
        );

        this.host.registerEvent(
            this.host.app.workspace.on("active-leaf-change", (leaf) => {
                this.host.handleActiveLeafChange(leaf);
            }),
        );

        this.host.registerEvent(
            this.host.app.workspace.on("editor-change", (_editor, info) => {
                this.host.handleEditorChange(info?.file?.path);
            }),
        );
    }

    private registerVaultEvents(): void {
        this.host.registerEvent(
            this.host.app.vault.on("rename", async (file, oldPath) => {
                await this.host.handleFileRename(
                    this.host.isTFile(file) ? file : null,
                    oldPath,
                );
            }),
        );

        this.host.registerEvent(
            this.host.app.vault.on("delete", async (file) => {
                await this.host.handleFileDelete(isTAbstractFile(file) ? file : null);
            }),
        );

        this.host.registerEvent(
            this.host.app.vault.on("modify", async (file) => {
                await this.host.handleFileModify(this.host.isTFile(file) ? file : null);
            }),
        );
    }
}

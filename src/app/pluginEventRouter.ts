import type { EventRef, TAbstractFile, TFile, WorkspaceLeaf } from "obsidian";

type WorkspaceEventName = "file-open" | "active-leaf-change" | "editor-change";
type VaultEventName = "create" | "rename" | "delete" | "modify";
type AsyncPluginEventName =
    | `vault:${VaultEventName}`
    | "workspace:layout-ready"
    | "metadata-cache:resolved";

interface WorkspaceEventSource {
    layoutReady: boolean;
    on(eventName: "file-open", handler: (file: TFile | null) => void): EventRef;
    on(eventName: "active-leaf-change", handler: (leaf: WorkspaceLeaf | null) => void): EventRef;
    on(eventName: "editor-change", handler: (editor: unknown, info?: { file?: TFile | null }) => void): EventRef;
    on(eventName: WorkspaceEventName, handler: (...args: unknown[]) => void): EventRef;
    onLayoutReady(handler: () => void | Promise<void>): void;
}

interface VaultEventSource {
    on(eventName: "create", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: "rename", handler: (file: unknown, oldPath: string) => void | Promise<void>): EventRef;
    on(eventName: "delete", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: "modify", handler: (file: unknown) => void | Promise<void>): EventRef;
    on(eventName: VaultEventName, handler: (...args: unknown[]) => void): EventRef;
}

interface MetadataCacheEventSource {
    on(eventName: "resolved", handler: () => void | Promise<void>): EventRef;
}

export interface PluginEventRouterHost {
    app: {
        workspace: WorkspaceEventSource;
        vault: VaultEventSource;
        metadataCache: MetadataCacheEventSource;
    };
    registerEvent(eventRef: EventRef): void;
    isTFile(value: unknown): value is TFile;
    handleFileCreateMaintenance(file: TAbstractFile | null): void;
    handleFileRenameMaintenance(file: TAbstractFile | null, oldPath: string): void;
    handleFileDeleteMaintenance(file: TAbstractFile | null): void;
    handleLayoutReady(): void | Promise<void>;
    handleFileOpen(file: TFile | null): void;
    handleActiveLeafChange(leaf: WorkspaceLeaf | null): void;
    handleFileCreate(file: TFile | null): Promise<void>;
    handleFileRename(file: TAbstractFile | null, oldPath: string): Promise<void>;
    handleFileDelete(file: TAbstractFile | null): Promise<void>;
    handleFileModify(file: TFile | null): Promise<void>;
    handleMetadataResolved(): Promise<void>;
    handleEditorChange(filePath: string | null | undefined): void;
    reportAsyncEventError(eventName: AsyncPluginEventName, error: unknown): void;
}

function isTAbstractFile(value: unknown): value is TAbstractFile {
    return !!value && typeof (value as TAbstractFile).path === "string";
}

function snapshotEventFile<T extends TAbstractFile>(file: T): T {
    const prototype = Reflect.getPrototypeOf(file);
    const snapshot = Object.assign(
        Object.create(prototype) as object,
        file,
    ) as T & { children?: TAbstractFile[] };
    snapshot.path = file.path;
    const children = (file as TAbstractFile & { children?: unknown }).children;
    if (Array.isArray(children)) {
        snapshot.children = children
            .filter(isTAbstractFile)
            .map((child) => snapshotEventFile(child));
    }
    return snapshot;
}

const enum VaultEventRoutingPhase {
    Buffering = "buffering",
    Replaying = "replaying",
    Live = "live",
}

type RoutedVaultEvent =
    | { kind: "create"; file: TAbstractFile | null }
    | { kind: "rename"; file: TAbstractFile | null; oldPath: string }
    | { kind: "delete"; file: TAbstractFile | null };

export class PluginEventRouter {
    private vaultMaintenanceEventsRegistered = false;
    private vaultEventRoutingPhase = VaultEventRoutingPhase.Buffering;
    private readonly bufferedVaultEvents: RoutedVaultEvent[] = [];
    private vaultEventReplay: Promise<void> | null = null;

    constructor(private readonly host: PluginEventRouterHost) {}

    public async register(): Promise<void> {
        this.registerVaultMaintenanceEvents();
        await this.replayStartupVaultEvents();
        await this.registerLayoutReady();
        this.registerWorkspaceEvents();
        this.registerVaultModifyEvent();
        this.registerMetadataCacheEvents();
    }

    public registerVaultMaintenanceEvents(): void {
        if (this.vaultMaintenanceEventsRegistered) {
            return;
        }

        this.vaultMaintenanceEventsRegistered = true;
        this.host.registerEvent(
            this.host.app.vault.on("create", (file) => {
                const createdFile = isTAbstractFile(file) ? file : null;
                this.host.handleFileCreateMaintenance(createdFile);
                this.routeVaultEvent({
                    kind: "create",
                    file: createdFile ? snapshotEventFile(createdFile) : null,
                });
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                const renamedFile = isTAbstractFile(file) ? file : null;
                this.host.handleFileRenameMaintenance(renamedFile, oldPath);
                this.routeVaultEvent({
                    kind: "rename",
                    file: renamedFile ? snapshotEventFile(renamedFile) : null,
                    oldPath,
                });
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                const deletedFile = isTAbstractFile(file) ? file : null;
                this.host.handleFileDeleteMaintenance(deletedFile);
                this.routeVaultEvent({
                    kind: "delete",
                    file: deletedFile ? snapshotEventFile(deletedFile) : null,
                });
            }),
        );
    }

    private replayStartupVaultEvents(): Promise<void> {
        if (this.vaultEventRoutingPhase === VaultEventRoutingPhase.Live) {
            return Promise.resolve();
        }
        if (this.vaultEventRoutingPhase === VaultEventRoutingPhase.Replaying) {
            return this.vaultEventReplay ?? Promise.resolve();
        }

        this.vaultEventRoutingPhase = VaultEventRoutingPhase.Replaying;
        this.vaultEventReplay = this.drainBufferedVaultEvents();
        return this.vaultEventReplay;
    }

    private async drainBufferedVaultEvents(): Promise<void> {
        let event = this.bufferedVaultEvents.shift();
        while (event) {
            await this.runVaultEvent(event);
            event = this.bufferedVaultEvents.shift();
        }
        this.vaultEventRoutingPhase = VaultEventRoutingPhase.Live;
    }

    private routeVaultEvent(event: RoutedVaultEvent): void {
        if (this.vaultEventRoutingPhase !== VaultEventRoutingPhase.Live) {
            this.bufferedVaultEvents.push(event);
            return;
        }

        this.dispatchAsyncEvent(`vault:${event.kind}`, () => this.handleVaultEvent(event));
    }

    private async runVaultEvent(event: RoutedVaultEvent): Promise<void> {
        await this.runAsyncEvent(`vault:${event.kind}`, () => this.handleVaultEvent(event));
    }

    private handleVaultEvent(event: RoutedVaultEvent): Promise<void> {
        switch (event.kind) {
            case "create":
                return this.host.handleFileCreate(
                    this.host.isTFile(event.file) ? event.file : null,
                );
            case "rename":
                return this.host.handleFileRename(event.file, event.oldPath);
            case "delete":
                return this.host.handleFileDelete(event.file);
        }
    }

    private dispatchAsyncEvent(eventName: AsyncPluginEventName, handler: () => void | Promise<void>): void {
        void this.runAsyncEvent(eventName, handler);
    }

    private async runAsyncEvent(eventName: AsyncPluginEventName, handler: () => void | Promise<void>): Promise<void> {
        try {
            await handler();
        } catch (error) {
            try {
                this.host.reportAsyncEventError(eventName, error);
            } catch {
                return;
            }
        }
    }

    private async registerLayoutReady(): Promise<void> {
        if (this.host.app.workspace.layoutReady) {
            await this.host.handleLayoutReady();
            return;
        }

        this.host.app.workspace.onLayoutReady(() => {
            this.dispatchAsyncEvent("workspace:layout-ready", () => this.host.handleLayoutReady());
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

    private registerVaultModifyEvent(): void {
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                this.dispatchAsyncEvent(
                    "vault:modify",
                    () => this.host.handleFileModify(this.host.isTFile(file) ? file : null),
                );
            }),
        );
    }

    private registerMetadataCacheEvents(): void {
        this.host.registerEvent(
            this.host.app.metadataCache.on("resolved", () => {
                this.dispatchAsyncEvent("metadata-cache:resolved", () => this.host.handleMetadataResolved());
            }),
        );
    }
}

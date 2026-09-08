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
    handleFileRenameMaintenance(file: TFile | null, oldPath: string): void;
    handleFileDeleteMaintenance(file: TAbstractFile | null): void;
    handleLayoutReady(): void | Promise<void>;
    handleFileOpen(file: TFile | null): void;
    handleActiveLeafChange(leaf: WorkspaceLeaf | null): void;
    handleFileCreate(file: TFile | null): Promise<void>;
    handleFileRename(file: TFile | null, oldPath: string): Promise<void>;
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
    const snapshot = Object.assign(
        Object.create(Reflect.getPrototypeOf(file)) as object,
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

type QueuedVaultLifecycleEvent =
    | Readonly<{ kind: "rename"; file: TFile | null; oldPath: string }>
    | Readonly<{ kind: "delete"; file: TAbstractFile | null }>;

export class PluginEventRouter {
    private vaultStartupEventsRegistered = false;
    private vaultModifyEventRegistered = false;
    private vaultLifecycleEventsActive = false;
    private readonly queuedVaultLifecycleEvents: QueuedVaultLifecycleEvent[] = [];
    private registrationPromise: Promise<void> | null = null;

    constructor(private readonly host: PluginEventRouterHost) {}

    public register(): Promise<void> {
        if (this.registrationPromise) {
            return this.registrationPromise;
        }

        this.registerVaultStartupEvents();
        this.registerVaultModifyEvent();
        this.registrationPromise = this.completeRegistration();
        return this.registrationPromise;
    }

    private async completeRegistration(): Promise<void> {
        await this.activateVaultLifecycleEvents();
        await this.registerLayoutReady();
        this.registerWorkspaceEvents();
        this.registerMetadataCacheEvents();
    }

    public registerVaultStartupEvents(): void {
        if (this.vaultStartupEventsRegistered) {
            return;
        }

        this.vaultStartupEventsRegistered = true;
        this.host.registerEvent(
            this.host.app.vault.on("create", (file) => {
                this.dispatchAsyncEvent(
                    "vault:create",
                    () => this.host.handleFileCreate(this.host.isTFile(file) ? file : null),
                );
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("rename", (file, oldPath) => {
                const renamedFile = this.host.isTFile(file) ? file : null;
                if (this.vaultLifecycleEventsActive) {
                    this.dispatchAsyncEvent(
                        "vault:rename",
                        () => this.host.handleFileRename(renamedFile, oldPath),
                    );
                    return;
                }
                this.host.handleFileRenameMaintenance(renamedFile, oldPath);
                this.queuedVaultLifecycleEvents.push({
                    kind: "rename",
                    file: renamedFile ? snapshotEventFile(renamedFile) : null,
                    oldPath,
                });
            }),
        );
        this.host.registerEvent(
            this.host.app.vault.on("delete", (file) => {
                const deletedFile = isTAbstractFile(file) ? file : null;
                if (this.vaultLifecycleEventsActive) {
                    this.dispatchAsyncEvent(
                        "vault:delete",
                        () => this.host.handleFileDelete(deletedFile),
                    );
                    return;
                }
                this.host.handleFileDeleteMaintenance(deletedFile);
                this.queuedVaultLifecycleEvents.push({
                    kind: "delete",
                    file: deletedFile ? snapshotEventFile(deletedFile) : null,
                });
            }),
        );
    }

    private async activateVaultLifecycleEvents(): Promise<void> {
        while (this.queuedVaultLifecycleEvents.length > 0) {
            const event = this.queuedVaultLifecycleEvents.shift();
            if (!event) {
                continue;
            }
            if (event.kind === "rename") {
                await this.runAsyncEvent(
                    "vault:rename",
                    () => this.host.handleFileRename(event.file, event.oldPath),
                );
                continue;
            }
            await this.runAsyncEvent("vault:delete", () => this.host.handleFileDelete(event.file));
        }
        this.vaultLifecycleEventsActive = true;
    }

    private dispatchAsyncEvent(
        eventName: AsyncPluginEventName,
        handler: () => void | Promise<void>,
    ): void {
        void this.runAsyncEvent(eventName, handler);
    }

    private async runAsyncEvent(
        eventName: AsyncPluginEventName,
        handler: () => void | Promise<void>,
    ): Promise<void> {
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

    private registerVaultModifyEvent(): void {
        if (this.vaultModifyEventRegistered) {
            return;
        }

        this.vaultModifyEventRegistered = true;
        this.host.registerEvent(
            this.host.app.vault.on("modify", (file) => {
                this.dispatchAsyncEvent(
                    "vault:modify",
                    () => this.host.handleFileModify(this.host.isTFile(file) ? file : null),
                );
            }),
        );
    }

    private async registerLayoutReady(): Promise<void> {
        if (this.host.app.workspace.layoutReady) {
            await this.runAsyncEvent(
                "workspace:layout-ready",
                () => this.host.handleLayoutReady(),
            );
            return;
        }

        this.host.app.workspace.onLayoutReady(() => {
            this.dispatchAsyncEvent(
                "workspace:layout-ready",
                () => this.host.handleLayoutReady(),
            );
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

    private registerMetadataCacheEvents(): void {
        this.host.registerEvent(
            this.host.app.metadataCache.on("resolved", () => {
                this.dispatchAsyncEvent(
                    "metadata-cache:resolved",
                    () => this.host.handleMetadataResolved(),
                );
            }),
        );
    }
}
